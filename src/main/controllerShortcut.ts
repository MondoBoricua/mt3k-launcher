import type { HardwareControlButton } from '../shared/ipc'

export interface ControllerReading { buttons: number; leftTrigger: number; rightTrigger: number }
const masks: Partial<Record<HardwareControlButton, number>> = {
  menu: 0x10, view: 0x20, guide: 0x400, playstation: 0x10000,
  a: 0x1000, b: 0x2000, x: 0x4000, y: 0x8000,
  'dpad-up': 1, 'dpad-down': 2, 'dpad-left': 4, 'dpad-right': 8,
  'left-bumper': 0x100, 'right-bumper': 0x200, 'left-stick': 0x40, 'right-stick': 0x80
}
export function shortcutPressed(reading: ControllerReading, button: HardwareControlButton): boolean {
  if (button === 'left-trigger') return reading.leftTrigger > 30
  if (button === 'right-trigger') return reading.rightTrigger > 30
  return (reading.buttons & (masks[button] ?? 0)) !== 0
}

// Same USB / Bluetooth report layouts supported by the previous Raw Input reader.
export function decodeDualSense(report: Buffer): ControllerReading | undefined {
  let b: number, lt = -1, rt = -1
  if (report[0] === 0x31 && report.length > 11) { b = 9; lt = 6; rt = 7 }
  else if (report[0] === 1 && (report.length === 10 || report.length === 78)) b = 5
  else if (report[0] === 1 && report.length > 10) { b = 8; lt = 5; rt = 6 }
  else if (report.length === 63) { b = 7; lt = 4; rt = 5 }
  else if (report.length === 77) { b = 8; lt = 5; rt = 6 }
  else if (report.length === 9) b = 4
  else return undefined
  const face = report[b], shoulders = report[b + 1], system = report[b + 2]
  const hat = face & 15
  let buttons = 0
  if ([0, 1, 7].includes(hat)) buttons |= 1
  if ([3, 4, 5].includes(hat)) buttons |= 2
  if ([5, 6, 7].includes(hat)) buttons |= 4
  if ([1, 2, 3].includes(hat)) buttons |= 8
  if (face & 0x20) buttons |= 0x1000
  if (face & 0x40) buttons |= 0x2000
  if (face & 0x10) buttons |= 0x4000
  if (face & 0x80) buttons |= 0x8000
  if (shoulders & 1) buttons |= 0x100
  if (shoulders & 2) buttons |= 0x200
  if (shoulders & 0x10) buttons |= 0x20
  if (shoulders & 0x20) buttons |= 0x10
  if (shoulders & 0x40) buttons |= 0x40
  if (shoulders & 0x80) buttons |= 0x80
  if (system & 1) buttons |= 0x10000
  return { buttons, leftTrigger: lt < 0 ? (shoulders & 4 ? 255 : 0) : report[lt],
    rightTrigger: rt < 0 ? (shoulders & 8 ? 255 : 0) : report[rt] }
}

/** A device must be released once after connection/settings changes. Long event-loop
 * stalls cancel the hold, so sleep or a blocked main process cannot trigger it. */
export class ShortcutHold {
  private armed = false
  private started: number | undefined
  private previous: number | undefined
  private fired = false
  update(pressed: boolean, now: number, duration: number): 'pressed' | 'released' | 'trigger' | undefined {
    if (this.previous !== undefined && now - this.previous > 250) {
      this.armed = false; this.started = undefined; this.fired = false
    }
    this.previous = now
    if (!pressed) {
      const wasPressed = this.started !== undefined
      this.armed = true; this.started = undefined; this.fired = false
      return wasPressed ? 'released' : undefined
    }
    if (!this.armed) return undefined
    if (this.started === undefined) { this.started = now; return 'pressed' }
    if (!this.fired && now - this.started >= duration) { this.fired = true; return 'trigger' }
    return undefined
  }
}
