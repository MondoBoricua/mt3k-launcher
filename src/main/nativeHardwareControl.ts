import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import koffi from 'koffi'
import type { HardwareControlStatus, OrbitSettings } from '../shared/ipc'
import { decodeDualSense, shortcutPressed, ShortcutHold, type ControllerReading } from './controllerShortcut'

const pointerSize = process.arch === 'ia32' ? 4 : 8
const headerSize = 8 + 2 * pointerSize
const pointer = (buffer: Buffer, offset = 0): bigint => pointerSize === 8
  ? buffer.readBigUInt64LE(offset) : BigInt(buffer.readUInt32LE(offset))
type NativeFunction = (...args: any[]) => any

export class NativeHardwareControl extends EventEmitter {
  private timer?: NodeJS.Timeout
  private settings: OrbitSettings
  private status: HardwareControlStatus = { state: 'disabled', connectedControllers: 0 }
  private getState?: NativeFunction
  private rawData?: NativeFunction
  private rawInfo?: NativeFunction
  private rawList?: NativeFunction
  private registerRaw?: NativeFunction
  private rawRegistered = false
  private devices = new Map<string, ControllerReading | undefined>()
  private holds = new Map<string, ShortcutHold>()
  private masks = new Map<string, number>()
  private pressedAt = new Map<string, number>()
  private nextEnumeration = 0
  private disposed = false

  constructor(private readonly window: BrowserWindow, settings: OrbitSettings) {
    super(); this.settings = settings
  }
  getStatus(): HardwareControlStatus { return { ...this.status } }
  updateSettings(settings: OrbitSettings): void {
    const changed = settings.hardwareControlEnabled !== this.settings.hardwareControlEnabled ||
      settings.hardwareControlButton !== this.settings.hardwareControlButton ||
      settings.hardwareControlHoldSeconds !== this.settings.hardwareControlHoldSeconds
    this.settings = settings
    if (changed) this.stop()
    if (this.disposed) return
    if (!settings.hardwareControlEnabled) { this.publish({ state: 'disabled', connectedControllers: 0 }); return }
    if (this.timer) return
    if (process.platform !== 'win32') {
      this.publish({ state: 'unavailable', connectedControllers: 0, reason: 'unsupported-platform' }); return
    }
    try {
      this.initialize()
      this.publish({ state: 'ready', connectedControllers: 0 })
      this.timer = setInterval(() => this.poll(), 32)
      this.poll()
    } catch (error) {
      this.stop()
      this.publish({ state: 'unavailable', connectedControllers: 0, reason: 'monitor-failed',
        detail: error instanceof Error ? error.message : String(error) })
    }
  }
  recover(): void { this.stop(); this.updateSettings(this.settings) }
  dispose(): void { this.disposed = true; this.stop(); this.removeAllListeners() }

