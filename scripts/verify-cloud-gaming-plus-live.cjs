// Offline UI fixtures using the real views, stores and controller navigation.
// Run after build: electron scripts/verify-cloud-gaming-plus-live.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { app, BrowserWindow } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'cloud-gaming-plus')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { LibraryView } from '@renderer/views/Library/LibraryView'
import { ApplicationsView } from '@renderer/views/Applications/ApplicationsView'
import { OrbitPlusPanel } from '@renderer/components/OrbitPlusPanel'
import { GameDetailPanel } from '@renderer/components/GameDetailPanel'
import { useGamepadNavigation } from '@renderer/hooks/useGamepadNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useSettingsNavigationStore } from '@renderer/state/settingsNavigationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useLibraryFilterStore } from '@renderer/state/libraryFilterStore'
import { useGeForceNowStore } from '@renderer/state/geForceNowStore'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import { focusElement, moveFocus } from '@renderer/lib/spatialNavigation'
import { pushBackHandler } from '@renderer/lib/backHandlerStack'

const calls = [], errors = [], pending = []
let catalogListener, defer = false, fail = false, listeners = 0, exited = 0
let plusListener, plusListeners = 0
const heldPlus = new Set(), pendingPlus = new Map()
const makePlusSnapshot = (access, accessUntil) => ({ access, accessUntil, connected: access !== 'locked', serviceAvailable: true, secureStorageAvailable: true, purchaseUrl: 'https://www.patreon.com/', entitlement: access === 'locked' ? undefined : { source: 'patreon', plan: 'monthly', features: ['manual-audio', 'cloud-gaming'], verifiedAt: Date.now() } })
let plusResponse = makePlusSnapshot('locked')
const game = { id: 'steam:42', provider: 'steam', providerGameId: '42', appId: 42, name: 'Cloud Test Adventure', installed: true, metadata: { genres: ['Adventure'] } }
const library = { games: [game], providerGames: [game], excludedGames: [], recentGameIds: [], loadedAt: 1, isLoadingMetadata: false }
const match = { gameId: game.id, geforceNowGameId: '59013b48-11cb-4307-8ac1-a3480a89ecb7', geforceNowTitle: game.name, cmsId: 42, variantId: '42', appStore: 'STEAM', storeId: '42' }
const catalog = { state: 'ready', matches: [match], catalogSize: 1, region: 'DE' }
const application = { id: 'launcher:geforce-now', name: 'GeForce NOW', category: 'launcher', target: 'native', available: true }
const responses = { 'applications.get': { applications: [application], platform: 'windows', scannedAt: 1 }, 'applications.launch': {}, 'geforceNow.launchGame': undefined, 'image.resolve': null, 'image.hasCustom': false, 'game.resolveTrailer': null, 'game.resolveTitleMusic': null, 'game.resolveCompletionTimes': null, 'game.resolveAchievements': null }
window.addEventListener('error', e => errors.push(e.message))
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)))
function api(parts = []) {
  return new Proxy(() => {}, {
    get: (_, key) => key === 'then' ? undefined : api([...parts, key]),
    apply: (_, __, args) => {
      const name = parts.join('.')
      if (name === 'geforceNow.onCatalogUpdated') { catalogListener = args[0]; listeners++; return () => { catalogListener = undefined; listeners-- } }
      if (name === 'orbitPlus.onStatus') { plusListener = args[0]; plusListeners++; return () => { plusListener = undefined; plusListeners-- } }
      if (parts.at(-1).startsWith('on')) return () => {}
      calls.push(name)
      if (name.startsWith('orbitPlus.')) {
        const value = name === 'orbitPlus.disconnect' ? makePlusSnapshot('locked') : plusResponse
        if (heldPlus.has(name)) return new Promise(resolve => pendingPlus.set(name, () => resolve(value)))
        return Promise.resolve(value)
      }
      if (name === 'settings.get') return Promise.resolve(usePreferencesStore.getState())
      if (name === 'geforceNow.getCatalog' || name === 'geforceNow.refreshCatalog') {
        if (defer) return new Promise(resolve => pending.push(resolve))
        if (fail) return Promise.reject(new Error('Offline fixture'))
        return Promise.resolve(catalog)
      }
      if (name in responses) return Promise.resolve(responses[name])
      errors.push('Unexpected API: ' + name)
      return Promise.resolve(null)
    }
  })
}
window.api = api()
const pad = { id: 'Xbox Controller', index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] }
Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] })
Object.defineProperty(document, 'hasFocus', { value: () => true })
usePreferencesStore.setState({ language: 'de', gameCardPrimaryAction: 'launch', uiSounds: false, gameTitleMusic: false, backgroundTrailers: false })
useLibraryStore.setState({ snapshot: library })
useLibraryFilterStore.getState().setSource('geforce-now')
useNavigationStore.setState({ mainView: 'library', phase: 'main' })
pushBackHandler(() => { exited++; useNavigationStore.getState().setMainView('library') })
let showDetails
function Fixture() {
  useGamepadNavigation()
  const view = useNavigationStore(s => s.mainView)
  const [details, setDetails] = React.useState(false)
  showDetails = setDetails
  return <main className="h-screen overflow-hidden">{details ? <GameDetailPanel game={game} /> : view === 'settings' ? <OrbitPlusPanel /> : view === 'applications' ? <ApplicationsView /> : <LibraryView />}</main>
}
createRoot(document.getElementById('root')).render(<Fixture />)
window.cloudQA = {
  calls, errors,
  init: () => useGeForceNowStore.getState().init(),
  refresh: () => useGeForceNowStore.getState().refresh(),
  dispose: () => useGeForceNowStore.getState().dispose(),
  access: (access) => { plusResponse = makePlusSnapshot(access); useOrbitPlusStore.setState({ initialized: true, snapshot: plusResponse }) },
  native: available => { responses['applications.get'].applications = available ? [application] : [] },
  plusInit: () => useOrbitPlusStore.getState().init(),
  plusRefresh: () => useOrbitPlusStore.getState().refresh(),
  plusDisconnect: () => useOrbitPlusStore.getState().disconnect(),
  plusDispose: () => useOrbitPlusStore.getState().dispose(),
  holdPlus: (method, hold) => hold ? heldPlus.add('orbitPlus.' + method) : heldPlus.delete('orbitPlus.' + method),
  resolvePlus: method => { pendingPlus.get('orbitPlus.' + method)?.(); pendingPlus.delete('orbitPlus.' + method) },
  plusExpiry: milliseconds => { plusResponse = makePlusSnapshot('active', Date.now() + milliseconds) },
  emitPlus: () => plusListener?.({ state: 'success', snapshot: makePlusSnapshot('active') }),
  plusState: () => ({ access: useOrbitPlusStore.getState().snapshot.access, connected: useOrbitPlusStore.getState().snapshot.connected, listeners: plusListeners }),
  deferred: value => { defer = value }, failed: value => { fail = value },
  resolve: () => { pending.splice(0).forEach(resolve => resolve(catalog)) },
  emit: () => catalogListener?.(catalog),
  language: language => usePreferencesStore.setState({ language }),
  view: view => useNavigationStore.getState().setMainView(view),
  details: value => showDetails(value),
  source: source => useLibraryFilterStore.getState().setSource(source),
  focus: selector => focusElement(document.querySelector(selector)), move: moveFocus,
  button: (index, pressed) => { pad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 } },
  state: () => ({ matches: Object.keys(useGeForceNowStore.getState().matchesByGameId).length, catalog: useGeForceNowStore.getState().snapshot.state, refreshing: useGeForceNowStore.getState().isRefreshing, view: useNavigationStore.getState().mainView, page: useSettingsNavigationStore.getState().page, listeners, exited, overflow: document.documentElement.scrollWidth > innerWidth })
}
`

async function main() {
  await fs.mkdir(output, { recursive: true })
  const assets = await fs.readdir(path.join(root, 'out/renderer/assets'))
  const css = assets.find(name => /^index-.*\.css$/.test(name))
  assert.ok(css, 'Run build first')
  await build({ stdin: { contents: fixture, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(output, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@renderer': path.join(root, 'src/renderer/src'), '@shared': path.join(root, 'src/shared') }, define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.png': 'file', '.svg': 'file', '.ogg': 'file' }, logLevel: 'warning' })
  await fs.copyFile(path.join(root, 'out/renderer/assets', css), path.join(output, 'style.css'))
  await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html data-theme="midnight"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
  await app.whenReady()
  const window = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } })
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') }))
  const js = code => window.webContents.executeJavaScript(code)
  const settle = () => js('new Promise(resolve => setTimeout(resolve, 350))')
  const state = () => js('cloudQA.state()')
  const button = async index => { await js(`cloudQA.button(${index}, true)`); await js('new Promise(resolve => setTimeout(resolve, 90))'); await js(`cloudQA.button(${index}, false)`); await settle() }
  const screenshot = async name => fs.writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG())
  // 1920x1200 handheld at 100%, 125%, 150% and 200% display scaling.
  // Also cover enlarged ORBIT text independently of Windows display scaling.
  const layouts = [
    [1280, 720, 'de', 'midnight', 'comfortable', 100],
    [1920, 1080, 'en', 'coresense', 'compact', 100],
    [1920, 1200, 'de', 'midnight', 'comfortable', 100],
    [1536, 960, 'es', 'coresense', 'compact', 150],
    [1280, 800, 'de', 'midnight', 'comfortable', 150],
    [960, 600, 'es', 'coresense', 'compact', 150]
  ]
  const compactPanel = async selector => {
    const layout = await js(`(() => {
      const panel = document.querySelector('${selector}'); const r = panel.getBoundingClientRect();
      const contained = c => c.left >= r.left - 1 && c.right <= r.right + 1 && c.top >= r.top - 1 && c.bottom <= r.bottom + 1;
      const contentFits = [...panel.querySelectorAll('h1, p, button')].every(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        return contained(element.getBoundingClientRect()) && [...range.getClientRects()].every(contained);
      });
      return { height: r.height, visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        contentFits, overflow: panel.scrollWidth > panel.clientWidth + 1 || panel.scrollHeight > panel.clientHeight + 1 };
    })()`)
    assert.equal(layout.visible, true, 'Cloud toolbar is fully visible')
    assert.equal(layout.contentFits, true, 'Cloud text, icons and actions are not clipped')
    assert.equal(layout.overflow, false, 'Cloud toolbar does not overflow')
    assert.ok(layout.height <= 100, `Cloud toolbar stays compact (${layout.height}px)`)
    assert.equal((await state()).overflow, false)
  }
  const checkLayouts = async (selector, prefix) => {
    for (const [width, height, language, theme, density, textScale] of layouts) {
      window.setContentSize(width, height)
      await js(`cloudQA.language('${language}'); document.documentElement.dataset.theme = '${theme}'; document.documentElement.dataset.density = '${density}'; document.documentElement.style.setProperty('--orbit-text-scale', '${textScale / 100}'); document.documentElement.dataset.textEnlarged = '${textScale > 100}'`)
      await settle()
      await compactPanel(selector)
      await screenshot(`${prefix}-${width}x${height}-${language}-text${textScale}`)
    }
    window.setContentSize(1920, 1080)
    await js(`cloudQA.language('de'); document.documentElement.dataset.theme = 'midnight'; document.documentElement.dataset.density = 'comfortable'; document.documentElement.style.setProperty('--orbit-text-scale', '1'); document.documentElement.dataset.textEnlarged = 'false'`)
    await settle()
  }
  try {
    await window.loadFile(path.join(output, 'index.html'))
    await settle()
    await js('cloudQA.init()')
    assert.equal(await js('cloudQA.calls.includes("geforceNow.getCatalog")'), false, 'Locked boot skips cloud requests')
    assert.equal(await js('Boolean(document.querySelector("[data-cloud-gaming-locked]"))'), true)
    assert.equal(await js('Boolean(document.querySelector("[data-library-source=geforce-now] .lucide-sparkles"))'), true, 'Locked tab uses the sparkle icon')
    assert.equal(await js('document.querySelector("[data-library-source=geforce-now]").textContent.includes("PLUS")'), false, 'No PLUS text in the tab')
    assert.equal(await js('document.querySelector("[data-cloud-gaming-locked]").textContent.toUpperCase().includes("PLUS")'), false, 'Locked toolbar uses the symbol without PLUS text')
    await checkLayouts('[data-cloud-gaming-locked]', 'compact-locked')
    for (const [width, height, language, theme, density] of [[1280, 720, 'de', 'midnight', 'comfortable'], [1280, 720, 'en', 'coresense', 'compact'], [1920, 1080, 'de', 'midnight', 'comfortable'], [1920, 1080, 'es', 'coresense', 'compact']]) {
      window.setContentSize(width, height)
      await js(`cloudQA.language('${language}'); document.documentElement.dataset.theme = '${theme}'; document.documentElement.dataset.density = '${density}'`)
      await settle()
      assert.equal((await state()).overflow, false)
      assert.equal(await js(`(() => { const r = document.querySelector('[data-cloud-gaming-locked]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })()`), true, 'Whole locked panel fits')
      await screenshot(`locked-${width}-${language}-${density}`)
    }
    await js('cloudQA.focus("[data-library-source=geforce-now]")')
    await button(13)
    assert.equal(await js('document.activeElement.hasAttribute("data-cloud-gaming-unlock")'), true, 'D-pad reaches the upgrade action directly')
    await button(0)
    assert.equal((await state()).view, 'settings', 'Controller A opens Plus')
    assert.equal((await state()).page, 'plus')
    await button(1)
    assert.equal((await state()).view, 'library', 'Controller B returns')
    await js('cloudQA.focus("[data-cloud-gaming-unlock]")')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await settle()
    assert.equal((await state()).view, 'settings', 'Enter opens Plus')
    await js('cloudQA.view("applications")')
    await settle()
    await js('document.querySelector("[data-application-nav-item]").click()')
    assert.equal((await state()).view, 'settings', 'Locked native app routes to Plus')
    assert.equal(await js('cloudQA.calls.includes("applications.launch")'), false)
    await js('cloudQA.view("library"); cloudQA.access("active")')
    await settle()
    assert.equal((await state()).matches, 1)
    assert.equal(await js('Boolean(document.querySelector("[data-library-source=geforce-now] .lucide-sparkles"))'), false, 'Paid membership hides the sparkle icon')
    assert.equal(await js('Boolean(document.querySelector("[data-game-card]"))'), true)
    await checkLayouts('[data-geforce-now-panel]', 'compact-native')
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-panel] .lucide-sparkles"))'), false)
    await js('cloudQA.focus("[data-geforce-now-panel] button[data-view-entry]")')
    await button(0)
    assert.equal(await js('cloudQA.calls.includes("applications.launch")'), true, 'Controller A opens the installed app from the compact toolbar')
    await screenshot('active-1920')
    await js('document.querySelector("[data-game-card]").click()')
    await settle()
    assert.equal(await js('cloudQA.calls.includes("geforceNow.launchGame")'), true, 'Active Plus launches cloud game')
    await js('cloudQA.details(true)')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-game-launch]"))'), true, 'Details offer cloud play')
    await js('cloudQA.focus("[data-geforce-now-game-launch]")')
    await js('cloudQA.access("locked")')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-game-launch]"))'), false, 'Revocation removes detail action')
    assert.equal(await js('document.activeElement !== document.body && document.activeElement.hasAttribute("data-focusable")'), true, 'Revocation restores focus in details')
    await js('cloudQA.details(false)')
    await settle()
    assert.equal((await state()).matches, 0)
    await js('cloudQA.emit()')
    assert.equal((await state()).matches, 0, 'Late catalog events cannot restore locked matches')
    await js('cloudQA.deferred(true); cloudQA.access("active")')
    await settle()
    await js('cloudQA.access("locked"); cloudQA.resolve()')
    await settle()
    assert.equal((await state()).matches, 0, 'Pending load cannot restore revoked access')
    await js('cloudQA.deferred(false); cloudQA.access("grace")')
    await settle()
    assert.equal((await state()).matches, 1, 'Valid grace unlocks cloud features')
    await js('cloudQA.failed(true); cloudQA.refresh()')
    assert.equal((await state()).catalog, 'stale', 'Refresh errors retain an accessible cache')
    await js('cloudQA.deferred(true); void cloudQA.refresh()')
    await js('cloudQA.access("locked"); cloudQA.resolve()')
    await settle()
    assert.equal((await state()).matches, 0, 'Pending refresh cannot restore revoked access')
    assert.equal((await state()).refreshing, false)
    await js('cloudQA.source("all")')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-game-card]"))'), true, 'Free local library stays available')
    // Exercise the real Plus store, including delayed IPC responses and expiry.
    await js('cloudQA.deferred(false); cloudQA.failed(false); cloudQA.native(false); cloudQA.source("geforce-now"); cloudQA.access("active"); cloudQA.plusInit()')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-refresh]"))'), true, 'Catalog retry is available without native GFN')
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-native-launcher]"))'), false)
    await js('cloudQA.failed(true); cloudQA.refresh()')
    await settle()
    assert.equal((await state()).catalog, 'stale')
    window.setContentSize(1280, 800)
    await js(`document.documentElement.style.setProperty('--orbit-text-scale', '1.5')`)
    await settle()
    await compactPanel('[data-geforce-now-panel]')
    await screenshot('compact-stale-1280x800-text150')
    await js('cloudQA.failed(false); document.querySelector("[data-geforce-now-refresh]").click()')
    await settle()
    assert.equal((await state()).catalog, 'ready', 'Catalog retry recovers without native GFN')
    await checkLayouts('[data-geforce-now-panel]', 'compact-browser')
    await js('cloudQA.focus("[data-geforce-now-refresh]")')
    const refreshCalls = await js('cloudQA.calls.filter(name => name === "geforceNow.refreshCatalog").length')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await settle()
    assert.ok(await js('cloudQA.calls.filter(name => name === "geforceNow.refreshCatalog").length') > refreshCalls, 'Enter refreshes the catalog from the compact toolbar')
    await screenshot('without-native-1920')
    window.setContentSize(1280, 720)
    await js('cloudQA.language("de")')
    await settle()
    assert.equal(await js(`(() => { const r = document.querySelector('[data-geforce-now-panel]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })()`), true, 'Catalog panel fits 720p without the native app')
    assert.equal(await js(`(() => { const panel = document.querySelector('[data-geforce-now-panel]'); const r = panel.getBoundingClientRect(); return panel.scrollHeight <= panel.clientHeight + 1 && [...panel.querySelectorAll('h1, p, button')].every(e => { const c = e.getBoundingClientRect(); return c.top >= r.top && c.bottom <= r.bottom }) })()`), true, 'Panel content and retry button are not clipped at 720p')
    await screenshot('without-native-1280')
    await js('cloudQA.holdPlus("refresh", true); void cloudQA.plusRefresh()')
    await js('cloudQA.holdPlus("disconnect", true); void cloudQA.plusDisconnect()')
    assert.equal((await state()).matches, 0, 'Disconnect clears cloud matches before IPC returns')
    await js('cloudQA.resolvePlus("refresh"); cloudQA.emitPlus()')
    await settle()
    assert.equal((await state()).matches, 0, 'Stale membership response or event cannot restore access')
    await js('cloudQA.resolvePlus("disconnect"); cloudQA.holdPlus("disconnect", false); cloudQA.holdPlus("refresh", false)')
    await settle()
    await js('cloudQA.plusExpiry(1000); cloudQA.plusInit()')
    await settle()
    assert.equal((await state()).matches, 1)
    await js('cloudQA.focus("[data-game-card]")')
    await js('new Promise(resolve => setTimeout(resolve, 1100))')
    assert.equal((await state()).matches, 0, 'Deadline clears matches without another IPC update')
    assert.equal(await js('cloudQA.plusState().access'), 'locked')
    assert.equal(await js('Boolean(document.querySelector("[data-library-source=geforce-now] .lucide-sparkles"))'), true, 'Expiry restores the sparkle icon')
    assert.equal(await js('document.activeElement !== document.body'), true, 'Expiry preserves focus')
    await js('cloudQA.holdPlus("get", true); cloudQA.plusExpiry(10000); void cloudQA.plusInit()')
    await js('cloudQA.plusDispose(); cloudQA.resolvePlus("get")')
    await settle()
    assert.equal(await js('cloudQA.plusState().access'), 'locked', 'Disposed store ignores pending init')
    assert.equal(await js('cloudQA.plusState().listeners'), 0, 'Plus subscriptions are cleaned up')
    await js('cloudQA.dispose()')
    assert.equal((await state()).listeners, 0, 'Catalog listener is cleaned up')
    assert.deepEqual(await js('cloudQA.errors'), [])
    console.log('Cloud Plus UI: compact locked/native/browser toolbars, 1200p at 100–200% display scaling, 150% text, 720p/1080p, DE/EN/ES, keyboard/controller, expiry and request cleanup passed.')
  } catch (error) {
    console.error('Renderer errors:', await js('cloudQA?.errors'))
    await screenshot('failure')
    throw error
  } finally { window.destroy() }
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
