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
import { HomeView } from '@renderer/views/Home/HomeView'
import { ApplicationsView } from '@renderer/views/Applications/ApplicationsView'
import { OrbitPlusPanel } from '@renderer/components/OrbitPlusPanel'
import { GameDetailPanel } from '@renderer/components/GameDetailPanel'
import { RunningGameProvider } from '@renderer/state/runningGameContext'
import { SessionSummaryToast } from '@renderer/components/SessionSummaryToast'
import { GameLaunchSplash } from '@renderer/components/GameLaunchSplash'
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
const focusEvents = []
document.addEventListener('focusin', event => focusEvents.push(event.target?.dataset?.gameActivationTarget ?? 'other'))
const savedSettings = { geForceNowLaunchMode: 'web' }, launchModes = [], settingsPending = []
let settingsFail = false, settingsHold = false
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
const responses = { 'applications.get': { applications: [application], platform: 'windows', scannedAt: 1 }, 'applications.launch': {}, 'geforceNow.isNativeAvailable': true, 'geforceNow.launchGame': undefined, 'image.resolve': null, 'image.hasCustom': false, 'game.resolveTrailer': null, 'game.resolveTitleMusic': null, 'game.resolveCompletionTimes': null, 'game.resolveAchievements': null, 'profileAvatar.getCustom': null, 'startupVideo.get': null, 'homeWallpaper.get': null, 'launcherMusic.getCustom': null, 'uiAudio.getCustom': {} }
responses['game.launch'] = undefined
responses['store.search'] = { products: [], query: '', total: 0 }
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
      if (name === 'settings.get') return Promise.resolve({ ...usePreferencesStore.getState(), ...savedSettings })
      if (name === 'settings.set') {
        if (settingsFail) return Promise.reject(new Error('Settings save fixture failed'))
        const complete = () => { Object.assign(savedSettings, args[0]); return { ...usePreferencesStore.getState(), ...savedSettings } }
        if (settingsHold) return new Promise(resolve => settingsPending.push(() => resolve(complete())))
        return Promise.resolve(complete())
      }
      if (name === 'geforceNow.launchGame') launchModes.push(savedSettings.geForceNowLaunchMode)
      if (name === 'game.cancelLaunch') { setSession({ phase: 'idle' }); return Promise.resolve(true) }
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
let showDetails, setSession
function Fixture() {
  useGamepadNavigation()
  const view = useNavigationStore(s => s.mainView)
  const [details, setDetails] = React.useState(false)
  const [session, updateSession] = React.useState({ phase: 'idle' })
  setSession = updateSession
  showDetails = setDetails
  return <RunningGameProvider gameId={session.phase === 'running' ? session.gameId : undefined} source="geforce-now"><main className="h-screen overflow-hidden">{details ? <GameDetailPanel game={game} /> : view === 'home' ? <HomeView /> : view === 'settings' ? <OrbitPlusPanel /> : view === 'applications' ? <ApplicationsView /> : <LibraryView />}{session.phase === 'returning' && <SessionSummaryToast status={session} visibleSeconds={60} />}{session.phase === 'launching' && <GameLaunchSplash status={session} />}</main></RunningGameProvider>
}
createRoot(document.getElementById('root')).render(<Fixture />)
window.cloudQA = {
  calls, errors, focusEvents,
  home: (layout, installed = true) => {
    const played = { ...game, installed, lastLocalStartedAt: Date.now() - 120_000, lastGeForceNowStartedAt: Date.now(), lastStartedAt: Date.now() }
    usePreferencesStore.setState({ homeLayout: layout, showHomeBanners: false, showAchievements: false })
    useLibraryStore.setState({ snapshot: { ...library, games: [played], providerGames: [played] } })
    showDetails(false)
    useNavigationStore.getState().setMainView('home')
  },
  library: () => { useLibraryStore.setState({ snapshot: library }); useNavigationStore.getState().setMainView('library') },
  session: phase => setSession({ phase, gameId: game.id, gameName: game.name, provider: game.provider, trackingMethod: 'geforce-now-window', detectedAt: Date.now() - 180_000, sessionDurationSeconds: 180, totalPlaytimeSeconds: 900 }),
  countdown: () => setSession({ phase: 'launching', gameId: game.id, gameName: game.name, provider: game.provider, trackingMethod: 'geforce-now-window', requestedAt: Date.now(), cancelableUntil: Date.now() + 3000 }),
  init: () => useGeForceNowStore.getState().init(),
  refresh: () => useGeForceNowStore.getState().refresh(),
  dispose: () => useGeForceNowStore.getState().dispose(),
  access: (access) => { plusResponse = makePlusSnapshot(access); useOrbitPlusStore.setState({ initialized: true, snapshot: plusResponse }) },
  native: available => { responses['applications.get'].applications = available ? [application] : []; responses['geforceNow.isNativeAvailable'] = available },
  savedMode: () => savedSettings.geForceNowLaunchMode, launchModes,
  failSettings: value => { settingsFail = value },
  holdSettings: value => { settingsHold = value },
  resolveSettings: () => settingsPending.splice(0).forEach(resolve => resolve()),
  hydratePreferences: () => { usePreferencesStore.setState({ geForceNowLaunchMode: 'web' }); return usePreferencesStore.getState().hydrate().then(() => {}) },
  plusInit: () => useOrbitPlusStore.getState().init(),
  plusRefresh: () => useOrbitPlusStore.getState().refresh(),
  plusDisconnect: () => useOrbitPlusStore.getState().disconnect(),
  plusDispose: () => useOrbitPlusStore.getState().dispose(),
  holdPlus: (method, hold) => hold ? heldPlus.add('orbitPlus.' + method) : heldPlus.delete('orbitPlus.' + method),
  resolvePlus: method => { pendingPlus.get('orbitPlus.' + method)?.(); pendingPlus.delete('orbitPlus.' + method) },
  plusExpiry: milliseconds => { plusResponse = makePlusSnapshot('active', Date.now() + milliseconds) },
  plusLicensed: () => {
    const now = Date.now()
    plusResponse = {
      ...makePlusSnapshot('active', now + 60_000),
      activeSources: ['patreon', 'lifetime-key'],
      license: { state: 'active', configured: true, plan: 'lifetime', checkedAt: now, offlineAccessUntil: now + 60_000 }
    }
    useOrbitPlusStore.setState({ initialized: true, snapshot: plusResponse })
  },
  emitPlus: () => plusListener?.({ state: 'success', snapshot: makePlusSnapshot('active') }),
  plusState: () => {
    const snapshot = useOrbitPlusStore.getState().snapshot
    return { access: snapshot.access, connected: snapshot.connected, activeSources: snapshot.activeSources, entitlementSource: snapshot.entitlement?.source, listeners: plusListeners }
  },
  deferred: value => { defer = value }, failed: value => { fail = value },
  resolve: () => { pending.splice(0).forEach(resolve => resolve(catalog)) },
  emit: () => catalogListener?.(catalog),
  language: language => usePreferencesStore.setState({ language }),
  view: view => useNavigationStore.getState().setMainView(view),
  details: value => showDetails(value),
  source: source => useLibraryFilterStore.getState().setSource(source),
  focus: selector => {
    const target = document.querySelector(selector)
    const previous = document.activeElement
    const delivered = focusEvents.length
    focusElement(target)
    // A hidden offscreen Chromium window updates activeElement without sending
    // native focus events. Exercise the actual React handlers explicitly there.
    if (target && useNavigationStore.getState().mainView === 'home' && focusEvents.length === delivered) {
      if (previous && previous !== target) previous.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: target }))
      target.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: previous }))
    }
  }, move: moveFocus,
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
  const checkCloudCountdown = async () => {
    for (const [width, height] of [[1280, 720], [1920, 1080]]) {
      window.setContentSize(width, height)
      await js('cloudQA.countdown()')
      await settle()
      assert.equal(await js('document.querySelector("[data-game-launch-splash]").dataset.launchCancelable'), 'true')
      assert.equal(await js('document.querySelector("[data-game-launch-splash]").textContent.includes("GEFORCE NOW")'), true)
      assert.equal(await js('document.activeElement.closest("[data-game-launch-splash]") !== null'), true, 'Countdown captures controller focus')
      assert.equal(await js('(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth })()'), true, 'Cancel remains visible at handheld resolution')
      await screenshot('gfn-countdown-' + width)
      const launches = await js('cloudQA.calls.filter(name => name === "geforceNow.launchGame").length')
      await button(1)
      assert.equal(await js('Boolean(document.querySelector("[data-game-launch-splash]"))'), false, 'Controller B cancels cloud countdown')
      assert.equal(await js('cloudQA.calls.filter(name => name === "geforceNow.launchGame").length'), launches, 'Cancel never forwards a cloud launch')
    }
  }
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
      return { height: r.height, statusRows: panel.querySelectorAll('[role=status], [role=alert]').length, visible: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        contentFits, overflow: panel.scrollWidth > panel.clientWidth + 1 || panel.scrollHeight > panel.clientHeight + 1 };
    })()`)
    assert.equal(layout.visible, true, 'Cloud toolbar is fully visible')
    assert.equal(layout.contentFits, true, 'Cloud text, icons and actions are not clipped')
    assert.equal(layout.overflow, false, 'Cloud toolbar does not overflow')
    assert.ok(layout.height <= 100 + layout.statusRows * 32, `Cloud toolbar stays compact (${layout.height}px)`)
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
  const checkHomeHistory = async () => {
    for (const [layout, width, height] of [['orbit', 1280, 720], ['float', 1920, 1080], ['rolling', 1280, 800], ['xmode', 1280, 720], ['coresense', 1920, 1080]]) {
      window.setContentSize(width, height)
      await js(`cloudQA.home('${layout}')`)
      await settle()
      const cloudCard = '[data-game-card][data-game-activation-target="geforce-now"]'
      const localCard = '[data-game-card][data-game-activation-target="default"]'
      assert.ok(await js(`Boolean(document.querySelector('${cloudCard}'))`), layout + ': cloud continuation exists')
      assert.ok(await js(`Boolean(document.querySelector('${localCard}'))`), layout + ': local copy exists independently')
      assert.equal(await js(`(() => { const b = document.querySelector('${cloudCard} [data-geforce-now-history-badge]'); const r = b.getBoundingClientRect(); const c = b.closest('[data-game-card]').getBoundingClientRect(); return b.complete && b.naturalWidth > 0 && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom })()`), true, layout + ': supplied badge is loaded and contained')
      assert.equal(await js(`Boolean(document.querySelector('${localCard} [data-geforce-now-history-badge]'))`), false)
      await js(`cloudQA.focus('${cloudCard}'); cloudQA.session('running')`)
      await settle()
      assert.equal(await js(`document.querySelector('${cloudCard}').getAttribute('data-game-running')`), 'true')
      assert.equal(await js(`document.querySelector('${localCard}').hasAttribute('data-game-running')`), false, layout + ': cloud stream does not mark local copy running')
      await js('cloudQA.session("idle")')
      await settle()
      const cloudStarts = await js('cloudQA.calls.filter(name => name === "geforceNow.launchGame").length')
      await button(0)
      assert.equal(await js('cloudQA.calls.filter(name => name === "geforceNow.launchGame").length'), cloudStarts + 1, layout + ': controller starts cloud copy through GFN')
      await js(`cloudQA.focus('${localCard}')`)
      await settle()
      if (layout === 'rolling') assert.equal(await js('document.querySelector("[data-rolling-active=true]").dataset.gameActivationTarget'), 'default', 'Rolling selection distinguishes copies')
      if (layout === 'coresense') assert.equal(await js('document.querySelector("[data-coresense-launcher][data-active=true]").dataset.gameActivationTarget'), 'default', 'CoreSense selection distinguishes copies')
      const localStarts = await js('cloudQA.calls.filter(name => name === "game.launch").length')
      await button(0)
      assert.equal(await js('cloudQA.calls.filter(name => name === "game.launch").length'), localStarts + 1, layout + ': controller starts local copy normally')
      await screenshot('home-history-' + layout + '-' + width)
    }
    await js('cloudQA.home("orbit", false)')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-game-card][data-game-activation-target=geforce-now]"))'), true, 'Uninstalled cloud history stays on Home')
    assert.equal(await js('Boolean(document.querySelector("[data-game-card][data-game-activation-target=default]"))'), false, 'Uninstalled local copy is not a playable Home entry')
    await js('cloudQA.library()')
    await settle()
  }
  try {
    await window.loadFile(path.join(output, 'index.html'))
    await settle()
    await checkCloudCountdown()
    if (process.argv.includes('--home-only')) {
      await js('cloudQA.access("active"); cloudQA.init()')
      await checkHomeHistory()
      assert.deepEqual(await js('cloudQA.errors'), [])
      console.log('Home cloud history: all layouts, supplied badge, running source, controller launches and uninstalled cloud entries passed.')
      return
    }
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
    assert.equal(await js('document.querySelector("[data-geforce-now-mode=web]").getAttribute("aria-pressed")'), 'true', 'Legacy/default choice is Web')
    await js('cloudQA.focus("[data-geforce-now-mode=web]")')
    await button(15)
    assert.equal(await js('document.activeElement.dataset.geforceNowMode'), 'native', 'D-pad reaches the native choice')
    await button(0)
    assert.equal(await js('cloudQA.savedMode()'), 'native', 'Controller A saves native mode directly in the library')
    assert.equal((await state()).view, 'library')
    await js('cloudQA.hydratePreferences()')
    await settle()
    assert.equal(await js('document.querySelector("[data-geforce-now-mode=native]").getAttribute("aria-pressed")'), 'true', 'Saved mode survives settings hydration')
    await checkLayouts('[data-geforce-now-panel]', 'compact-native')
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-panel] .lucide-sparkles"))'), false)
    await js('cloudQA.focus("[data-geforce-now-native-open]")')
    await button(0)
    assert.equal(await js('cloudQA.calls.includes("applications.launch")'), true, 'Controller A opens the installed app from the compact toolbar')
    await js('cloudQA.failSettings(true); document.querySelector("[data-geforce-now-mode=web]").click()')
    await settle()
    assert.equal(await js('document.querySelector("[data-geforce-now-mode=native]").getAttribute("aria-pressed")'), 'true', 'Failed save keeps the previous mode')
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-panel] [role=alert]"))'), true, 'Failed save offers visible feedback')
    await js('cloudQA.failSettings(false); cloudQA.holdSettings(true); cloudQA.focus("[data-geforce-now-mode=web]")')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await settle()
    assert.equal(await js('cloudQA.savedMode()'), 'native', 'Destination does not change before save completes')
    await js('cloudQA.resolveSettings(); cloudQA.holdSettings(false)')
    await settle()
    assert.equal(await js('cloudQA.savedMode()'), 'web', 'Enter saves the web choice')
    assert.equal(await js('document.activeElement.dataset.geforceNowMode'), 'web', 'Saving preserves focus on the switch')
    await js('document.querySelector("[data-game-card]").click()')
    await settle()
    assert.equal(await js('cloudQA.launchModes.at(-1)'), 'web')
    await js('document.querySelector("[data-geforce-now-mode=native]").click()')
    await settle()
    await screenshot('active-1920')
    await js('document.querySelector("[data-game-card]").click()')
    await settle()
    assert.equal(await js('cloudQA.calls.includes("geforceNow.launchGame")'), true, 'Active Plus launches cloud game')
    assert.equal(await js('cloudQA.launchModes.at(-1)'), 'native', 'Card launch uses the saved native destination')
    await js('cloudQA.details(true)')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-geforce-now-game-launch]"))'), true, 'Details offer cloud play')
    await js('document.querySelector("[data-geforce-now-game-launch]").click()')
    await settle()
    assert.equal(await js('cloudQA.launchModes.at(-1)'), 'native', 'Details use the same cloud destination')
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
    assert.equal(await js('document.querySelector("[data-geforce-now-mode=native]").disabled'), true, 'Missing app disables native choice')
    assert.equal(await js('document.querySelector("[data-geforce-now-mode=web]").getAttribute("aria-pressed")'), 'true', 'Saved native choice falls back visibly to Web when app is missing')
    await js('cloudQA.focus("[data-geforce-now-mode=web]")')
    await button(15)
    assert.notEqual(await js('document.activeElement.dataset.geforceNowMode'), 'native', 'Controller skips unavailable app')
    await js('cloudQA.native(true); window.dispatchEvent(new Event("focus"))')
    await settle()
    assert.equal(await js('document.querySelector("[data-geforce-now-mode=native]").disabled'), false, 'Returning after installation enables native choice')
    await js('cloudQA.focus("[data-geforce-now-native-open]"); cloudQA.native(false); window.dispatchEvent(new Event("focus"))')
    await settle()
    assert.equal(await js('document.activeElement.dataset.geforceNowMode'), 'web', 'Removing the focused native action restores focus to Web')
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
    // Native cloud sessions feed the same running context and summary as local games.
    await js('cloudQA.focus("[data-game-card]"); cloudQA.session("running")')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-game-card][data-game-running=true]"))'), true)
    assert.equal(await js('document.activeElement.hasAttribute("data-game-card")'), true, 'Running state preserves card focus')
    await js('cloudQA.session("returning")')
    await settle()
    assert.equal(await js('Boolean(document.querySelector("[data-game-card][data-game-running=true]"))'), false)
    assert.equal(await js('document.querySelector("[data-session-summary]").textContent.includes("3 min")'), true)
    assert.equal(await js('document.querySelector("[data-session-summary]").textContent.includes("15 min")'), true)
    assert.equal(await js('getComputedStyle(document.querySelector("[data-session-summary] p.truncate")).color'), 'rgb(255, 255, 255)', 'Summary game title stays readable on its dark surface')
    for (const [width, height] of [[1280, 720], [1280, 800], [1920, 1080]]) {
      window.setContentSize(width, height)
      await settle()
      assert.equal(await js('(() => { const r = document.querySelector("[data-session-summary]").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })()'), true, 'Cloud session summary fits the viewport')
      await screenshot(`session-summary-${width}x${height}`)
    }
    await js('cloudQA.session("idle")')
    await settle()
    await checkHomeHistory()
    await js('cloudQA.holdPlus("refresh", true); void cloudQA.plusRefresh()')
    await js('cloudQA.holdPlus("disconnect", true); void cloudQA.plusDisconnect()')
    assert.equal((await state()).matches, 0, 'Disconnect clears cloud matches before IPC returns')
    await js('cloudQA.resolvePlus("refresh"); cloudQA.emitPlus()')
    await settle()
    assert.equal((await state()).matches, 0, 'Stale membership response or event cannot restore access')
    await js('cloudQA.resolvePlus("disconnect"); cloudQA.holdPlus("disconnect", false); cloudQA.holdPlus("refresh", false)')
    await settle()
    await js('cloudQA.plusLicensed()')
    await settle()
    await js('cloudQA.holdPlus("disconnect", true); void cloudQA.plusDisconnect()')
    assert.deepEqual(await js('cloudQA.plusState()'), {
      access: 'active', connected: false, activeSources: ['lifetime-key'],
      entitlementSource: 'lifetime-key', listeners: 1
    }, 'Disconnect preserves an independently verified lifetime license')
    assert.equal((await state()).matches, 1, 'Independent license keeps cloud matches available')
    await js('cloudQA.resolvePlus("disconnect"); cloudQA.holdPlus("disconnect", false)')
    await settle()
    const expiryRefreshCalls = await js('cloudQA.calls.filter(name => name === "orbitPlus.refresh").length')
    await js('cloudQA.plusExpiry(1000); cloudQA.plusInit()')
    await settle()
    assert.equal((await state()).matches, 1)
    await js('cloudQA.focus("[data-game-card]")')
    await js('new Promise(resolve => setTimeout(resolve, 1100))')
    assert.equal((await state()).matches, 0, 'Deadline clears matches without another IPC update')
    assert.equal(await js('cloudQA.plusState().access'), 'locked')
    assert.ok(
      await js('cloudQA.calls.filter(name => name === "orbitPlus.refresh").length') <= expiryRefreshCalls + 1,
      'A fixed access deadline triggers at most one early refresh instead of an IPC loop'
    )
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
    console.error('Focus diagnostics:', await js('({ events: cloudQA.focusEvents, active: document.activeElement?.dataset?.gameActivationTarget })'))
    await screenshot('failure')
    throw error
  } finally { window.destroy() }
}
main().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
