import type { BrowserWindow } from 'electron'
import koffi from 'koffi'
import { IPC } from '@shared/ipc'
import {
  DISCONNECTED_STEAM_CONTROLLER_SNAPSHOT,
  decodeSteamController2Report,
  isSteamController2DeviceId,
  type NativeControllerInputSnapshot
} from '@shared/steamController'

const RID_INPUT = 0x10000003
const RIDI_DEVICENAME = 0x20000007
const RIM_TYPEHID = 2
const RIDEV_REMOVE = 0x00000001
const RIDEV_INPUTSINK = 0x00000100
const RIDEV_DEVNOTIFY = 0x00002000
const WM_INPUT = 0x00ff
const WM_INPUT_DEVICE_CHANGE = 0x00fe
const GIDC_REMOVAL = 2
const VALVE_VENDOR_USAGE_PAGE = 0xff00
const STEAM_CONTROLLER_USAGE = 0x0001
const STALE_CONTROLLER_REPORT_MS = 350

const pointerSize = process.arch === 'ia32' ? 4 : 8
const rawInputHeaderSize = 8 + 2 * pointerSize
type NativeFunction = (...args: any[]) => any

function readPointer(buffer: Buffer, offset = 0): bigint {
  return pointerSize === 8
    ? buffer.readBigUInt64LE(offset)
    : BigInt(buffer.readUInt32LE(offset))
}

function strongestAxis(
  snapshots: Iterable<NativeControllerInputSnapshot>,
  axis: 'axisX' | 'axisY'
): -1 | 0 | 1 {
  for (const snapshot of snapshots) {
    if (snapshot[axis] !== 0) return snapshot[axis]
  }
  return 0
}

/**
 * Windows does not expose the 2026 Steam Controller through XInput unless
 * Steam translates it. This narrow Raw Input reader handles Valve's standard
 * Triton state reports and forwards only a sanitized gamepad snapshot.
 */
export class SteamControllerInputService {
  private rawData?: NativeFunction
  private rawInfo?: NativeFunction
  private registerRaw?: NativeFunction
  private registered = false
  private disposed = false
  private deviceNames = new Map<string, string>()
  private deviceStates = new Map<string, NativeControllerInputSnapshot>()
  private deviceUpdatedAt = new Map<string, number>()
  private publishedSnapshot = DISCONNECTED_STEAM_CONTROLLER_SNAPSHOT
  private staleReportTimer?: NodeJS.Timeout

  constructor(private readonly window: BrowserWindow) {}

  start(): void {
    if (this.disposed || this.registered || process.platform !== 'win32') return
    try {
      const user32 = koffi.load('user32.dll')
      this.rawData = user32.func(
        'uint32_t __stdcall GetRawInputData(uintptr_t, uint32_t, void *, _Inout_ uint32_t *, uint32_t)'
      )
      this.rawInfo = user32.func(
        'uint32_t __stdcall GetRawInputDeviceInfoW(uintptr_t, uint32_t, void *, _Inout_ uint32_t *)'
      )
      this.registerRaw = user32.func(
        'int __stdcall RegisterRawInputDevices(void *, uint32_t, uint32_t)'
      )
      const target = readPointer(this.window.getNativeWindowHandle())
      const registration = this.registration(RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, target)
      if (!this.registerRaw(registration, 1, registration.length)) {
        throw new Error('Windows Raw Input registration failed')
      }
      this.registered = true
      this.staleReportTimer = setInterval(
        () => this.expireStaleControllers(),
        STALE_CONTROLLER_REPORT_MS
      )
      this.window.hookWindowMessage(WM_INPUT, (_wParam, lParam) => {
        try {
          this.readRawInput(readPointer(lParam))
        } catch (error) {
          console.warn(
            '[steam-controller-input] could not read controller state:',
            error instanceof Error ? error.message : error
          )
        }
      })
      this.window.hookWindowMessage(WM_INPUT_DEVICE_CHANGE, (wParam, lParam) => {
        if (Number(readPointer(wParam)) !== GIDC_REMOVAL) return
        const key = readPointer(lParam).toString()
        this.deviceNames.delete(key)
        this.deviceUpdatedAt.delete(key)
        if (this.deviceStates.delete(key)) this.publishCombinedState()
      })
    } catch (error) {
      this.dispose()
      console.warn(
        '[steam-controller-input] native fallback unavailable:',
        error instanceof Error ? error.message : error
      )
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.registered) {
      this.registerRaw?.(this.registration(RIDEV_REMOVE, 0n), 1, 8 + pointerSize)
      if (!this.window.isDestroyed()) {
        this.window.unhookWindowMessage(WM_INPUT)
        this.window.unhookWindowMessage(WM_INPUT_DEVICE_CHANGE)
      }
    }
    this.registered = false
    if (this.staleReportTimer) clearInterval(this.staleReportTimer)
    this.staleReportTimer = undefined
    this.deviceNames.clear()
    this.deviceStates.clear()
    this.deviceUpdatedAt.clear()
  }

