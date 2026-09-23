import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectDisplayMode, selectProfile, validateProfile, restorePlan, isRestoreJournal, type DisplaySnapshot, type RestoreJournal, type LaunchProfileEvent } from '../src/shared/launchProfilePolicy.ts'
import { readRestoreJournal, writeRestoreJournal, clearRestoreJournal } from '../src/main/launchProfileJournal.ts'
import { LaunchProfileTransaction } from '../src/main/launchProfileTransaction.ts'

const panel = { width: 1920, height: 1080, refreshHz: 120 }
const tv = { width: 3840, height: 2160, refreshHz: 60 }
assert.equal(detectDisplayMode([{ internal: true }]), 'handheld')
assert.equal(detectDisplayMode([{ internal: true }, { internal: false }]), 'docked')
assert.equal(detectDisplayMode([{ internal: false }]), 'docked')
assert.equal(detectDisplayMode([{}]), 'handheld')
assert.equal(detectDisplayMode([{ internal: true }, { internal: true }]), 'handheld')
assert.equal(detectDisplayMode([{}, {}]), 'docked')
assert.equal(detectDisplayMode([]), 'handheld')
assert.deepEqual(selectProfile({ handheld: panel, docked: tv }, 'docked'), tv)
assert.deepEqual(selectProfile({ handheld: panel, docked: tv }, 'handheld'), panel)
assert.equal(selectProfile({ docked: tv }, 'handheld'), undefined)
assert.equal(selectProfile(undefined, 'docked'), undefined)
assert.notEqual(selectProfile({ handheld: panel }, 'handheld'), panel)
assert.equal(validateProfile(panel, [panel, tv]), true)
for (const invalid of [null, [], {}, { ...panel, width: -1 }, { ...panel, refreshHz: NaN }, { ...panel, refreshHz: 59.94 }, { ...panel, hdr: true }, { ...panel, height: '1080' }, { ...panel, extra: true }, tv]) {
  assert.equal(validateProfile(invalid, [panel]), false)
}
const previous: DisplaySnapshot = { deviceName: '\\\\.\\DISPLAY1', identity: 'MONITOR\\PANEL', profile: panel }
const applied: DisplaySnapshot = { ...previous, profile: tv }
assert.deepEqual(restorePlan(previous, applied), previous)
assert.deepEqual(restorePlan(applied, previous), applied)
assert.equal(restorePlan(previous, previous), null)
assert.equal(restorePlan(previous, { ...applied, identity: 'other' }), null)
const journal: RestoreJournal = { version: 1, previous, applied }
assert.equal(isRestoreJournal(journal), true)
assert.equal(isRestoreJournal({ ...journal, version: 2 }), false)
assert.equal(isRestoreJournal({ ...journal, previous: { ...previous, deviceName: '/tmp/file' } }), false)
const dir = mkdtempSync(join(tmpdir(), 'launch-profiles-'))
try {
  const file = join(dir, 'launch-profile-restore.json')
  assert.equal(readRestoreJournal(file), null)
  writeRestoreJournal(file, journal)
  assert.deepEqual(readRestoreJournal(file), journal)
  assert.equal(existsSync(`${file}.tmp`), false)
  clearRestoreJournal(file)
  assert.equal(readRestoreJournal(file), null)
  writeFileSync(file, '{bad json')
  assert.throws(() => readRestoreJournal(file))
  writeFileSync(file, '{}')
  assert.throws(() => readRestoreJournal(file), /Invalid/)
} finally { rmSync(dir, { recursive: true, force: true }) }

function harness() {
  let disk: RestoreJournal | null = null
  let deadline: (() => void) | null = null
  let now = 0
  let failApply = false
  let failWrite = false
  const changes: DisplaySnapshot[] = []
  const events: LaunchProfileEvent[] = []
  const transaction = new LaunchProfileTransaction({
    now: () => now,
    read: () => disk,
    write: (value) => { if (failWrite) throw new Error('Disk full'); disk = value },
    clear: () => { disk = null },
    apply: (value) => { if (failApply) throw new Error('Display disconnected'); assert.ok(disk); changes.push(value) },
    emit: (event) => events.push(event),
    schedule: (callback) => { deadline = callback; return () => { deadline = null } }
  })
  return { transaction, changes, events, disk: () => disk, expire: () => deadline?.(),
    advance: () => { now = 15_000 },
    failApply: (value: boolean) => { failApply = value }, failWrite: () => { failWrite = true },
    token: () => { const event = events.find((e) => e.kind === 'confirm'); assert.ok(event?.kind === 'confirm'); return event.token } }
}
const confirmed = harness()
const result = confirmed.transaction.begin(previous, applied)
assert.deepEqual(confirmed.changes, [applied])
assert.equal(confirmed.transaction.confirm('stale'), false)
assert.equal(await confirmed.transaction.begin(previous, applied), false, 'overlapping launch is rejected')
assert.equal(confirmed.transaction.confirm(confirmed.token()), true)
assert.equal(await result, true)
confirmed.expire()
assert.equal(confirmed.changes.length, 1, 'confirmation disarms deadline')
assert.ok(confirmed.disk(), 'journal survives confirmation')
assert.equal(confirmed.transaction.restore(), true)
assert.deepEqual(confirmed.changes, [applied, previous])
assert.equal(confirmed.disk(), null)
const timeout = harness()
const timed = timeout.transaction.begin(previous, applied)
timeout.expire()
assert.equal(await timed, false)
assert.equal(timeout.disk(), null)
assert.deepEqual(timeout.changes, [applied, previous])
assert.equal(timeout.transaction.confirm(timeout.token()), false)
const interrupted = harness()
const cancelled = interrupted.transaction.begin(previous, applied)
interrupted.transaction.restore()
assert.equal(await cancelled, false, 'disable/shutdown cancels pending launch')
const crash = harness()
const crashed = crash.transaction.begin(previous, applied)
assert.equal(crash.transaction.recover(), true)
assert.equal(await crashed, false)
assert.deepEqual(crash.changes, [applied, previous])
const failure = harness()
const failed = failure.transaction.begin(previous, applied)
failure.failApply(true)
failure.expire()
assert.equal(await failed, false)
assert.ok(failure.disk(), 'failed rollback retains recovery evidence')
failure.failApply(false)
assert.equal(failure.transaction.recover(), true)
assert.equal(failure.disk(), null)
const diskFailure = harness()
diskFailure.failWrite()
assert.equal(await diskFailure.transaction.begin(previous, applied), false)
assert.equal(diskFailure.changes.length, 0, 'never change display without durable journal')
const noop = harness()
assert.equal(await noop.transaction.begin(previous, previous), true)
assert.equal(noop.disk(), null)

const late = harness()
const lateResult = late.transaction.begin(previous, applied)
late.advance()
assert.equal(late.transaction.confirm(late.token()), false, 'late IPC cannot beat a queued timer')
assert.equal(await lateResult, false)
assert.equal(late.disk(), null)

console.log('Launch profiles: policy, validation, journal, confirmation, rollback and recovery passed')
