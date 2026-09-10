import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STANDARD_GAMEPAD_BUTTON,
  decodeSteamController2Report,
  isSteamController2DeviceId,
  nativeControllerButtonPressed
} from '../src/shared/steamController.ts'

function setInt16LE(report: Uint8Array, offset: number, value: number): void {
  const normalized = value < 0 ? value + 0x1_0000 : value
  report[offset] = normalized & 0xff
  report[offset + 1] = normalized >>> 8
}

function mask(index: number): number {
  return 1 << index
}

for (const id of [
  String.raw`\\?\HID#VID_28DE&PID_1302`,
  String.raw`\\?\HID#VID_28DE&PID_1303`,
  String.raw`\\?\HID#VID_28DE&PID_1304`,
  'Valve gamepad Vendor: 28de Product: 1305',
  '28de-1302-Steam Controller'
]) {
  assert.equal(isSteamController2DeviceId(id), true, `Expected Steam Controller 2: ${id}`)
}
assert.equal(isSteamController2DeviceId(String.raw`\\?\HID#VID_28DE&PID_1102`), false)
assert.equal(isSteamController2DeviceId(String.raw`\\?\HID#VID_045E&PID_028E`), false)

const report = new Uint8Array(46)
report[0] = 0x45
report[1] = 27
report[2] = 0x01 | 0x02 | 0x04 | 0x08 | 0x20 | 0x40
report[3] = 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40 | 0x80
report[4] = 0x01 | 0x08 | 0x80
setInt16LE(report, 6, 0x6000)
setInt16LE(report, 8, 0x6000)
setInt16LE(report, 10, -0x6000)
setInt16LE(report, 12, 0x6000)

const decoded = decodeSteamController2Report(report)
assert.ok(decoded)
assert.equal(decoded.family, 'steam')
assert.equal(decoded.connected, true)
assert.equal(decoded.axisX, -1)
assert.equal(decoded.axisY, -1, 'Positive Triton Y is normalized to Gamepad API up')
for (const buttonIndex of Object.values(STANDARD_GAMEPAD_BUTTON)) {
  assert.equal(
    nativeControllerButtonPressed(decoded, buttonIndex),
    true,
    `Standard button ${buttonIndex} is decoded`
  )
}

const neutral = new Uint8Array(31)
neutral[0] = 0
neutral[1] = 0x42
setInt16LE(neutral, 11, 0x3000)
setInt16LE(neutral, 13, -0x3000)
const neutralDecoded = decodeSteamController2Report(neutral)
assert.ok(neutralDecoded)
assert.equal(neutralDecoded.buttons, 0)
assert.equal(neutralDecoded.axisX, 0, 'Sub-threshold stick X is ignored')
assert.equal(neutralDecoded.axisY, 0, 'Sub-threshold stick Y is ignored')
assert.equal(decodeSteamController2Report(new Uint8Array([0x43, 0, 0, 0])), undefined)

assert.equal(
  decoded.buttons,
  Object.values(STANDARD_GAMEPAD_BUTTON).reduce((combined, index) => combined | mask(index), 0)
)
const repositoryRoot = join(import.meta.dirname, '..')
const appSource = readFileSync(join(repositoryRoot, 'src/renderer/src/App.tsx'), 'utf8')
const navigationSource = readFileSync(
  join(repositoryRoot, 'src/renderer/src/hooks/useGamepadNavigation.ts'),
  'utf8'
)
const profileSource = readFileSync(
  join(repositoryRoot, 'src/renderer/src/lib/controllerProfile.ts'),
  'utf8'
)
const keyboardSource = readFileSync(
  join(repositoryRoot, 'src/renderer/src/lib/gamepadKeyboard.ts'),
  'utf8'
)
assert.match(appSource, /useGamepadNavigation\(\)/u)
assert.match(navigationSource, /window\.api\.controllerInput\.onState/u)
assert.match(navigationSource, /nativeControllerButtonPressed/u)
assert.match(navigationSource, /CONTROLLER_EMULATED_KEYBOARD_INPUTS/u)
assert.match(profileSource, /ControllerFamily = 'xbox' \| 'playstation' \| 'steam'/u)
assert.match(profileSource, /if \(isSteamControllerGamepadId\(gamepadId\)\) return 'steam'/u)
assert.match(keyboardSource, /controllerFamily === 'steam'/u)

console.log(
  'Steam Controller 2 identity, USB/Bluetooth report decoding, standard controls, Steam profile, keyboard behavior, and root-level navigation integration passed.'
)
