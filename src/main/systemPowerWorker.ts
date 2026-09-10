import koffi, { type KoffiFunc } from 'koffi'

type NativeFunction = KoffiFunc<(...args: any[]) => any>
type SleepWorkerMessage =
  | { type: 'resumed' }
  | { type: 'error'; detail: string }

const TOKEN_ADJUST_PRIVILEGES = 0x0020
const TOKEN_QUERY = 0x0008
const SE_PRIVILEGE_ENABLED = 0x0002
const ERROR_NOT_ALL_ASSIGNED = 1300

function nativeError(operation: string, code: number): Error {
  return new Error(`${operation} failed (${code})`)
}

function requestSleep(performSuspend = true): void {
  const kernel32 = koffi.load('kernel32.dll')
  const advapi32 = koffi.load('advapi32.dll')
  const powrprof = koffi.load('powrprof.dll')
  const getCurrentProcess = kernel32.func(
    'intptr_t __stdcall GetCurrentProcess()'
  ) as NativeFunction
  const getLastError = kernel32.func('uint32_t __stdcall GetLastError()') as NativeFunction
  const setLastError = kernel32.func('void __stdcall SetLastError(uint32_t)') as NativeFunction
  const closeHandle = kernel32.func('int __stdcall CloseHandle(intptr_t)') as NativeFunction
  const openProcessToken = advapi32.func(
    'int __stdcall OpenProcessToken(intptr_t, uint32_t, void *)'
  ) as NativeFunction
  const lookupPrivilegeValue = advapi32.func(
    'int __stdcall LookupPrivilegeValueW(void *, str16, void *)'
  ) as NativeFunction
  const adjustTokenPrivileges = advapi32.func(
    'int __stdcall AdjustTokenPrivileges(intptr_t, int, void *, uint32_t, void *, void *)'
  ) as NativeFunction
  const setSuspendState = powrprof.func(
    'uint8_t __stdcall SetSuspendState(uint8_t, uint8_t, uint8_t)'
  ) as NativeFunction

  const pointerSize = process.arch === 'ia32' ? 4 : 8
  const tokenBuffer = Buffer.alloc(pointerSize)
  if (!openProcessToken(
    getCurrentProcess(),
    TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
    tokenBuffer
  )) {
    throw nativeError('OpenProcessToken', getLastError())
  }
  const token = pointerSize === 8
    ? tokenBuffer.readBigUInt64LE(0)
    : tokenBuffer.readUInt32LE(0)

  try {
    const luid = Buffer.alloc(8)
    if (!lookupPrivilegeValue(null, 'SeShutdownPrivilege', luid)) {
      throw nativeError('LookupPrivilegeValueW', getLastError())
    }

    const privileges = Buffer.alloc(16)
    privileges.writeUInt32LE(1, 0)
    luid.copy(privileges, 4)
    privileges.writeUInt32LE(SE_PRIVILEGE_ENABLED, 12)
    setLastError(0)
    if (!adjustTokenPrivileges(token, 0, privileges, 0, null, null)) {
      throw nativeError('AdjustTokenPrivileges', getLastError())
    }
    const privilegeError = getLastError()
    if (privilegeError === ERROR_NOT_ALL_ASSIGNED) {
      throw nativeError('SeShutdownPrivilege', privilegeError)
    }

    // Native SetSuspendState blocks until Windows wakes again. Running it in
    // this utility process keeps ORBIT's UI and power broadcasts responsive.
    if (performSuspend && !setSuspendState(0, 1, 0)) {
      throw nativeError('SetSuspendState', getLastError())
    }
  } finally {
    closeHandle(token)
  }
}

function send(message: SleepWorkerMessage): void {
  process.parentPort?.postMessage(message)
}

try {
  const probe = process.argv[2] === '--probe'
  if (!process.parentPort && !probe) throw new Error('Native sleep worker has no parent process')
  requestSleep(!probe)
  if (probe) {
    console.log('PASS: Native Windows sleep bindings and privilege are available')
    process.exit(0)
  } else {
    send({ type: 'resumed' })
  }
} catch (error) {
  send({
    type: 'error',
    detail: error instanceof Error ? error.message : 'Unknown Windows sleep error'
  })
  setImmediate(() => process.exit(1))
}
