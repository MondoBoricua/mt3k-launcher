import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  LOSSLESS_SCALING_DEFAULTS,
  LosslessScalingLaunchTracker,
  OwnedCompanionProcess,
  decideLosslessScalingCloseMethod,
  losslessScalingCloseWindowScript,
  losslessScalingStartTimeScript,
  needsLosslessScalingSteamScan,
  parseLosslessScalingStartTicks,
  withinBudget,
  decideLosslessScalingStart,
  decideLosslessScalingStop,
  isLosslessScalingEligibleGame,
  isLosslessScalingExecutablePath,
  isLosslessScalingGameMode,
  losslessScalingSteamCandidates,
  losslessScalingWorkingDirectory,
  normalizeLosslessScalingPreferences,
  parseLosslessScalingTasklist,
  resolveLosslessScalingExecutable,
  resolveLosslessScalingForGame,
  validateLosslessScalingExecutable,
  type LosslessScalingPreferences
} from '../src/shared/losslessScalingPolicy.ts'
import { createLosslessScalingController, type LosslessScalingControllerDeps } from '../src/shared/losslessScalingController.ts'

// Defaults: off, new games off, close what we started on.
assert.deepEqual(LOSSLESS_SCALING_DEFAULTS, { enabled: false, defaultForGames: false, closeOnExit: true })
assert.deepEqual(normalizeLosslessScalingPreferences({}), LOSSLESS_SCALING_DEFAULTS)
assert.deepEqual(
  normalizeLosslessScalingPreferences({ losslessScalingEnabled: 'true', losslessScalingDefaultForGames: 1, losslessScalingCloseOnExit: 0 }),
  { enabled: false, defaultForGames: false, closeOnExit: true },
  'Only real booleans change the stored preferences'
)
assert.equal(normalizeLosslessScalingPreferences({ losslessScalingCloseOnExit: false }).closeOnExit, false)

for (const mode of ['default', 'always', 'never']) assert.equal(isLosslessScalingGameMode(mode), true)
for (const mode of ['', 'Always', 'on', null, undefined, 1, {}]) assert.equal(isLosslessScalingGameMode(mode), false)

// Only games that run on this PC.
for (const provider of ['steam', 'epic', 'gog', 'xbox', 'retro', 'ea', 'ubisoft', 'local']) {
  assert.equal(isLosslessScalingEligibleGame({ provider, installed: true }), true, provider)
  assert.equal(isLosslessScalingEligibleGame({ provider, installed: false }), false, `${provider} store entry`)
}
assert.equal(isLosslessScalingEligibleGame({ provider: 'playstation', installed: true }), false, 'Remote Play is a stream')
assert.equal(isLosslessScalingEligibleGame({ provider: 'geforce-now', installed: true }), false)

// Per-game tri-state.
const on: LosslessScalingPreferences = { enabled: true, defaultForGames: false, closeOnExit: true }
const steam = { provider: 'steam', installed: true }
assert.equal(resolveLosslessScalingForGame(on, undefined, steam), false, 'Default off keeps new games off')
assert.equal(resolveLosslessScalingForGame(on, 'default', steam), false)
assert.equal(resolveLosslessScalingForGame(on, 'always', steam), true)
assert.equal(resolveLosslessScalingForGame({ ...on, defaultForGames: true }, 'default', steam), true)
assert.equal(resolveLosslessScalingForGame({ ...on, defaultForGames: true }, undefined, steam), true)
assert.equal(resolveLosslessScalingForGame({ ...on, defaultForGames: true }, 'never', steam), false)
assert.equal(resolveLosslessScalingForGame({ ...on, enabled: false }, 'always', steam), false, 'Global switch wins')
assert.equal(resolveLosslessScalingForGame(on, 'always', { provider: 'playstation', installed: true }), false)
assert.equal(resolveLosslessScalingForGame(on, 'always', { provider: 'steam', installed: false }), false)

