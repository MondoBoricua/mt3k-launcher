// Actual provider detector, incremental reader and session manager; inert OS boundaries.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
const epoch = Date.parse('2026-09-08T10:59:00.000')
let now = epoch
const living = new Set([42])
class Clock extends Date { static now() { return now } }
class MemoryStore {
  constructor({ defaults }) { this.store = structuredClone(defaults) }
  get(key) { return this.store[key] }
}
const stubs = {
  'src/main/gameLauncher.ts': { launchGame: async () => { throw new Error('Unexpected local launch') } },
  'src/main/settingsStore.ts': { settingsStore: { store: { closeLaunchersAfterGame: true } } },
  'src/main/steam/steamGameActivity.ts': { SteamGameActivityReader: class { async getActiveGames() { return [] } } },
  'src/main/processLiveness.ts': {
    processIdStillExists: pid => living.has(pid),
    livingProcessRecords: records => records.filter(record => living.has(record.ProcessId))
  }
}
function load(relative) {
  const filename = path.resolve(root, relative)
  const key = path.relative(root, filename).replaceAll('\\', '/')
  if (stubs[key]) return stubs[key]
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const fixtureRequire = name => {
    if (name === 'electron-store') return MemoryStore
    if (name === 'electron') return { app: { on() {}, once() {} } }
    if (name === 'node:child_process') return {
      spawn() { throw new Error('Unexpected process spawn/termination') },
      execFile() { throw new Error('Unexpected OS action') }
    }
    if (name.startsWith('node:')) return require(name)
    if (name.startsWith('@shared/')) return load('src/shared/' + name.slice(8) + '.ts')
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'))
    throw new Error('Unexpected import: ' + name)
  }
  vm.runInThisContext(`(function(require,module,exports,Date,setTimeout){${output}\n})`, { filename })(
    fixtureRequire, module, module.exports, Clock,
    (callback, milliseconds) => milliseconds === 3000 ? setTimeout(callback, milliseconds) : setImmediate(callback)
  )
  return module.exports
}
const { GeForceNowStreamLogParser, GeForceNowGameActivityReader, detectGeForceNowGamePresences: detect } =
  load('src/main/geforceNow/geforceNowGameActivity.ts')
const { GameSessionManager } = load('src/main/gameSessionManager.ts')
const game = { id: 'steam:42', provider: 'steam', providerGameId: '42', name: 'Control™', installed: false, metadata: {}, local: { backupEnabled: true, savePath: 'unused' } }
const match = { gameId: game.id, geforceNowTitle: 'Control', variantId: '100', appStore: 'STEAM' }
const windowProcess = {
  ProcessId: 42, Name: 'GeForceNOW.exe', MainWindowHandle: 7,
  ExecutablePath: 'C:\\NVIDIA\\CEF\\GeForceNOW.exe', StartedAt: epoch - 30_000,
  MainWindowTitle: 'Control bei GeForce NOW', CommandLine: '--url-route=#?cmsId=100&launchSource=External'
}
const startLog = '2026-09-08 10:59:00.000 INFO  gfn/loadingUi  Successfully started streaming, exiting loading state \n'
const endLog = '2026-09-08 11:02:00.000 INFO  streamingService  Stream event {\n  "event": "STREAMING_TERMINATED",\n}\n'

function detector(overrides = {}, games = [game], matches = [match], stream = { startedAt: epoch }, preferred) {
  return detect([{ ...windowProcess, ...overrides }], games, matches, stream, preferred, now)
}