  private initialize(): void {
    if (!this.getState) {
      for (const name of ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll']) {
        try {
          const library = koffi.load(name)
          try { this.getState = library.func('__stdcall', 100, 'uint32_t', ['uint32_t', 'void *']) }
          catch { this.getState = library.func('uint32_t __stdcall XInputGetState(uint32_t, void *)') }
          break
        } catch { /* Try the OS fallback. */ }
      }
    }
    if (!this.rawData) {
      const user32 = koffi.load('user32.dll')
      this.rawData = user32.func('uint32_t __stdcall GetRawInputData(uintptr_t, uint32_t, void *, _Inout_ uint32_t *, uint32_t)')
      this.rawInfo = user32.func('uint32_t __stdcall GetRawInputDeviceInfoW(uintptr_t, uint32_t, void *, _Inout_ uint32_t *)')
      this.rawList = user32.func('uint32_t __stdcall GetRawInputDeviceList(void *, _Inout_ uint32_t *, uint32_t)')
      this.registerRaw = user32.func('int __stdcall RegisterRawInputDevices(void *, uint32_t, uint32_t)')
    }
    const devices = this.registration(0x2100, pointer(this.window.getNativeWindowHandle()))
    if (!this.registerRaw!(devices, 2, 8 + pointerSize)) throw new Error('Windows Raw Input registration failed')
    this.rawRegistered = true
    this.window.hookWindowMessage(0xff, (_w, l) => {
      try { this.readRaw(pointer(l)) } catch (error) { this.fail(error) }
    })
    this.window.hookWindowMessage(0xfe, () => { this.nextEnumeration = 0; this.devices.clear(); this.holds.clear() })
  }
  private registration(flags: number, hwnd: bigint): Buffer {
    const size = 8 + pointerSize, buffer = Buffer.alloc(size * 2)
    for (let i = 0; i < 2; i++) {
      const offset = i * size
      buffer.writeUInt16LE(1, offset); buffer.writeUInt16LE(i === 0 ? 4 : 5, offset + 2)
      buffer.writeUInt32LE(flags, offset + 4)
      if (pointerSize === 8) buffer.writeBigUInt64LE(hwnd, offset + 8)
      else buffer.writeUInt32LE(Number(hwnd), offset + 8)
    }
    return buffer
  }
  private isDualSense(handle: bigint): boolean {
    const size = [0]
    if (this.rawInfo!(handle, 0x20000007, null, size) === 0xffffffff || size[0] < 1 || size[0] > 32768) return false
    const name = Buffer.alloc((size[0] + 1) * 2)
    if (this.rawInfo!(handle, 0x20000007, name, size) === 0xffffffff) return false
    return /VID_054C.*PID_(0CE6|0DF2)/i.test(name.toString('utf16le'))
  }
  private enumerate(): void {
    const count = [0], size = pointerSize === 8 ? 16 : 8
    if (this.rawList!(null, count, size) === 0xffffffff || count[0] > 1024) return
    const buffer = Buffer.alloc(count[0] * size)
    const read = this.rawList!(buffer, count, size)
    if (read === 0xffffffff || read > buffer.length / size) return
    const seen = new Set<string>()
    for (let i = 0; i < read; i++) {
      const handle = pointer(buffer, i * size), key = `hid:${handle}`
      if (buffer.readUInt32LE(i * size + pointerSize) !== 2 || !this.isDualSense(handle)) continue
      seen.add(key)
      if (!this.devices.has(key)) this.devices.set(key, undefined)
    }
    for (const key of this.devices.keys()) if (!seen.has(key)) { this.devices.delete(key); this.holds.delete(key) }
  }
  private readRaw(handle: bigint): void {
    const size = [0]
    if (this.rawData!(handle, 0x10000003, null, size, headerSize) === 0xffffffff || size[0] < headerSize + 8 || size[0] > 65536) return
    const data = Buffer.alloc(size[0])
    const read = this.rawData!(handle, 0x10000003, data, size, headerSize)
    if (read === 0xffffffff || read < headerSize + 8 || read > data.length || data.readUInt32LE(0) !== 2) return
    const device = pointer(data, 8), key = `hid:${device}`
    if (!this.devices.has(key) && !this.isDualSense(device)) return
    const length = data.readUInt32LE(headerSize), count = data.readUInt32LE(headerSize + 4)
    if (!length || !count || length * count > read - headerSize - 8) return
    for (let i = 0; i < count; i++) {
      const offset = headerSize + 8 + i * length
      const reading = decodeDualSense(data.subarray(offset, offset + length))
      if (reading) { this.devices.set(key, reading); this.sample(key, reading, performance.now()) }
    }
  }
  private poll(): void {
    try {
      const now = performance.now()
      if (now >= this.nextEnumeration) { this.enumerate(); this.nextEnumeration = now + 2000 }
      let count = this.devices.size
      if (this.settings.hardwareControlButton !== 'playstation' && this.getState) {
        const buffer = Buffer.alloc(32)
        for (let i = 0; i < 4; i++) {
          const key = `xinput:${i}`
          if (this.getState(i, buffer) === 0) {
            count++
            this.sample(key, { buttons: buffer.readUInt16LE(4), leftTrigger: buffer[6], rightTrigger: buffer[7] }, now)
          } else { this.holds.delete(key); this.masks.delete(key); this.pressedAt.delete(key) }
        }
      }
      for (const [key, reading] of this.devices) if (reading) this.sample(key, reading, now)
      if (count !== this.status.connectedControllers) this.publish({ ...this.status, connectedControllers: count })
    } catch (error) { this.fail(error) }
  }
  private sample(key: string, reading: ControllerReading, now: number): void {
    const hold = this.holds.get(key) ?? new ShortcutHold()
    this.holds.set(key, hold)
    if (reading.buttons !== this.masks.get(key)) {
      this.masks.set(key, reading.buttons)
      if (reading.buttons) this.publish({ ...this.status, lastAnyInputAt: Date.now(), lastRawButtonMask: reading.buttons })
    }
    const event = hold.update(shortcutPressed(reading, this.settings.hardwareControlButton), now, this.settings.hardwareControlHoldSeconds * 1000)
    if (event === 'pressed') {
      this.pressedAt.set(key, now)
      this.publish({ ...this.status, lastInputAt: Date.now(), lastPressDurationMs: undefined })
    } else if (event === 'released') {
      this.publish({ ...this.status, lastPressDurationMs: Math.max(0, now - (this.pressedAt.get(key) ?? now)) })
      this.pressedAt.delete(key)
    } else if (event === 'trigger') {
      this.publish({ ...this.status, lastTriggerAt: Date.now() }); this.emit('trigger')
    }
  }
  private fail(error: unknown): void {
    this.stop()
    this.publish({ state: 'unavailable', connectedControllers: 0, reason: 'monitor-failed',
      detail: error instanceof Error ? error.message : String(error) })
  }
  private publish(status: HardwareControlStatus): void { this.status = status; this.emit('status', this.getStatus()) }
  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (this.rawRegistered) {
      this.registerRaw?.(this.registration(1, 0n), 2, 8 + pointerSize)
      this.rawRegistered = false
      if (!this.window.isDestroyed()) { this.window.unhookWindowMessage(0xff); this.window.unhookWindowMessage(0xfe) }
    }
    this.devices.clear(); this.holds.clear(); this.masks.clear(); this.pressedAt.clear(); this.nextEnumeration = 0
  }
}