// Start decisions.
const exe = 'C:\\Steam\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe'
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: exe, running: false }), 'start')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: exe, running: true }), 'already-running')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: undefined, running: true }), 'already-running', 'A running copy is enough even without a path')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: true, executablePath: undefined, running: false }), 'missing')
assert.equal(decideLosslessScalingStart({ platform: 'win32', wanted: false, executablePath: exe, running: false }), 'skip')
assert.equal(decideLosslessScalingStart({ platform: 'darwin', wanted: true, executablePath: exe, running: false }), 'skip')
assert.equal(decideLosslessScalingStart({ platform: 'linux', wanted: true, executablePath: exe, running: false }), 'skip')

// Ownership is the spawned child handle. Its exit invalidates everything, whatever the PID does later.
class FakeChild extends EventEmitter {
  kills = 0
  readonly pid: number | undefined
  constructor(pid: number | undefined) { super(); this.pid = pid }
  kill(): boolean { this.kills++; return true }
}
{
  const child = new FakeChild(4242)
  const owned = new OwnedCompanionProcess(child, 1)
  assert.equal(owned.pid, 4242)
  assert.equal(owned.exited, false)
  assert.equal(decideLosslessScalingStop({ owned: true, exited: owned.exited, closeOnExit: true }), 'close')
  assert.equal(owned.kill(), true)
  assert.equal(child.kills, 1, 'Kill goes through the handle')
  child.emit('exit', 0, null)
  assert.equal(owned.exited, true)
  assert.equal(owned.pid, undefined, 'After exit the PID is never used again, even if Windows reuses it')
  assert.equal(owned.kill(), false, 'No kill after exit')
  assert.equal(child.kills, 1)
  assert.equal(decideLosslessScalingStop({ owned: true, exited: owned.exited, closeOnExit: true }), 'forget', 'An exited companion is forgotten, never closed')
  assert.equal(await owned.whenExited(10), true)
}
{
  const child = new FakeChild(77)
  const owned = new OwnedCompanionProcess(child, 2)
  assert.equal(await owned.whenExited(20), false, 'Waiting times out while it is alive')
  const waiting = owned.whenExited(1_000)
  child.emit('exit', 0, null)
  assert.equal(await waiting, true, 'The exit event resolves waiters at once')
  assert.equal(new OwnedCompanionProcess(new FakeChild(undefined), 3).pid, undefined)
  const throwing = new FakeChild(5)
  throwing.kill = () => { throw new Error('gone') }
  assert.equal(new OwnedCompanionProcess(throwing, 4).kill(), false, 'A throwing kill is contained')
}
assert.equal(decideLosslessScalingStop({ owned: false, exited: false, closeOnExit: true }), 'nothing', 'Never touch a copy we did not start')
assert.equal(decideLosslessScalingStop({ owned: true, exited: false, closeOnExit: false }), 'forget')

// Graceful close only with a known start time; otherwise the handle.
assert.equal(decideLosslessScalingCloseMethod({ exited: true, startTicks: '638000000000000000' }), 'none')
assert.equal(decideLosslessScalingCloseMethod({ exited: false, startTicks: '638000000000000000' }), 'window-then-handle')
assert.equal(decideLosslessScalingCloseMethod({ exited: false, startTicks: undefined }), 'handle')
assert.equal(decideLosslessScalingCloseMethod({ exited: false, startTicks: '12; Stop-Computer' }), 'handle')
const closeScript = losslessScalingCloseWindowScript(4242, '638000000000000000')
assert.match(closeScript, /Get-Process -Id 4242 /)
assert.match(closeScript, /StartTime\.ToUniversalTime\(\)\.Ticks -ne 638000000000000000\) \{ exit 3 \}/, 'A different start time (reused PID) bails out')
assert.match(closeScript, /ProcessName -ne 'LosslessScaling'/)
assert.match(closeScript, /CloseMainWindow/)
assert.doesNotMatch(closeScript, /Stop-Process|taskkill/i, 'Forced termination only through the child handle')
for (const [pid, ticks] of [[0, '1'], [-1, '1'], [1.5, '1'], [4242, ''], [4242, '1 ; x'], [4242, '1'.repeat(20)]] as const) {
  assert.throws(() => losslessScalingCloseWindowScript(pid, ticks))
}
assert.match(losslessScalingStartTimeScript(4242), /Get-Process -Id 4242 .*StartTime\.ToUniversalTime\(\)\.Ticks/)
assert.throws(() => losslessScalingStartTimeScript(0))
assert.equal(parseLosslessScalingStartTicks('638000000000000000\r\n'), '638000000000000000')
assert.equal(parseLosslessScalingStartTicks(''), undefined)
assert.equal(parseLosslessScalingStartTicks('Get-Process : error'), undefined)

