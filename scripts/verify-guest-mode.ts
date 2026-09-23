import assert from 'node:assert/strict'
import {
  GUEST_MODE_ACTIONS,
  GUEST_MODE_LOCKOUT_MS,
  GUEST_MODE_MAX_FAILED_ATTEMPTS,
  attemptsLeft,
  createLockoutState,
  isActionAllowed,
  isLockedOut,
  isValidGuestPin,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  settleLockout,
  visibleGames
} from '../src/shared/guestModePolicy.ts'
import { hashGuestPin, isGuestPinHash, verifyGuestPin } from '../src/main/guestModePin.ts'

// PIN validation: 4 to 6 ASCII digits, nothing else.
for (const pin of ['1234', '00000', '987654']) {
  assert.equal(isValidGuestPin(pin), true, `${pin} is a valid PIN`)
}
for (const pin of ['123', '1234567', '', '12a4', '12 34', '١٢٣٤', 1234, null, undefined, '１２３４']) {
  assert.equal(isValidGuestPin(pin), false, `${String(pin)} is rejected`)
}

// Hash + verify round trip; the PIN itself never appears in the stored value.
const hash = hashGuestPin('2468')
assert.equal(isGuestPinHash(hash), true)
assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
assert.equal(hash.includes('2468'), false)
assert.equal(verifyGuestPin('2468', hash), true, 'correct PIN verifies')
assert.equal(verifyGuestPin('2469', hash), false, 'wrong PIN fails')
assert.equal(verifyGuestPin('24680', hash), false, 'longer PIN fails')
assert.equal(verifyGuestPin('2468', 'scrypt$00$11'), false, 'malformed hash never verifies')
assert.equal(verifyGuestPin('2468', undefined), false, 'missing hash never verifies')
assert.notEqual(hashGuestPin('2468'), hash, 'a fresh salt makes every hash unique')
assert.throws(() => hashGuestPin('12'), /Invalid guest PIN/)

// Lockout: five failures lock for 60 s, the window expiring resets the counter.
const start = 1_000_000
let lockout = createLockoutState()
for (let attempt = 1; attempt < GUEST_MODE_MAX_FAILED_ATTEMPTS; attempt += 1) {
  lockout = recordFailedAttempt(lockout, start + attempt)
  assert.equal(isLockedOut(lockout, start + attempt), false, `attempt ${attempt} is not locked yet`)
  assert.equal(attemptsLeft(lockout), GUEST_MODE_MAX_FAILED_ATTEMPTS - attempt)
}
lockout = recordFailedAttempt(lockout, start + 10)
assert.equal(isLockedOut(lockout, start + 10), true, 'fifth failure locks')
assert.equal(lockout.lockedUntil, start + 10 + GUEST_MODE_LOCKOUT_MS)
assert.equal(attemptsLeft(lockout), 0)
assert.equal(isLockedOut(lockout, start + 10 + GUEST_MODE_LOCKOUT_MS - 1), true, 'still locked just before the window ends')
assert.equal(isLockedOut(lockout, start + 10 + GUEST_MODE_LOCKOUT_MS), false, 'unlocked once the window ends')
const settled = settleLockout(lockout, start + 10 + GUEST_MODE_LOCKOUT_MS)
assert.deepEqual(settled, createLockoutState(), 'expired lockout resets the counter')
assert.equal(attemptsLeft(settled), GUEST_MODE_MAX_FAILED_ATTEMPTS)
const afterWindow = recordFailedAttempt(lockout, start + 10 + GUEST_MODE_LOCKOUT_MS + 5)
assert.equal(afterWindow.failedAttempts, 1, 'a failure after the window starts a new count')
assert.equal(isLockedOut(afterWindow, start + 10 + GUEST_MODE_LOCKOUT_MS + 5), false)
assert.deepEqual(recordSuccessfulAttempt(), createLockoutState(), 'success clears everything')
assert.equal(lockout.failedAttempts, GUEST_MODE_MAX_FAILED_ATTEMPTS, 'inputs are never mutated')

// Visible games: an empty or missing collection shows nothing, never everything.
const games = [{ id: 'steam:1' }, { id: 'epic:2' }, { id: 'local:3' }]
assert.deepEqual(visibleGames(games, [], true), [], 'empty collection hides all')
assert.deepEqual(visibleGames(games, null, true), [], 'missing collection hides all')
assert.deepEqual(visibleGames(games, undefined, true), [], 'undefined collection hides all')
assert.deepEqual(visibleGames(games, ['epic:2', 'missing:9'], true), [{ id: 'epic:2' }], 'only allowed IDs remain')
assert.deepEqual(visibleGames(games, [], false), games, 'inactive guest mode shows everything')
assert.notEqual(visibleGames(games, [], false), games, 'inactive still returns a fresh array')

// Every action in both states: only launching survives guest mode.
for (const action of GUEST_MODE_ACTIONS) {
  assert.equal(isActionAllowed(action, false), true, `${action} allowed while inactive`)
  assert.equal(isActionAllowed(action, true), action === 'launch', `${action} while active`)
}
assert.deepEqual(
  [...GUEST_MODE_ACTIONS].sort(),
  ['edit-metadata', 'hide', 'launch', 'open-friends', 'open-settings', 'open-store', 'uninstall']
)

console.log('Guest mode checks passed: PIN validation, scrypt round trip, lockout window, visible games and action policy')
