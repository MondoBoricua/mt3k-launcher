// Execute the actual main services with in-memory storage and inert OS/network
// boundaries. No user account, browser, native app or network request is used.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
const counters = { fetch: 0, spawn: 0, external: 0, scan: 0 }
const game = { id: 'steam:42', provider: 'steam', providerGameId: '42', appId: 42, metadata: {} }
const application = { id: 'launcher:geforce-now', name: 'GeForce NOW', target: 'native', available: true }
const fakeWindow = { isDestroyed: () => false, minimize() {}, hide() {} }
const gameId = '59013b48-11cb-4307-8ac1-a3480a89ecb7'
class MemoryStore {
  constructor(options) { this.store = { ...options.defaults } }
  get(key) { return this.store[key] }
  set(key, value) { this.store[key] = value }
  delete(key) { delete this.store[key] }
}
class Controller { async start() { return true } dispose() {} }
const stubs = {
  electron: {
    app: { isPackaged: false, getAppPath: () => root, getPath: () => path.join(root, '.codex-qa'), getVersion: () => 'test' },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    shell: { openExternal: async () => { counters.external++ } }, BrowserWindow: class {}, dialog: {}
  },
  'electron-store': MemoryStore,
  'node:fs': { ...fs, existsSync: () => true, readdirSync: () => [] },
  'node:child_process': {
    execFile: () => { throw new Error('Unexpected process inspection') },
    spawn: () => {
      counters.spawn++
      const child = new EventEmitter()
      Object.assign(child, { pid: 1, exitCode: null, unref() {}, kill() { child.exitCode = 0; child.emit('exit', 0); return true } })
      process.nextTick(() => child.emit('spawn'))
      return child
    }
  }
}
const localStubs = {
  'src/main/networkFetch.ts': { fetchWithElectronNet: async () => {
    counters.fetch++
    return new Response(JSON.stringify({ data: { apps: { numberReturned: 1, pageInfo: { hasNextPage: false }, items: [{ id: gameId, cmsId: 42, title: 'Cloud Test', variants: [{ id: '42', appStore: 'STEAM', storeId: '42' }] }] } } }), { status: 200 })
  } },
  'src/main/settingsStore.ts': { settingsStore: { get: key => key === 'language' ? 'de' : undefined, store: {} } },
  'src/main/mediaControllerBridge.ts': { MediaControllerBridge: Controller },
  'src/main/externalWindowActivation.ts': { activateExternalProcessWindow: async () => true },
  'src/main/orbitWindow.ts': { revealOrbitWindow() {} },
  'src/main/i18n.ts': { t: key => key },
  'src/main/playstation/remotePlay.ts': { playStationRemotePlayService: {} },
  'src/main/netflixMediaService.ts': { netflixMediaService: {} }
}
function load(relative) {
  const filename = path.resolve(root, relative)
  const key = path.relative(root, filename).replaceAll('\\', '/')
  if (key in localStubs) return localStubs[key]
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const requireFixture = name => {
    if (name in stubs) return stubs[name]
    if (name.startsWith('node:')) return require(name)
    if (name.startsWith('@shared/')) return load('src/shared/' + name.slice(8) + '.ts')
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'))
    throw new Error('Unexpected dependency: ' + name)
  }
  vm.runInThisContext(`(function(require, module, exports) { ${output}\n})`, { filename })(requireFixture, module, module.exports)
  return module.exports
}