// Launch generations: stale startup work cannot spawn or steal ownership.
{
  const tracker = new LosslessScalingLaunchTracker()
  const a = tracker.begin()
  assert.equal(tracker.isCurrent(a), true)
  // A is cancelled: the manager ends the active companion session without an id.
  assert.equal(tracker.end(), a)
  const b = tracker.begin()
  assert.notEqual(a, b)
  assert.equal(tracker.isCurrent(a), false, "A's delayed work sees it is stale before spawning")
  assert.equal(tracker.isCurrent(b), true)
  assert.equal(tracker.end(a), a)
  assert.equal(tracker.isCurrent(b), true, "Ending A's id late never ends B")
  assert.equal(tracker.end(b), b)
  assert.equal(tracker.active, undefined)
  assert.equal(tracker.end(), undefined)
}

// Startup budget: the launch continues on expiry.
assert.equal(await withinBudget(new Promise((resolve) => setTimeout(resolve, 5)), 200), true)
assert.equal(await withinBudget(new Promise(() => undefined), 20), false)
assert.equal(await withinBudget(Promise.reject(new Error('x')), 200), true, 'A rejection counts as finished, not as a hang')

// Path validation: only an absolute path to a file named LosslessScaling.exe.
for (const valid of [
  exe,
  'D:/Games/Lossless Scaling/losslessscaling.EXE',
  '\\\\nas\\games\\Lossless Scaling\\LosslessScaling.exe'
]) assert.equal(isLosslessScalingExecutablePath(valid), true, valid)
for (const invalid of [
  '', ' ', 'LosslessScaling.exe', '.\\LosslessScaling.exe', 'C:\\Tools\\Lossless.exe',
  'C:\\Tools\\LosslessScaling.exe.bat', 'C:\\Tools\\LosslessScaling.exe ', ' C:\\Tools\\LosslessScaling.exe',
  'C:\\Tools\\..\\LosslessScaling.exe', 'C:\\Tools\\Loss\u0000lessScaling.exe', 'C:\\"x"\\LosslessScaling.exe',
  '/usr/bin/LosslessScaling.exe', 'C:\\x\\' + 'a'.repeat(33_000) + '\\LosslessScaling.exe', 42, null, undefined, {}
]) assert.equal(isLosslessScalingExecutablePath(invalid), false, String(invalid).slice(0, 60))

const files = new Set([exe.toLowerCase()])
const fileSystem = {
  exists: (path: string) => files.has(path.toLowerCase()) || path === 'C:\\Folder\\LosslessScaling.exe',
  isFile: (path: string) => files.has(path.toLowerCase())
}
assert.deepEqual(validateLosslessScalingExecutable(exe, fileSystem), { ok: true, path: exe })
assert.deepEqual(validateLosslessScalingExecutable('C:\\Other\\LosslessScaling.exe', fileSystem), { ok: false, reason: 'not-found' })
assert.deepEqual(validateLosslessScalingExecutable('C:\\Folder\\LosslessScaling.exe', fileSystem), { ok: false, reason: 'not-a-file' })
assert.deepEqual(validateLosslessScalingExecutable('C:\\Tools\\cmd.exe', fileSystem), { ok: false, reason: 'invalid-path' })

