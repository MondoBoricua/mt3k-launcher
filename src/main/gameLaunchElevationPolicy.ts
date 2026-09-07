/** Windows reports manifest-based UAC requirements either as Win32 error 740
 * or through Node's access-denied error codes, depending on the runtime path. */
export function isWindowsElevationRequiredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const processError = error as Error & { code?: unknown; errno?: unknown; syscall?: unknown }
  const code = typeof processError.code === 'string' ? processError.code.toUpperCase() : ''
  const syscall = typeof processError.syscall === 'string' ? processError.syscall.toLowerCase() : ''
  const message = processError.message.toLocaleLowerCase('en-US')
  return (
    processError.errno === 740 ||
    (processError.errno === -4094 && code === 'UNKNOWN' && syscall.startsWith('spawn')) ||
    /(?:error|errno|code)[^\d]{0,4}740\b/.test(message) ||
    /elevation|required privilege|administrator/.test(message) ||
    code === 'EACCES' ||
    code === 'EPERM'
  )
}

/** Quotes one argv value using Windows' CommandLineToArgvW rules. This is used
 * only for Start-Process' single ArgumentList string; no shell parses it. */
export function quoteWindowsCommandLineArgument(argument: string): string {
  if (argument && !/[\s"]/u.test(argument)) return argument

  let quoted = '"'
  let backslashes = 0
  for (const character of argument) {
    if (character === '\\') {
      backslashes += 1
      continue
    }
    if (character === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
      continue
    }
    quoted += '\\'.repeat(backslashes) + character
    backslashes = 0
  }
  return quoted + '\\'.repeat(backslashes * 2) + '"'
}

export function windowsCommandLineArguments(arguments_: readonly string[]): string {
  return arguments_.map(quoteWindowsCommandLineArgument).join(' ')
}