async function main() {
  const { orbitPlusService: plus, OrbitPlusService } = load('src/main/orbitPlus/orbitPlusService.ts')
  const { geForceNowCatalogService: catalog } = load('src/main/geforceNow/geforceNowCatalogService.ts')
  const { geForceNowWebService: web } = load('src/main/geforceNow/geforceNowWebService.ts')
  const { applicationService: apps } = load('src/main/applicationService.ts')
  let now = Date.now()
  plus.dependencies.now = () => now
  plus.sessionLoaded = true
  const grant = () => {
    plus.session = { sessionToken: 'fixture', checkedAt: now, entitlement: { source: 'patreon', plan: 'monthly', features: ['manual-audio', 'cloud-gaming'], verifiedAt: now, expiresAt: now + 86400000, offlineUntil: now + 3600000 } }
  }
  const blocked = /ORBIT Plus required: cloud-gaming/
  assert.equal(catalog.getSnapshot([game]).state, 'locked')
  assert.equal(catalog.matchGame(game), null)
  catalog.refreshIfStale()
  await assert.rejects(catalog.refresh(true), blocked)
  await assert.rejects(web.launch(fakeWindow), blocked)
  await assert.rejects(web.launchInBrowser(), blocked)
  await assert.rejects(apps.launch(application.id, fakeWindow), blocked)
  assert.deepEqual(counters, { fetch: 0, spawn: 0, external: 0, scan: 0 }, 'Locked calls have no side effects')

  grant()
  await catalog.refresh(true)
  assert.equal(catalog.getSnapshot([game]).matches.length, 1)
  assert.equal(catalog.matchGame(game).geforceNowGameId, gameId)
  let accessChecks = 0
  const hasFeature = plus.hasFeature.bind(plus)
  plus.hasFeature = feature => { accessChecks++; return hasFeature(feature) }
  const matchStarted = performance.now()
  assert.equal(catalog.getSnapshot(Array.from({ length: 2000 }, () => game)).matches.length, 2000)
  const matchDuration = performance.now() - matchStarted
  assert.equal(accessChecks, 1, 'Library matching performs one entitlement lookup per snapshot')
  plus.hasFeature = hasFeature
  await web.launchInBrowser()
  assert.equal(counters.external, 1)
  await assert.rejects(web.launchInBrowser('https://example.com'), /Invalid GeForce NOW/)
  assert.equal(counters.external, 1, 'Plus does not relax allowed launch URLs')
  assert.equal(await web.launch(fakeWindow), 'active')
  web.dispose()
  apps.getSnapshot = async () => { counters.scan++; return { applications: [application] } }
  apps.nativeTargets.set(application.id, { executablePath: 'C:\\fixture\\GeForceNOW.exe', arguments: [] })
  await apps.launch(application.id, fakeWindow)
  assert.equal(counters.spawn, 2, 'Both cloud browser and native app launch with Plus')

  // Access may expire while the native application snapshot is being loaded.
  apps.getSnapshot = async () => { plus.session = undefined; return { applications: [application] } }
  await assert.rejects(apps.launch(application.id, fakeWindow), blocked)
  assert.equal(counters.spawn, 2, 'Native launch rechecks after asynchronous discovery')
  assert.equal(catalog.getSnapshot([game]).matches.length, 0, 'Revocation hides cached cloud matches')
  assert.equal(catalog.matchGame(game), null)
  await assert.rejects(web.launch(fakeWindow), blocked)

  grant()
  now += 25 * 60000
  assert.equal(plus.getSnapshot().access, 'grace')
  assert.doesNotThrow(() => plus.requireFeature('cloud-gaming'))
  now += 60 * 60000
  assert.equal(plus.getSnapshot().access, 'locked')
  assert.throws(() => plus.requireFeature('cloud-gaming'), blocked)
  await assert.rejects(catalog.refresh(true), blocked)
  assert.equal(counters.fetch, 1, 'Expired access cannot refresh the catalog')
  // The network fixture deliberately ignores abort to model responses already
  // queued when a user disconnects or starts another membership operation.
  grant()
  let completeRefresh
  const entitlement = plus.session.entitlement
  plus.dependencies.fetch = async (_url, init) => init.method === 'DELETE'
    ? new Response(null, { status: 204 })
    : new Promise(resolve => { completeRefresh = resolve })
  const pendingRefresh = plus.refresh()
  await plus.disconnect()
  completeRefresh(new Response(JSON.stringify({ entitlement }), { status: 200 }))
  await pendingRefresh
  assert.equal(plus.getSnapshot().connected, false, 'Late refresh cannot reconnect after disconnect')
  assert.equal(plus.hasFeature('cloud-gaming'), false, 'Late refresh cannot restore cloud access')
  const deferred = () => {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
  }
  const response = body => new Response(JSON.stringify(body), { status: 200 })
  const newMember = fetch => {
    const member = new OrbitPlusService({ fetch, now: () => now, delay: async () => {} })
    member.sessionLoaded = true
    member.session = { sessionToken: 'fixture', checkedAt: now, entitlement, ownerTestAccess: { available: true, enabled: true } }
    return member
  }
  const delayedDelete = deferred()
  const member = newMember(async () => delayedDelete.promise)
  const disconnecting = member.disconnect()
  assert.equal(member.hasFeature('cloud-gaming'), false, 'Disconnect locks before server response')
  delayedDelete.resolve(new Response(null, { status: 204 }))
  await disconnecting

  const olderRefresh = deferred(), ownerUpdate = deferred()
  const owner = newMember(async (_url, init) => init.method === 'PUT' ? ownerUpdate.promise : olderRefresh.promise)
  const oldRefresh = owner.refresh()
  const disabling = owner.setOwnerTestAccess(false)
  ownerUpdate.resolve(response({ entitlement, ownerTestAccess: { available: true, enabled: false } }))
  await disabling
  assert.equal(owner.hasFeature('cloud-gaming'), false, 'Owner disable wins even if a response contains an entitlement')
  olderRefresh.resolve(response({ entitlement, ownerTestAccess: { available: true, enabled: true } }))
  await oldRefresh
  assert.equal(owner.hasFeature('cloud-gaming'), false, 'Old refresh cannot override owner disable')

  let opened = 0
  const startReply = deferred()
  const signIn = new OrbitPlusService({ fetch: async () => startReply.promise, now: () => now, delay: async () => {}, openExternal: async () => { opened++ } })
  signIn.sessionLoaded = true
  const statuses = []
  const start = signIn.startPatreonConnection(status => statuses.push(status.state))
  signIn.cancelPatreonConnection()
  const startBody = { sessionId: 'fixture-session', authorizationUrl: 'https://www.patreon.com/authorize', expiresAt: now + 60_000, pollIntervalMs: 1000 }
  startReply.resolve(new Response(JSON.stringify(startBody), { status: 201 }))
  await start
  assert.equal(opened, 0, 'Cancelled start cannot open a late browser')
  assert.deepEqual(statuses, ['opening-browser'], 'Obsolete sign-in sends no later status')

  const pollReply = deferred()
  const signInPoll = new OrbitPlusService({ fetch: async (_url, init) => init.method === 'POST' ? new Response(JSON.stringify(startBody), { status: 201 }) : pollReply.promise, now: () => now, delay: async () => {}, openExternal: async () => {} })
  signInPoll.sessionLoaded = true
  const polling = signInPoll.startPatreonConnection(() => {})
  await new Promise(setImmediate)
  signInPoll.cancelPatreonConnection()
  const replacementStart = deferred()
  signInPoll.dependencies.fetch = async () => replacementStart.promise
  const replacement = signInPoll.startPatreonConnection(() => {})
  pollReply.resolve(response({ state: 'complete', sessionToken: 'stale-token', entitlement }))
  await polling
  assert.equal(signInPoll.getSnapshot().connected, false, 'Cancelled poll cannot save a session')
  assert.equal(signInPoll.connectionRunning, true, 'Old cleanup cannot end the replacement connection')
  signInPoll.cancelPatreonConnection()
  replacementStart.resolve(new Response(JSON.stringify(startBody), { status: 201 }))
  await replacement

  const completedStates = []
  const connected = new OrbitPlusService({
    fetch: async (_url, init) => init.method === 'POST'
      ? new Response(JSON.stringify(startBody), { status: 201 })
      : response({ state: 'complete', sessionToken: 'verified-fixture', entitlement: { ...entitlement, features: ['manual-audio'] } }),
    now: () => now, delay: async () => {}, openExternal: async () => {}
  })
  connected.sessionLoaded = true
  await connected.startPatreonConnection(status => completedStates.push(status.state))
  assert.deepEqual(completedStates, ['opening-browser', 'waiting-for-browser', 'success'])
  assert.equal(connected.hasFeature('cloud-gaming'), true, 'Successful legacy Plus sign-in still unlocks cloud gaming')
  assert.equal(connected.getSnapshot().accessUntil, entitlement.offlineUntil)
  connected.dependencies.fetch = async () => { throw new Error('Offline fixture') }
  assert.equal((await connected.refresh()).access, 'active', 'Transient failure retains a valid verified grant')
  assert.equal(connected.getSnapshot().accessUntil, entitlement.offlineUntil, 'Network failure never extends access')

  grant()
  const beforeDispose = catalog.getSnapshot([game]).updatedAt
  let updates = 0
  catalog.on('updated', () => updates++)
  const lateCatalog = deferred()
  localStubs['src/main/networkFetch.ts'].fetchWithElectronNet = async () => lateCatalog.promise
  const loadingCatalog = catalog.refresh(true)
  catalog.dispose()
  const updatesAtDispose = updates
  lateCatalog.resolve(response({ data: { apps: { numberReturned: 1, pageInfo: { hasNextPage: false }, items: [{ id: gameId, cmsId: 42, title: 'Late catalog', variants: [{ id: '42', appStore: 'STEAM', storeId: '42' }] }] } } }))
  await loadingCatalog
  assert.equal(updates, updatesAtDispose, 'Disposed catalog emits no late updates')
  assert.equal(catalog.getSnapshot([game]).updatedAt, beforeDispose, 'Disposed catalog keeps the last valid cache')
  assert.equal(catalog.matchGame(game).geforceNowTitle, 'Cloud Test')
  console.log(`Cloud Plus main: access/expiry, native/browser gates, immediate disconnect, stale refresh/owner/auth responses, cancellation, cleanup and URL checks passed. 2000 matches: ${matchDuration.toFixed(1)} ms, one entitlement lookup.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