// Steam detection candidates.
assert.deepEqual(
  losslessScalingSteamCandidates([
    { path: 'C:\\Program Files (x86)\\Steam\\' },
    { path: 'D:\\SteamLibrary', installDirName: 'LS Custom' },
    { path: 'd:\\steamlibrary', installDirName: 'Lossless Scaling' },
    { path: 'E:\\Lib', installDirName: '..\\..\\Windows' },
    { path: '' }
  ]),
  [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe',
    'D:\\SteamLibrary\\steamapps\\common\\LS Custom\\LosslessScaling.exe',
    'D:\\SteamLibrary\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe',
    'E:\\Lib\\steamapps\\common\\Lossless Scaling\\LosslessScaling.exe'
  ],
  'Manifest folder first, duplicates folded, traversal ignored'
)

const manual = 'D:\\Manual\\LosslessScaling.exe'
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: undefined, manualIsFile: false, steamPath: exe }),
  { supported: true, state: 'found', source: 'steam', path: exe, manualPath: undefined }
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: manual, manualIsFile: true, steamPath: undefined }),
  { supported: true, state: 'found', source: 'manual', path: manual, manualPath: manual },
  'A valid manual override wins'
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: 'D:\\Gone\\LosslessScaling.exe', manualIsFile: false, steamPath: exe }),
  { supported: true, state: 'found', source: 'steam', path: exe, manualPath: 'D:\\Gone\\LosslessScaling.exe' },
  'A stale override falls back to Steam and stays visible'
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: 'C:\\Tools\\cmd.exe', manualIsFile: true, steamPath: undefined }),
  { supported: true, state: 'missing', source: 'none', manualPath: 'C:\\Tools\\cmd.exe' },
  'A wrong file name is never used even if it exists'
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'win32', manualPath: undefined, manualIsFile: false, steamPath: undefined }),
  { supported: true, state: 'missing', source: 'none', manualPath: undefined }
)
assert.deepEqual(
  resolveLosslessScalingExecutable({ platform: 'darwin', manualPath: undefined, manualIsFile: false, steamPath: exe }),
  { supported: false, state: 'missing', source: 'none', manualPath: undefined },
  'Other platforms never report a path'
)
assert.equal(needsLosslessScalingSteamScan(manual, true), false, 'No Steam scan with a usable manual path')
assert.equal(needsLosslessScalingSteamScan(manual, false), true)
assert.equal(needsLosslessScalingSteamScan(undefined, false), true)
assert.equal(needsLosslessScalingSteamScan('C:\\Tools\\cmd.exe', true), true)

assert.equal(losslessScalingWorkingDirectory(exe), 'C:\\Steam\\steamapps\\common\\Lossless Scaling')

// tasklist parsing.
assert.deepEqual(parseLosslessScalingTasklist('INFO: No tasks are running which match the specified criteria.\r\n'), [])
assert.deepEqual(parseLosslessScalingTasklist(''), [])
assert.deepEqual(
  parseLosslessScalingTasklist(
    '"LosslessScaling.exe","12345","Console","1","180,512 K"\r\n' +
      '"losslessscaling.exe","678","Console","1","1 K"\r\n' +
      '"LosslessScaling.exe.bak","9","Console","1","1 K"\r\n' +
      '"explorer.exe","4","Console","1","1 K"\r\n' +
      '"LosslessScaling.exe","0","Console","1","1 K"\r\n'
  ),
  [12345, 678]
)


