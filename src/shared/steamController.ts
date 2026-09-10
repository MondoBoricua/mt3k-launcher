export const STANDARD_GAMEPAD_BUTTON = {
  south: 0,
  east: 1,
  west: 2,
  north: 3,
  leftBumper: 4,
  rightBumper: 5,
  leftTrigger: 6,
  rightTrigger: 7,
  view: 8,
  menu: 9,
  leftStick: 10,
  rightStick: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  guide: 16
} as const

export type NavigationAxisValue = -1 | 0 | 1

/**
 * A standard-layout controller snapshot emitted by a native main-process
 * reader. The renderer merges it with Chromium's Gamepad API instead of
 * introducing a second navigation path.
 */
export interface NativeControllerInputSnapshot {
  family: 'steam'
  id: 'steam-controller-2'
  connected: boolean
  buttons: number
  axisX: NavigationAxisValue
  axisY: NavigationAxisValue
}

export const DISCONNECTED_STEAM_CONTROLLER_SNAPSHOT: NativeControllerInputSnapshot = {
  family: 'steam',
  id: 'steam-controller-2',
  connected: false,
  buttons: 0,
  axisX: 0,
  axisY: 0
}

const VALVE_VENDOR_ID = '28de'
const STEAM_CONTROLLER_2_PRODUCT_IDS = ['1302', '1303', '1304', '1305'] as const
const AXIS_NAVIGATION_THRESHOLD = 0.5

function buttonMask(index: number): number {
  return 1 << index
}

function normalizedDeviceId(value: string): string {
  return value.toLowerCase().replace(/0x/g, '')
}

/** Matches the 2026 controller over USB, Bluetooth, Puck and Nereid receiver. */
export function isSteamController2DeviceId(value: string): boolean {
  const normalized = normalizedDeviceId(value)
  const hasValveVendor =
    normalized.includes(`vid_${VALVE_VENDOR_ID}`) ||
    normalized.includes(`vid-${VALVE_VENDOR_ID}`) ||
    normalized.includes(`vendor: ${VALVE_VENDOR_ID}`) ||
    normalized.includes(`vendor=${VALVE_VENDOR_ID}`) ||
    new RegExp(`\\b${VALVE_VENDOR_ID}[-_:]`).test(normalized)
  if (!hasValveVendor) return false

  return STEAM_CONTROLLER_2_PRODUCT_IDS.some(
    (productId) =>
      normalized.includes(`pid_${productId}`) ||
      normalized.includes(`pid-${productId}`) ||
      normalized.includes(`product: ${productId}`) ||
      normalized.includes(`product=${productId}`) ||
      new RegExp(`\\b${VALVE_VENDOR_ID}[-_:]${productId}\\b`).test(normalized)
  )
}

/**
 * Product names are useful for Chromium IDs that omit VID/PID. Exclude the
 * virtual pad because it may represent any physical controller via Steam Input.
 */
export function isSteamControllerGamepadId(value: string): boolean {
  const normalized = value.toLowerCase()
  return (
    isSteamController2DeviceId(value) ||
    (normalized.includes('steam controller') && !normalized.includes('virtual'))
  )
}

function readInt16LE(report: Uint8Array, offset: number): number {
  const value = report[offset] | (report[offset + 1] << 8)
  return value & 0x8000 ? value - 0x1_0000 : value
}

function navigationAxis(value: number, invert = false): NavigationAxisValue {
  const normalized = value < 0 ? value / 0x8000 : value / 0x7fff
  const oriented = invert ? -normalized : normalized
  if (oriented < -AXIS_NAVIGATION_THRESHOLD) return -1
  if (oriented > AXIS_NAVIGATION_THRESHOLD) return 1
  return 0
}

/**
 * Decodes Valve Triton state reports (0x42 USB/Puck, 0x45 Bluetooth) into
 * ORBIT's standard gamepad layout. Raw Input occasionally prefixes the HID
 * report ID with a zero byte, so both shapes are accepted deliberately.
 */
export function decodeSteamController2Report(
  input: Uint8Array
): NativeControllerInputSnapshot | undefined {
  const reportOffset =
    input[0] === 0x42 || input[0] === 0x45
      ? 0
      : input[0] === 0 && (input[1] === 0x42 || input[1] === 0x45)
        ? 1
        : -1
  if (reportOffset < 0 || input.length - reportOffset < 18) return undefined

  const report = input.subarray(reportOffset)
  const face = report[2]
  const navigation = report[3]
  const system = report[4]
  const leftTrigger = Math.max(0, readInt16LE(report, 6)) / 0x7fff
  const rightTrigger = Math.max(0, readInt16LE(report, 8)) / 0x7fff
  let buttons = 0

  if (face & 0x01) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.south)
  if (face & 0x02) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.east)
  if (face & 0x04) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.west)
  if (face & 0x08) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.north)
  if (system & 0x08) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.leftBumper)
  if (navigation & 0x02) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.rightBumper)
  if (leftTrigger > 0.5) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.leftTrigger)
  if (rightTrigger > 0.5 || system & 0x80) {
    buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.rightTrigger)
  }
  if (navigation & 0x40) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.view)
  if (face & 0x40) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.menu)
  if (navigation & 0x80) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.leftStick)
  if (face & 0x20) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.rightStick)
  if (navigation & 0x20) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.dpadUp)
  if (navigation & 0x04) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.dpadDown)
  if (navigation & 0x10) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.dpadLeft)
  if (navigation & 0x08) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.dpadRight)
  if (system & 0x01) buttons |= buttonMask(STANDARD_GAMEPAD_BUTTON.guide)

  return {
    family: 'steam',
    id: 'steam-controller-2',
    connected: true,
    buttons,
    axisX: navigationAxis(readInt16LE(report, 10)),
    // Triton reports positive Y as up; the Gamepad API reports positive Y as down.
    axisY: navigationAxis(readInt16LE(report, 12), true)
  }
}

export function nativeControllerButtonPressed(
  snapshot: NativeControllerInputSnapshot | null,
  buttonIndex: number
): boolean {
  return Boolean(
    snapshot?.connected && (snapshot.buttons & buttonMask(buttonIndex)) !== 0
  )
}
