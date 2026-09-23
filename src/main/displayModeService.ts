import koffi from 'koffi'
import { isProfile, type LaunchProfile, type DisplaySnapshot } from '@shared/launchProfilePolicy'

// DEVMODEW is 220 bytes on both Win32 and Win64; WCHAR arrays are UTF-16.
// Only resolution and refresh are changed, preserving orientation, position and depth.
const DEVMODE_SIZE = 220
const CURRENT_SETTINGS = 0xffffffff
const CDS_TEST = 2
const CDS_FULLSCREEN = 4 // Intentionally omit CDS_UPDATEREGISTRY: never persist a game mode.
let native: ReturnType<typeof loadNative> | undefined
function loadNative() {
  if (process.platform !== 'win32') throw new Error('Windows display control unavailable')
  const user32 = koffi.load('user32.dll')
  return {
    enumerate: user32.func('int __stdcall EnumDisplaySettingsW(str16, uint32_t, void *)'),
    devices: user32.func('int __stdcall EnumDisplayDevicesW(str16, uint32_t, void *, uint32_t)'),
    change: user32.func('int32_t __stdcall ChangeDisplaySettingsExW(str16, void *, void *, uint32_t, void *)')
  }
}
function api() { return native ??= loadNative() }
function text(buffer: Buffer, start: number, bytes: number): string {
  return buffer.subarray(start, start + bytes).toString('utf16le').split('\0')[0]
}
function device(index: number, parent: string | null = null): Buffer | null {
  const result = Buffer.alloc(840) // DISPLAY_DEVICEW
  result.writeUInt32LE(result.length, 0)
  return api().devices(parent, index, result, parent ? 1 : 0) ? result : null
}
function identity(name: string): string {
  // EDD_GET_DEVICE_INTERFACE_NAME identifies the monitor, not just its model.
  // Include every active target in clone configurations; disconnected targets are ignored.
  const ids: string[] = []
  for (let i = 0; i < 64; i++) {
    const monitor = device(i, name)
    if (!monitor) break
    if (!(monitor.readUInt32LE(324) & 1)) continue
    const id = text(monitor, 328, 256)
    if (!id) throw new Error('Display monitor identity unavailable')
    ids.push(id)
  }
  if (!ids.length) throw new Error('Display monitor disconnected')
  return ids.sort().join('|')
}
function modeBuffer(name: string, index: number): Buffer | null {
  const buffer = Buffer.alloc(DEVMODE_SIZE)
  buffer.writeUInt16LE(DEVMODE_SIZE, 68)
  return api().enumerate(name, index, buffer) ? buffer : null
}
function profile(buffer: Buffer): LaunchProfile {
  return { width: buffer.readUInt32LE(172), height: buffer.readUInt32LE(176), refreshHz: buffer.readUInt32LE(184) }
}

export function captureDisplay(): DisplaySnapshot {
  if (process.platform !== 'win32') throw new Error('Windows display control unavailable')
  for (let i = 0; i < 64; i++) {
    const display = device(i)
    if (!display) break
    if (!(display.readUInt32LE(324) & 4)) continue // DISPLAY_DEVICE_PRIMARY_DEVICE
    const deviceName = text(display, 4, 64)
    const current = modeBuffer(deviceName, CURRENT_SETTINGS)
    if (!current || !isProfile(profile(current))) throw new Error('Cannot capture current display mode')
    return { deviceName, identity: identity(deviceName), profile: profile(current) }
  }
  throw new Error('Primary display unavailable')
}

export function listDisplayModes(snapshot?: DisplaySnapshot): LaunchProfile[] {
  if (process.platform !== 'win32') return []
  const target = snapshot ?? captureDisplay()
  const modes = new Map<string, LaunchProfile>()
  for (let i = 0; i < 4096; i++) {
    const buffer = modeBuffer(target.deviceName, i)
    if (!buffer) break
    const p = profile(buffer)
    if (buffer.readUInt32LE(168) !== 32 || !isProfile(p)) continue
    modes.set(`${p.width}:${p.height}:${p.refreshHz}`, p)
  }
  return [...modes.values()].sort((a, b) => a.width - b.width || a.height - b.height || a.refreshHz - b.refreshHz)
}

export function applyDisplay(snapshot: DisplaySnapshot): void {
  if (process.platform !== 'win32') throw new Error('Windows display control unavailable')
  if (!isProfile(snapshot.profile) || snapshot.profile.hdr !== undefined) throw new Error('Unsupported display snapshot')
  if (identity(snapshot.deviceName) !== snapshot.identity) throw new Error('Display identity changed')
  const buffer = modeBuffer(snapshot.deviceName, CURRENT_SETTINGS)
  if (!buffer) throw new Error('Display disconnected')
  buffer.writeUInt32LE(0x00080000 | 0x00100000 | 0x00400000, 72)
  buffer.writeUInt32LE(snapshot.profile.width, 172)
  buffer.writeUInt32LE(snapshot.profile.height, 176)
  buffer.writeUInt32LE(snapshot.profile.refreshHz, 184)
  const test = api().change(snapshot.deviceName, buffer, null, CDS_TEST, null)
  if (test !== 0) throw new Error(`Display mode test failed (${test})`)
  const result = api().change(snapshot.deviceName, buffer, null, CDS_FULLSCREEN, null)
  if (result !== 0) throw new Error(`Display mode change failed (${result})`)
}