// Lifecycle through the real controller, with Windows replaced by controllable fakes.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
function harness(overrides: Partial<LosslessScalingControllerDeps> = {}) {
  const events: string[] = []
  const spawned: { session: number; child: FakeChild; owned: OwnedCompanionProcess }[] = []
  const closed: number[] = []
  let nextPid = 1000
  const deps: LosslessScalingControllerDeps = {
    platform: 'win32',
    preferences: () => ({ enabled: true, defaultForGames: false, closeOnExit: true }),
    gameMode: (id) => (id.endsWith('never') ? 'never' : 'always'),
    isRunning: async () => false,
    executablePath: async () => exe,
    invalidateDiscovery: () => events.push('invalidate'),
    spawn: async (_path, session) => {
      const child = new FakeChild(nextPid++)
      const owned = new OwnedCompanionProcess(child, session)
      spawned.push({ session, child, owned })
      return owned
    },
    close: async (owned) => { closed.push(owned.session); owned.kill() },
    notify: (event) => events.push(event.kind),
    log: () => undefined,
    startupBudgetMs: 200,
    killGraceMs: 5,
    ...overrides
  }
  return { controller: createLosslessScalingController(deps), events, spawned, closed }
}
const localGame = (id: string) => ({ id, provider: 'steam', installed: true })

