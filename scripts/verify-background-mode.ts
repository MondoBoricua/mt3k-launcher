import assert from 'node:assert/strict'
import { decodeDualSense, shortcutPressed, ShortcutHold } from '../src/main/controllerShortcut.ts'

for (const [length, id, buttons, ps] of [[64, 1, 8, 10], [78, 0x31, 9, 11], [10, 1, 5, 7], [63, 0, 7, 9], [77, 0, 8, 10], [9, 0, 4, 6]]) {
  const report = Buffer.alloc(length)
  report[0] = id; report[buttons] = 0x28; report[buttons + 1] = 0x20; report[ps] = 1
  const reading = decodeDualSense(report)!
  assert.ok(shortcutPressed(reading, 'a'))
  assert.ok(shortcutPressed(reading, 'menu'))
  assert.ok(shortcutPressed(reading, 'playstation'))
  assert.equal(shortcutPressed(reading, 'dpad-up'), false)
  report[ps] = 0
  assert.equal(shortcutPressed(decodeDualSense(report)!, 'playstation'), false)
}
assert.equal(decodeDualSense(Buffer.alloc(2)), undefined)
assert.equal(shortcutPressed({ buttons: 0, leftTrigger: 30, rightTrigger: 31 }, 'left-trigger'), false)
assert.equal(shortcutPressed({ buttons: 0, leftTrigger: 30, rightTrigger: 31 }, 'right-trigger'), true)
const hold = new ShortcutHold()
assert.equal(hold.update(true, 0, 1000), undefined, 'Held at connection must not activate')
for (let now = 100; now <= 2000; now += 100) assert.equal(hold.update(true, now, 1000), undefined)
hold.update(false, 2100, 1000)
assert.equal(hold.update(true, 2200, 1000), 'pressed')
for (let now = 2300; now < 3200; now += 100) assert.equal(hold.update(true, now, 1000), undefined)
assert.equal(hold.update(true, 3200, 1000), 'trigger')
assert.equal(hold.update(true, 3300, 1000), undefined, 'Once per hold')
assert.equal(hold.update(false, 3400, 1000), 'released')
hold.update(true, 3500, 1000)
assert.equal(hold.update(true, 5500, 1000), undefined, 'Sleep/stall cancels the hold')
hold.update(false, 5600, 1000)
assert.equal(hold.update(true, 5700, 1000), 'pressed')
const other = new ShortcutHold()
assert.equal(other.update(true, 5700, 1000), undefined, 'Devices do not share holds')
console.log('PASS: DualSense USB/Bluetooth layouts, button mappings, hold timing, release, reconnect, stall safety')
