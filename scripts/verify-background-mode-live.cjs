// Runs the actual Windows native reader and Tray lifecycle in an isolated Electron
// process. Legacy migration, settings and login-item writes use test doubles:
// this test must never change the user's autostart entries or stop their agent.
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const esbuild = createRequire(require.resolve('vite'))('esbuild')
const directory = path.resolve('.codex-qa/background-mode-test')
mkdirSync(directory, { recursive: true })

const mocks = {
  settingsStore: `const store = { language: 'en', backgroundModeEnabled: true, hardwareControlEnabled: true, hardwareControlButton: 'menu', hardwareControlHoldSeconds: 2 }; export const settingsStore = { store, get: key => store[key] }`,
  orbitBackgroundServiceManager: `export class OrbitBackgroundServiceManager { constructor() {} async control(action) { globalThis.migrations = [...(globalThis.migrations || []), action] } dispose() {} }`,
  orbitBackgroundServiceLoginItem: `export function getOrbitBackgroundServiceLoginItemInstallation() { return {installation: 'installed'} }`,
  orbitServiceProtocol: `export function orbitServicePipeNames() { return {agent: 'test'} } export async function requestOrbitPipe() { throw Error('No legacy process') }`,
  orbitWindow: `export async function revealOrbitWindow() { return true }`
}
const harness = `
const assert = require('node:assert/strict')
const {app, BrowserWindow} = require('electron')
const {OrbitBackgroundMode} = require('../../src/main/orbitBackgroundMode')
const {settingsStore} = require('../../src/main/settingsStore')
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
let login = []
app.getLoginItemSettings = () => ({launchItems:login})
app.setLoginItemSettings = (item) => { login = item.openAtLogin ? [{...item,enabled:true}] : [] }
const watchdog = setTimeout(() => app.exit(2), 15000)
app.whenReady().then(async () => {
 const window = new BrowserWindow({show:false})
 const mode = new OrbitBackgroundMode(window)
 window.once('closed', () => mode.dispose())
 mode.start(Promise.resolve())
 await mode.control('restart')
 assert.deepEqual(globalThis.migrations, ['remove'])
 assert.equal(mode.getStatus().hardwareControl.state, 'ready', JSON.stringify(mode.getStatus()))
 assert.equal(mode.getStatus().detail, undefined)
 window.close()
 assert.equal(window.isDestroyed(), false, 'Closing must retain window and controller in tray mode')
 assert.equal(window.isVisible(), false)
 await mode.prepareForAppUpdate('test')
 assert.equal(mode.getStatus().hardwareControl.state, 'disabled')
 assert.equal(window.isWindowMessageHooked(0xff), false)
 await mode.recoverFromFailedAppUpdate('test')
 assert.equal(mode.getStatus().hardwareControl.state, 'ready')
 mode.setStartWithWindows(true)
 assert.equal(mode.getStatus().startWithWindows, true)
 assert.deepEqual(login[0].args.slice(-1), ['--orbit-background'])
 mode.setStartWithWindows(false)
 assert.equal(mode.getStatus().startWithWindows, false)
 settingsStore.store.backgroundModeEnabled = false
 window.close()
 await new Promise(r => setTimeout(r, 100))
 assert.equal(window.isDestroyed(), true, 'Closing must exit when tray persistence is off')
 const second = new BrowserWindow({show:false})
 settingsStore.store.backgroundModeEnabled = true
 const next = new OrbitBackgroundMode(second)
 next.start(Promise.resolve())
 await next.control('restart')
 app.emit('before-quit', {})
 assert.equal(second.isWindowMessageHooked(0xff), false, 'Explicit quit cleans up native resources')
 second.close()
 await new Promise(r => setTimeout(r, 100))
 assert.equal(second.isDestroyed(), true, 'Explicit quit must not hide the window')
 clearTimeout(watchdog)
 console.log('PASS: real Windows Tray close/quit lifecycle, native controller update suspension/recovery; mocked legacy removal and startup settings')
 app.exit(0)
}).catch(error => {console.error(error); app.exit(1)})
`
writeFileSync(path.join(directory, 'harness.cjs'), harness)
async function run() {
  await esbuild.build({ entryPoints: [path.join(directory, 'harness.cjs')], bundle: true,
    platform: 'node', format: 'cjs', external: ['electron', 'koffi'], outfile: path.join(directory, 'test.cjs'),
    plugins: [{ name: 'isolated-system-state', setup(build) {
      build.onResolve({ filter: /\/(settingsStore|orbitBackgroundServiceManager|orbitBackgroundServiceLoginItem|orbitServiceProtocol|orbitWindow)$/ }, args => {
        const name = args.path.split('/').pop()
        return { path: name, namespace: 'mock' }
      })
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    } }] })
  await esbuild.build({ entryPoints: ['scripts/verify-native-hardware-live.ts'], bundle: true, platform: 'node',
    format: 'cjs', external: ['electron', 'koffi'], outfile: path.join(directory, 'native.cjs') })
  for (const file of ['native.cjs', 'test.cjs']) {
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [path.join(directory, file)], {env, windowsHide:true, encoding:'utf8', timeout:20000})
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status || 1)
  }
}
run().catch(error => {console.error(error); process.exit(1)})