async function main() {
  assert.equal(detector().length, 1)
  assert.equal(detector({ Name: 'GeForceNOWStreamer.exe', ExecutablePath: 'C:\\NVIDIA\\GeForceNOWStreamer.exe' }).length, 1, 'Older streamer window remains supported')
  assert.equal(detector({ MainWindowTitle: "Assassin's Creed Black Flag Resynced bei GeForce NOW" },
    [{ ...game, name: "Assassin's Creed Black Flag Resynced" }],
    [{ ...match, geforceNowTitle: "Assassin's Creed Black Flag Resynced" }]).length, 1, 'Observed CEF/GeForceNOW.exe game window')
  for (const title of ['Control on GeForce NOW', 'Control en GeForce NOW', 'Control – GeForce NOW', 'Control™']) {
    assert.equal(detector({ MainWindowTitle: title }).length, 1, title)
  }
  for (const title of ['GeForce NOW', 'Control 2 bei GeForce NOW', 'Control Ultimate Edition', 'Starting Control on GeForce NOW']) {
    assert.equal(detector({ MainWindowTitle: title }).length, 0, title)
  }
  for (const name of ['GeForceNOWContainer.exe', 'chrome.exe', 'msedge.exe']) {
    assert.equal(detector({ Name: name }).length, 0, name)
  }
  assert.equal(detector({ MainWindowHandle: 0 }).length, 0)
  assert.equal(detector({ CommandLine: '--type=renderer' }).length, 0, 'CEF helper cannot become the game')
  assert.equal(detector({ ExecutablePath: 'C:\\NVIDIA\\GeForceNOWContainer.exe' }).length, 0, 'Mismatched executable is rejected')
  assert.equal(detector({ StartedAt: epoch + 10_000 }).length, 0, 'stale stream belongs to previous process')
  assert.equal(detector({ CommandLine: '--url-route=#?cmsId=999&launchSource=External' }).length, 0)
  assert.equal(detector({}, [game], [match], {}).length, 0, 'named loading/queue window is not playing')
  assert.equal(detector({}, [game], [match], { startedAt: epoch, endedAt: epoch + 1 }).length, 0)
  const duplicate = { ...game, id: 'epic:42', provider: 'epic' }
  const duplicateMatch = { ...match, gameId: duplicate.id, variantId: '101' }
  assert.equal(detector({ CommandLine: '' }, [game, duplicate], [match, duplicateMatch]).length, 0)
  assert.equal(detector({ CommandLine: '' }, [game, duplicate], [match, duplicateMatch], { startedAt: epoch }, duplicate.id)[0].game.id, duplicate.id)
  assert.equal(detector({}, [game, duplicate], [match, duplicateMatch])[0].game.id, game.id)

  const parser = new GeForceNowStreamLogParser()
  assert.deepEqual(parser.push(startLog.slice(0, 40)), {})
  assert.deepEqual(parser.push(startLog.slice(40)), { startedAt: epoch })
  assert.deepEqual(parser.push('2026-09-08 11:01:00.000 INFO other/logger irrelevant\n'), { startedAt: epoch })
  assert.deepEqual(parser.push(endLog), { startedAt: epoch, endedAt: epoch + 180_000 })
  assert.deepEqual(parser.push(endLog.replaceAll('11:02:00.000', '11:02:01.000')), { startedAt: epoch, endedAt: epoch + 180_000 })
  assert.deepEqual(parser.push(startLog.replaceAll('10:59:00.000', '11:03:00.000')), { startedAt: epoch + 240_000 })

  const directory = fs.mkdtempSync(path.join(root, '.codex-qa', 'gfn-session-reader-'))
  const logPath = path.join(directory, 'console.log')
  const rotated = path.join(directory, 'console.log.bak')
  try {
    const reader = new GeForceNowGameActivityReader(directory)
    assert.deepEqual(await reader.getStreamState(), {})
    fs.writeFileSync(logPath, startLog)
    assert.deepEqual(await reader.getStreamState(), { startedAt: epoch })
    fs.appendFileSync(logPath, endLog.slice(0, 50))
    assert.deepEqual(await reader.getStreamState(), { startedAt: epoch })
    fs.appendFileSync(logPath, endLog.slice(50))
    assert.deepEqual(await reader.getStreamState(), { startedAt: epoch, endedAt: epoch + 180_000 })
    fs.renameSync(logPath, rotated)
    assert.deepEqual(await reader.getStreamState(), { startedAt: epoch, endedAt: epoch + 180_000 })
    fs.writeFileSync(logPath, startLog.replaceAll('10:59:00.000', '11:03:00.000'))
    assert.deepEqual(await reader.getStreamState(), { startedAt: epoch + 240_000 })
    fs.writeFileSync(logPath, 'rotated\n')
    assert.deepEqual(await reader.getStreamState(), {})
    fs.writeFileSync(logPath, 'x'.repeat(600 * 1024) + '\n' + startLog)
    assert.deepEqual(await reader.getStreamState(), { startedAt: epoch })
  } finally {
    for (const file of [logPath, rotated]) if (fs.existsSync(file)) fs.unlinkSync(file)
    fs.rmdirSync(directory)
  }

  function fixture() {
    now = epoch
    living.add(42)
    const recorded = [], confirmed = [], statuses = []
    let processes = [windowProcess], stream = {}, matches = [match], missingSnapshot = false
    const callbacks = {
      onGameConfirmed: (game, detectedAt, source) => confirmed.push({ game, detectedAt, source }),
      onSessionCompleted: (game, session) => { recorded.push({ game, ...session }); return { totalPlaytimeSeconds: session.durationSeconds + 900 } },
      onGameEnded: () => { throw new Error('Cloud session must not back up local saves') }
    }
    // Install the providers after construction to keep OS process sampling inert.
    const manager = new GameSessionManager({}, callbacks)
    callbacks.getLibraryGames = () => [game]
    callbacks.getGeForceNowMatches = () => matches
    manager.getProviderPresenceSnapshot = async () => missingSnapshot ? undefined : ({ sequence: 1, capturedAt: now, processes })
    manager.geForceNowActivityReader.getStreamState = async () => ({ ...stream })
    manager.focusOrbit = async () => undefined
    manager.finishReturnFocus = async () => undefined
    manager.releaseLaunchShield = () => undefined
    manager.maintainLaunchShield = () => undefined
    manager.scheduleProviderPresencePoll = () => undefined
    manager.on('updated', status => statuses.push(status))
    const poll = () => manager.pollProviderPresence()
    return {
      manager, recorded, confirmed, statuses, poll,
      setStream: value => { stream = value }, setProcesses: value => { processes = value },
      revoke: () => { matches = [] }, missingSnapshot: value => { missingSnapshot = value },
      async start() {
        await poll()
        assert.equal(manager.getStatus().phase, 'idle', 'queue is not a session')
        now += 20_000
        stream = { startedAt: now }
        await poll()
        now += 750
        await poll()
        assert.equal(manager.getStatus().phase, 'running')
        assert.equal(manager.getStatus().gameId, game.id)
        assert.equal(manager.getStatus().trackingMethod, 'geforce-now-window')
        assert.equal(confirmed.length, 1)
        assert.equal(confirmed[0].source, 'geforce-now', 'Confirmed source reaches persistent Home history')
      }
    }
  }

  const normal = fixture()
  await normal.start()
  normal.revoke() // A confirmed session still finishes after a Plus/catalog change.
  now += 60_000
  await normal.poll()
  assert.equal(normal.manager.getStatus().phase, 'running')
  const end = now
  normal.setStream({ startedAt: epoch + 20_000, endedAt: end })
  await normal.poll()
  normal.manager.checkProviderAttachedProcessLiveness() // PID still alive must not reset the end grace.
  now += 1600
  await normal.poll()
  assert.equal(normal.manager.getStatus().phase, 'idle')
  assert.equal(normal.recorded.length, 1)
  assert.equal(normal.recorded[0].durationSeconds, 60)
  assert.equal(normal.recorded[0].endedAt, end)
  assert.ok(normal.statuses.some(status => status.phase === 'returning' && status.totalPlaytimeSeconds === 960))
  await normal.poll()
  assert.equal(normal.recorded.length, 1)
  assert.equal(normal.manager.finalizeForShutdown(), null)

  const transient = fixture()
  await transient.start()
  transient.setProcesses([{ ...windowProcess, MainWindowTitle: 'GeForce NOW' }])
  await transient.poll()
  now += 500
  transient.setProcesses([windowProcess])
  transient.setStream({}) // Log rotation preserves an already confirmed window.
  await transient.poll()
  assert.equal(transient.manager.getStatus().phase, 'running')
  transient.missingSnapshot(true)
  now += 3000
  await transient.poll()
  assert.equal(transient.manager.getStatus().phase, 'running')
  transient.missingSnapshot(false)
  transient.setProcesses([{ ...windowProcess, MainWindowTitle: 'GeForce NOW' }])
  await transient.poll()
  now += 1600
  await transient.poll()
  assert.equal(transient.recorded.length, 1, 'generic post-session title ends while PID lives')

  const manual = fixture()
  await manual.start()
  now += 10_000
  assert.equal(await manual.manager.stopTracking(), true)
  await manual.poll()
  now += 1600
  await manual.poll()
  assert.equal(manual.manager.getStatus().phase, 'idle', 'manual stop must not immediately reattach')
  assert.equal(manual.recorded.length, 1)
  assert.equal(manual.manager.finalizeForShutdown(), null)

  const shutdown = fixture()
  await shutdown.start()
  now += 10_000
  assert.equal(shutdown.manager.finalizeForShutdown().durationSeconds, 10)
  assert.equal(shutdown.manager.finalizeForShutdown(), null)

  const crash = fixture()
  await crash.start()
  now += 5000
  living.delete(42)
  crash.setProcesses([])
  await crash.poll()
  now += 1600
  await crash.poll()
  assert.equal(crash.recorded.length, 1, 'streamer crash ends the session without a log marker')

  const intent = fixture()
  const cancel = intent.manager.expectGeForceNowGame(game, match)
  assert.ok(intent.manager.geForceNowLaunchIntent)
  cancel()
  assert.equal(intent.manager.geForceNowLaunchIntent, undefined)
  await intent.start()
  assert.throws(() => intent.manager.expectGeForceNowGame(game, match), /already active/)
  intent.manager.finalizeForShutdown()

  const countdown = fixture()
  let dispatched = 0
  const launch = async () => {
    dispatched++
    countdown.manager.expectGeForceNowGame(game, match)
  }
  const cancelledStart = countdown.manager.startGeForceNow(game, launch)
  assert.equal(countdown.manager.getStatus().phase, 'launching')
  assert.equal(countdown.manager.getStatus().cancelableUntil - now, 3000)
  assert.equal(countdown.manager.getStatus().trackingMethod, 'geforce-now-window')
  assert.equal(dispatched, 0, 'Countdown runs before native dispatch')
  await assert.rejects(countdown.manager.startGeForceNow(game, launch), /already active/, 'Repeated clicks cannot start a second countdown')
  assert.equal(countdown.manager.cancelPendingLaunch(), true)
  await cancelledStart
  assert.equal(dispatched, 0, 'B/Escape cancels without opening NVIDIA')
  assert.equal(countdown.manager.geForceNowLaunchIntent, undefined)
  assert.equal(countdown.confirmed.length, 0, 'Cancel creates no played history')
  const dispatchStart = performance.now()
  await countdown.manager.startGeForceNow(game, launch)
  assert.ok(performance.now() - dispatchStart >= 2850, 'The actual three-second timer elapsed before dispatch')
  assert.equal(dispatched, 1)
  assert.ok(countdown.manager.geForceNowLaunchIntent, 'Native intent survives countdown cleanup')
  assert.equal(countdown.manager.getStatus().phase, 'idle', 'NVIDIA login/queue is not counted as playtime')
  await countdown.start()
  now += 30_000
  countdown.setStream({ startedAt: epoch + 20_000, endedAt: now })
  await countdown.poll()
  now += 1600
  await countdown.poll()
  assert.equal(countdown.recorded.length, 1, 'Countdown → stream → return completes exactly one session')
  assert.equal(countdown.confirmed[0].source, 'geforce-now')

  const rejected = fixture()
  await rejected.manager.startGeForceNow(game, async () => { throw new Error('Native spawn failed') })
  assert.ok(rejected.statuses.some(status => status.phase === 'error' && status.failureReason === 'launch-rejected'))
  assert.equal(rejected.manager.getStatus().phase, 'idle')
  assert.equal(rejected.confirmed.length, 0)
  assert.equal(rejected.recorded.length, 0)

  const { GameRepository } = load('src/main/library/gameRepository.ts')
  const { buildHomeGameEntries, homeGameKey, homeGameActivationTarget, isHomeGameRunning } = load('src/renderer/src/lib/homeGameEntries.ts')
  const repository = new GameRepository()
  repository.openProfile()
  repository.applyAuthoritativeProviderDelta('steam', [{ providerGameId: '42', appId: 42, name: 'Halo Infinite', metadata: {} }])
  repository.applyInstalledProviderDelta('steam', [{ providerGameId: '42', appId: 42, name: 'Halo Infinite', installDir: 'C:\\Games\\Halo' }])
  now += 10_000
  repository.markStarted('steam:42', now, 'local')
  const localStartedAt = now
  now += 60_000
  repository.markStarted('steam:42', now, 'geforce-now')
  const cloudStartedAt = now
  repository.recordGameSession('steam:42', 60, now + 60_000)
  assert.equal(repository.getSnapshot().games.length, 1, 'Canonical library and totals are not duplicated')
  let entries = buildHomeGameEntries(repository.getSnapshot().games)
  assert.equal(entries.length, 2)
  assert.equal(new Set(entries.map(homeGameKey)).size, 2)
  assert.deepEqual(entries.map(homeGameActivationTarget), ['geforce-now', 'default'])
  assert.equal(entries[0].lastStartedAt, cloudStartedAt)
  assert.equal(entries[1].lastStartedAt, localStartedAt, 'Cloud playtime/provider recency cannot bump the local copy')
  assert.deepEqual(entries.map(entry => isHomeGameRunning(entry, 'steam:42', 'geforce-now')), [true, false])
  const reopened = new GameRepository()
  reopened.openProfile()
  assert.deepEqual(buildHomeGameEntries(reopened.getSnapshot().games).map(homeGameKey), entries.map(homeGameKey), 'History survives repository reload/sanitization')
  now += 180_000
  reopened.markStarted('steam:42', now, 'local')
  entries = buildHomeGameEntries(reopened.getSnapshot().games)
  assert.deepEqual(entries.map(homeGameActivationTarget), ['default', 'geforce-now'])
  reopened.applyInstalledProviderDelta('steam', [])
  entries = buildHomeGameEntries(reopened.getSnapshot().games)
  assert.equal(entries.length, 1, 'Cloud history stays available after local uninstall')
  assert.equal(homeGameActivationTarget(entries[0]), 'geforce-now')
  assert.equal(buildHomeGameEntries([{ ...game, installed: true }]).length, 1, 'Legacy history stays a single ordinary card')
  assert.equal(buildHomeGameEntries([{ ...game, installed: false }]).length, 0, 'Cloud availability alone does not create played history')
  const largeLibrary = Array.from({ length: 2000 }, (_, index) => ({ ...game, id: 'steam:' + index, installed: true, lastGeForceNowStartedAt: epoch, lastLocalStartedAt: epoch - 1000 }))
  const projectionStart = performance.now()
  assert.equal(buildHomeGameEntries(largeLibrary).length, 4000)
  console.log('Home history: independent persisted sources, unchanged library counts, reload/uninstall and 2000-game projection passed (' + (performance.now() - projectionStart).toFixed(1) + ' ms).')

  console.log('GeForce NOW sessions: title/store identity, loading exclusion, lifecycle log, bounded reader, running/return status, playtime, Plus expiry, manual stop, shutdown and crash checks passed.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