  private registration(flags: number, windowHandle: bigint): Buffer {
    const size = 8 + pointerSize
    const buffer = Buffer.alloc(size)
    buffer.writeUInt16LE(VALVE_VENDOR_USAGE_PAGE, 0)
    buffer.writeUInt16LE(STEAM_CONTROLLER_USAGE, 2)
    buffer.writeUInt32LE(flags, 4)
    if (pointerSize === 8) buffer.writeBigUInt64LE(windowHandle, 8)
    else buffer.writeUInt32LE(Number(windowHandle), 8)
    return buffer
  }

  private deviceName(device: bigint): string {
    const rawInfo = this.rawInfo
    if (!rawInfo) return ''
    const key = device.toString()
    const cached = this.deviceNames.get(key)
    if (cached !== undefined) return cached
    const size = [0]
    if (
      rawInfo(device, RIDI_DEVICENAME, null, size) === 0xffffffff ||
      size[0] < 1 ||
      size[0] > 32_768
    ) {
      this.deviceNames.set(key, '')
      return ''
    }
    const nameBuffer = Buffer.alloc((size[0] + 1) * 2)
    if (rawInfo(device, RIDI_DEVICENAME, nameBuffer, size) === 0xffffffff) {
      this.deviceNames.set(key, '')
      return ''
    }
    const name = nameBuffer.toString('utf16le').replace(/\0+$/u, '')
    this.deviceNames.set(key, name)
    return name
  }

  private readRawInput(rawInputHandle: bigint): void {
    if (!this.rawData || !this.rawInfo) return
    const size = [0]
    if (
      this.rawData(rawInputHandle, RID_INPUT, null, size, rawInputHeaderSize) === 0xffffffff ||
      size[0] < rawInputHeaderSize + 8 ||
      size[0] > 65_536
    ) {
      return
    }
    const data = Buffer.alloc(size[0])
    const read = this.rawData(rawInputHandle, RID_INPUT, data, size, rawInputHeaderSize)
    if (
      read === 0xffffffff ||
      read < rawInputHeaderSize + 8 ||
      read > data.length ||
      data.readUInt32LE(0) !== RIM_TYPEHID
    ) {
      return
    }

    const device = readPointer(data, 8)
    if (!isSteamController2DeviceId(this.deviceName(device))) return
    const reportLength = data.readUInt32LE(rawInputHeaderSize)
    const reportCount = data.readUInt32LE(rawInputHeaderSize + 4)
    if (
      reportLength === 0 ||
      reportCount === 0 ||
      reportLength * reportCount > read - rawInputHeaderSize - 8
    ) {
      return
    }

    const reportsOffset = rawInputHeaderSize + 8
    let snapshot: NativeControllerInputSnapshot | undefined
    for (let index = 0; index < reportCount; index += 1) {
      const offset = reportsOffset + index * reportLength
      snapshot =
        decodeSteamController2Report(data.subarray(offset, offset + reportLength)) ?? snapshot
    }
    if (!snapshot) return
    const deviceKey = device.toString()
    this.deviceStates.set(deviceKey, snapshot)
    this.deviceUpdatedAt.set(deviceKey, Date.now())
    this.publishCombinedState()
  }

  private expireStaleControllers(): void {
    const now = Date.now()
    let changed = false
    for (const [key, updatedAt] of this.deviceUpdatedAt) {
      if (now - updatedAt <= STALE_CONTROLLER_REPORT_MS) continue
      this.deviceUpdatedAt.delete(key)
      changed = this.deviceStates.delete(key) || changed
    }
    if (changed) this.publishCombinedState()
  }

  private publishCombinedState(): void {
    const states = this.deviceStates.values()
    let buttons = 0
    for (const state of states) buttons |= state.buttons
    const snapshots = [...this.deviceStates.values()]
    const next: NativeControllerInputSnapshot =
      snapshots.length === 0
        ? DISCONNECTED_STEAM_CONTROLLER_SNAPSHOT
        : {
            family: 'steam',
            id: 'steam-controller-2',
            connected: true,
            buttons,
            axisX: strongestAxis(snapshots, 'axisX'),
            axisY: strongestAxis(snapshots, 'axisY')
          }
    if (
      next.connected === this.publishedSnapshot.connected &&
      next.buttons === this.publishedSnapshot.buttons &&
      next.axisX === this.publishedSnapshot.axisX &&
      next.axisY === this.publishedSnapshot.axisY
    ) {
      return
    }
    this.publishedSnapshot = next
    if (!this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send(IPC.controllerInputState, next)
    }
  }
}
