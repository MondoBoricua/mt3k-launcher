// Isolated Electron integration: no real profile, shell launch, or visible error dialog.
// Run: electron scripts/verify-diagnostic-log-live.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createRequire } = require('node:module')
const { app, dialog } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'diagnostic-log')
app.setPath('userData', path.join(output, 'profile'))
const dialogs = []
dialog.showErrorBox = (...args) => dialogs.push(args)

async function main() {
  await fs.mkdir(output, { recursive: true })
  const logPath = path.join(app.getPath('userData'), 'logs', 'mt3k-launcher.log')
  await fs.rm(logPath, { force: true })
  await build({ entryPoints: [path.join(root, 'src/main/diagnosticLogStartup.ts')],
    outfile: path.join(output, 'startup.mjs'), bundle: true, format: 'esm', platform: 'node',
    packages: 'external', alias: { '@shared': path.join(root, 'src/shared') }, logLevel: 'warning' })
  const count = process.listenerCount('uncaughtException')
  const { diagnosticLog } = await import(pathToFileURL(path.join(output, 'startup.mjs')).href)
  assert.equal(process.listenerCount('uncaughtException'), count, 'Electron exception listener count is preserved')
  await app.whenReady()
  console.warn('[app-update] warning token=test-secret')
  console.error('[test] error', new Error('test stack'))
  app.emit('render-process-gone', {}, { id: 42 }, { reason: 'crashed', exitCode: 1 })
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 2 })
  Promise.reject(new Error('test rejection'))
  process.emit('uncaughtException', new Error('test ESM startup failure'))
  setImmediate(() => { throw new Error('test uncaught') })
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50))
    await diagnosticLog.flush()
    const text = await fs.readFile(logPath, 'utf8')
    if (!text.includes('GPU') || !text.includes('guestModeEnabled') || dialogs.length !== 2) continue
    for (const expected of ['[startup] MT3K Launcher', 'Electron=', 'Chrome=', 'windowsStore=',
      'osBuild=', 'launchProfilesEnabled=', 'retroPauseMenuEnabled=', 'attractModeEnabled=',
      'captureShelfEnabled=', 'guestModeEnabled=', '[startup] GPU', '[app-update]', '[test]',
      '[render-process-gone]', '[child-process-gone]', '[unhandledRejection]', '[uncaughtException]']) {
      assert.ok(text.includes(expected), expected)
    }
    assert.ok(!text.includes('test-secret'))
    assert.ok(dialogs.some(args => /test uncaught/.test(args[1])))
    assert.ok(dialogs.some(args => /test ESM startup failure/.test(args[1])))
    assert.ok(text.includes('test ESM startup failure'))
    console.log('Electron diagnostics: startup/GPU/toggles, stderr mirroring, process events, rejection and preserved default exception dialog passed')
    return
  }
  assert.fail('Timed out waiting for diagnostics and default Electron dialog')
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
