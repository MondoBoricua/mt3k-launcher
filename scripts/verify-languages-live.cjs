// Reuse the existing local API fixture; run the actual React views and navigation.
// Run after build: electron scripts/verify-languages-live.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { app, BrowserWindow } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'languages')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')

async function main() {
  await fs.mkdir(output, { recursive: true })
  const source = await fs.readFile(path.join(__dirname, 'verify-settings-navigation.cjs'), 'utf8')
  let fixture = source.split('const fixture = `')[1].split('\n`')[0]
  assert.ok(fixture.includes('window.settingsQA'), 'Settings fixture must be available')
  fixture = "import { GamepadKeyboard } from '@renderer/components/GamepadKeyboard'\n" + fixture
  fixture = fixture.replace('const errors = []', 'const initialLanguage = usePreferencesStore.getState().language; let failLanguageSave = false; const languageWrites = []; const errors = []')
  fixture = fixture.replace("if (name === 'settings.set') {", "if (name === 'settings.set') { if ('language' in args[0]) { languageWrites.push(args[0].language); if (failLanguageSave) return Promise.reject(new Error('Language save failed')); }")
  fixture = fixture.replace('<NotificationCenter /></>', '<NotificationCenter /><GamepadKeyboard /></>')
  fixture = fixture.replace("storeRegion: 'de'", "storeRegion: 'eu'")
  fixture += `\nwindow.languageQA = {
    initialLanguage, languageWrites,
    change: (value) => usePreferencesStore.getState().setLanguage(value),
    fail: (value) => { failLanguageSave = value },
    legacy: () => { delete settings.language },
    current: () => usePreferencesStore.getState().language,
    notifications: () => useNotificationStore.getState().items,
    theme: (theme, density) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.density = density }
  }`
  await build({ stdin: { contents: fixture, resolveDir: root, loader: 'tsx' }, bundle: true,
    outfile: path.join(output, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@renderer': path.join(root, 'src/renderer/src'), '@shared': path.join(root, 'src/shared') },
    define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.png': 'file', '.svg': 'file', '.ogg': 'file' }, logLevel: 'warning' })
  const assets = await fs.readdir(path.join(root, 'out/renderer/assets'))
  const styles = assets.filter(n => /^(index|OnboardingFlow)-.*\.css$/.test(n))
  assert.ok(styles.length >= 2, 'Build first')
  await fs.writeFile(path.join(output, 'style.css'), (await Promise.all(styles.map(n => fs.readFile(path.join(root, 'out/renderer/assets', n), 'utf8')))).join('\n'))
  await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="en" data-theme="midnight"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
  await app.whenReady()
  const win = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data):/.test(details.url) }))
  const js = async code => { try { return await win.webContents.executeJavaScript(code) } catch(error) { console.error('Command:', code); console.error(await win.webContents.executeJavaScript('settingsQA.errors')); throw error } }
  const settle = () => js('new Promise(r => setTimeout(r, 500))')
  const key = async key => { await js(`settingsQA.key(${JSON.stringify(key)})`); await settle() }
  const pad = async index => { await js(`settingsQA.button(${index}, true)`); await js('new Promise(r => setTimeout(r, 100))'); await js(`settingsQA.button(${index}, false)`); await settle() }
  const click = async id => { await js(`document.querySelector('[data-settings-section-header="${id}"]').click()`); await settle() }
  const capture = async name => fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  await win.loadFile(path.join(output, 'index.html')); await settle()
  assert.equal(await js('languageQA.initialLanguage'), 'en')
  await js('settingsQA.hydrate().then(() => null)'); await settle()
  assert.equal(await js('languageQA.current()'), 'de', 'Existing German selection survives hydration')
  await js('languageQA.legacy(); settingsQA.hydrate().then(() => null)'); await settle()
  assert.equal(await js('languageQA.current()'), 'en', 'Missing saved language defaults to English')

  await click('language')
  assert.deepEqual(await js('[...document.querySelectorAll("#settings-language-panel button")].map(e => e.textContent)'), ['English', 'Deutsch', 'Español'])
  await js('settingsQA.focus("#settings-language-panel [data-focusable]")')
  await pad(15); await pad(15); await pad(0)
  assert.equal(await js('settingsQA.state().savedLanguage'), 'es', 'Controller selects and saves Spanish')
  assert.equal(await js('document.documentElement.lang'), 'es')
  assert.ok(await js('document.body.innerText.includes("Ajustes")'))
  await pad(1)
  assert.equal(await js('settingsQA.state().focused'), 'language', 'Back restores the language topic')
  await js('settingsQA.hydrate().then(() => null)')
  assert.equal(await js('languageQA.current()'), 'es', 'Spanish survives settings reload')
  await js('languageQA.fail(true); languageQA.change("de")')
  assert.equal(await js('languageQA.current()'), 'es', 'Save failure restores confirmed language')
  assert.equal(await js('document.documentElement.lang'), 'es')
  assert.equal(await js('languageQA.notifications().at(-1).messageKey'), 'settings.saveFailed')
  await js('languageQA.fail(false); settingsQA.clearNotifications(); Promise.all([languageQA.change("de"), languageQA.change("en"), languageQA.change("es")])')
  assert.deepEqual(await js('languageQA.languageWrites.slice(-3)'), ['de','en','es'])
  assert.equal(await js('settingsQA.state().savedLanguage'), 'es')

  if (!process.argv.includes('--keyboard-only')) for (const [width, height, theme, density] of [[1280,720,'midnight','standard'],[1920,1080,'coresense','compact']]) {
    win.setContentSize(width, height)
    await js(`languageQA.theme('${theme}', '${density}')`)
    for (const page of ['appearance','experience','plus','libraries','hardware','updates','system']) {
      await js(`settingsQA.showView('settings'); settingsQA.setPage('${page}')`); await settle()
      const headers = await js('settingsQA.state().headers')
      for (const id of headers) {
        await click(id)
        assert.equal(await js(`(() => { const el = document.getElementById('settings-${id}-panel'); return el.scrollWidth <= el.clientWidth + 1 })()`), true, `${width}: ${page}/${id} fits`)
        assert.equal(await js('settingsQA.state().hiddenFocusable'), 0)
        if (['language','sound','hardware-control','orbit-updates'].includes(id)) await capture(`${id}-${width}-es`)
        await key('Escape')
        assert.equal(await js('settingsQA.state().focused'), id)
      }
      console.log(`Spanish ${page}: ${width} x ${height}, ${density} passed`)
    }
    for (const view of ['home','library','store','details','onboarding']) {
      await js(`settingsQA.showView('${view}')`); await settle()
      assert.equal(await js('document.documentElement.scrollWidth > innerWidth'), false, `${view}: no horizontal overflow`)
      if(view==='onboarding') {
        for (const language of ['en','de','es']) {
          await js(`settingsQA.focus('button[lang="${language}"]')`); await key('Enter')
          assert.equal(await js('languageQA.current()'), language)
        }
        const fits = await js('[...document.querySelectorAll(".onboarding-welcome [data-focusable]")].every(e => { const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight })')
        assert.equal(fits, true, 'Welcome language controls are visible')
      }
      await capture(`${view}-${width}-es`)
    }
  }
  win.setContentSize(1280, 720)
  await js(`(() => { const input = document.createElement('input'); input.id='spanish-input'; input.setAttribute('data-focusable',''); input.setAttribute('aria-label','Nombre'); document.body.append(input); input.focus(); window.dispatchEvent(new CustomEvent('orbit:gamepad-keyboard:open',{ detail: input })); })()`)
  await settle()
  const keyboardClick = async label => { await js(`document.querySelector('[data-gamepad-keyboard] button[aria-label=${JSON.stringify(label)}]').click()`); await settle() }
  await keyboardClick('ñ')
  await keyboardClick('Mayúsculas')
  await keyboardClick('Ñ')
  await keyboardClick('Números y símbolos')
  for (const char of ['á','é','í','ó','ú','ü','¿','¡']) await keyboardClick(char)
  assert.equal(await js('document.getElementById("spanish-input").value'), 'ñÑáéíóúü¿¡')
  await keyboardClick('Más símbolos')
  for (const char of ['Á','É','Í','Ó','Ú','Ü']) await keyboardClick(char)
  assert.equal(await js('document.getElementById("spanish-input").value'), 'ñÑáéíóúü¿¡ÁÉÍÓÚÜ')
  assert.equal(await js('[...document.querySelectorAll("[data-gamepad-keyboard] button")].every(e => { const r=e.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth })'), true, 'All Spanish symbol keys fit at 720p')
  await capture('keyboard-es')
  await key('Escape')
  assert.equal(await js('Boolean(document.querySelector("[data-gamepad-keyboard]"))'), false)
  assert.deepEqual(await js('settingsQA.errors'), [])
  await fs.writeFile(path.join(output,'result.json'), JSON.stringify({ passed:true, language:'es', viewports:[[1280,720],[1920,1080]], entries:1672, checks:['default','legacy','settings','onboarding','keyboard','controller','persistence','save-error','rapid-switch','layout'] },null,2))
  console.log('Spanish integration: defaults, all language controls, persistence, failure recovery, rapid switches, 720p/1080p views, keyboard accents, controller and back navigation passed.')
  win.destroy()
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