{ // Normal session: start, own, close at end.
  const h = harness()
  const session = await h.controller.beforeLaunch(localGame('steam:1'))
  assert.equal(typeof session, 'number')
  assert.equal(h.spawned.length, 1)
  await h.controller.sessionEnded()
  assert.deepEqual(h.closed, [session])
  await h.controller.sessionEnded()
  assert.deepEqual(h.closed, [session], 'A second end does nothing')
}
{ // A copy the user already runs is never owned or closed.
  const h = harness({ isRunning: async () => true })
  assert.equal(await h.controller.beforeLaunch(localGame('steam:1')), 1)
  assert.equal(h.spawned.length, 0)
  await h.controller.sessionEnded()
  assert.deepEqual(h.closed, [])
}
{ // Our copy exited during the game (PID may be reused): nothing is closed.
  const h = harness()
  await h.controller.beforeLaunch(localGame('steam:1'))
  h.spawned[0].child.emit('exit', 0, null)
  await h.controller.sessionEnded()
  assert.deepEqual(h.closed, [], 'Never act on a PID once the handle reported exit')
}
{ // Close option off: forgotten, not closed.
  const h = harness({ preferences: () => ({ enabled: true, defaultForGames: false, closeOnExit: false }) })
  await h.controller.beforeLaunch(localGame('steam:1'))
  await h.controller.sessionEnded()
  assert.deepEqual(h.closed, [])
}
{ // Opted-out games never wait for a pending close.
  const hang = deferred<void>()
  const h = harness({ close: () => hang.promise })
  await h.controller.beforeLaunch(localGame('steam:1'))
  void h.controller.sessionEnded()
  const started = Date.now()
  assert.equal(await h.controller.beforeLaunch(localGame('steam:never')), undefined)
  assert.equal(await h.controller.beforeLaunch({ id: 'playstation:1', provider: 'playstation', installed: true }), undefined)
  assert.ok(Date.now() - started < 50, 'Eligibility is decided before awaiting cleanup')
  hang.resolve()
}
{ // Overlap: A cancelled while its process query is slow, B starts; A must not spawn or steal ownership.
  const queries: { resolve: (value: boolean) => void }[] = []
  const h = harness({ isRunning: () => { const d = deferred<boolean>(); queries.push(d); return d.promise } })
  const a = h.controller.beforeLaunch(localGame('steam:a'))
  await tick()
  void h.controller.sessionEnded() // manager ends the active launch (A) on cancel
  const b = h.controller.beforeLaunch(localGame('steam:b'))
  await tick()
  queries[1].resolve(false)
  const bSession = await b
  assert.equal(h.spawned.length, 1)
  assert.equal(h.spawned[0].session, bSession)
  queries[0].resolve(false)
  assert.equal(await a, undefined, 'A reports no session')
  await tick()
  assert.equal(h.spawned.length, 1, 'Stale A never spawns')
  await h.controller.sessionEnded(1)
  assert.deepEqual(h.closed, [], "Ending A late does not close B's copy")
  await h.controller.sessionEnded()
  assert.deepEqual(h.closed, [bSession], "B's copy is closed at B's end")
}
{ // Budget expiry: the launch continues, and the pending work can no longer spawn.
  const query = deferred<boolean>()
  const h = harness({ isRunning: () => query.promise, startupBudgetMs: 20 })
  const started = Date.now()
  assert.equal(await h.controller.beforeLaunch(localGame('steam:1')), undefined)
  assert.ok(Date.now() - started < 150)
  query.resolve(false)
  await tick(10)
  assert.equal(h.spawned.length, 0, 'Late work is invalidated before spawn')
}
{ // Budget expires while the spawn is in flight: the late copy is killed through its handle.
  const spawn = deferred<OwnedCompanionProcess>()
  const child = new FakeChild(55)
  const h = harness({ spawn: () => spawn.promise, startupBudgetMs: 20 })
  assert.equal(await h.controller.beforeLaunch(localGame('steam:1')), undefined)
  spawn.resolve(new OwnedCompanionProcess(child, 1))
  await tick(20)
  assert.equal(child.kills, 1)
  await h.controller.sessionEnded()
  assert.deepEqual(h.closed, [])
}
{ // Never-reject contract: a throwing notifier or a failing spawn still lets the game launch.
  const h = harness({ executablePath: async () => undefined, notify: () => { throw new Error('renderer gone') } })
  assert.equal(await h.controller.beforeLaunch(localGame('steam:1')), 1)
  const failing = harness({ spawn: async () => { throw Object.assign(new Error('elevation'), { code: 'EACCES' }) } })
  assert.equal(await failing.controller.beforeLaunch(localGame('steam:1')), 1)
  assert.deepEqual(failing.events, ['invalidate', 'start-failed'], 'A failed start drops the cached detection')
  const missing = harness({ executablePath: async () => undefined })
  await missing.controller.beforeLaunch(localGame('steam:1'))
  assert.deepEqual(missing.events, ['invalidate', 'missing'])
  const broken = harness({ preferences: () => { throw new Error('store') } })
  assert.equal(await broken.controller.beforeLaunch(localGame('steam:1')), undefined)
  const mac = harness({ platform: 'darwin' })
  assert.equal(await mac.controller.beforeLaunch(localGame('steam:1')), undefined)
  assert.equal(mac.spawned.length, 0)
}
{ // Quit: pending startup is invalidated and owned copies are closed, within the budget.
  const h = harness()
  await h.controller.beforeLaunch(localGame('steam:1'))
  assert.equal(h.controller.hasPendingWork(), true)
  await h.controller.shutdown(200)
  assert.deepEqual(h.closed, [1])
  assert.equal(h.controller.hasPendingWork(), false)
  const query = deferred<boolean>()
  const pending = harness({ isRunning: () => query.promise, startupBudgetMs: 1_000 })
  void pending.controller.beforeLaunch(localGame('steam:1'))
  await tick()
  const quitting = pending.controller.shutdown(100)
  query.resolve(false)
  await quitting
  assert.equal(pending.spawned.length, 0, 'A startup pending at quit never spawns')
  const stuck = harness({ close: () => new Promise(() => undefined) })
  await stuck.controller.beforeLaunch(localGame('steam:1'))
  const quitStarted = Date.now()
  await stuck.controller.shutdown(40)
  assert.ok(Date.now() - quitStarted < 200, 'Quit cleanup is bounded')
}

console.log('Lossless Scaling: defaults, per-game tri-state, eligibility, handle-based ownership, launch generations, startup budget, controller lifecycle (overlap, budget, quit, never-reject), close scripts, path validation, Steam detection and process parsing passed.')
