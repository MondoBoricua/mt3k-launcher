// Run after npm run build: electron scripts/verify-settings-navigation.cjs
// Uses the real SettingsView with local API fixtures; never loads the main app or user data.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { app, BrowserWindow } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')

const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'settings-navigation')
const experienceOnly = process.argv.includes('--experience-only')
const viewsOnly = process.argv.includes('--views-only')
const textScaleMode = viewsOnly || process.argv.includes('--text-scale')
const backgroundMotionPlusMode = process.argv.includes('--background-motion-plus')
const premiumAppearanceMode = process.argv.includes('--premium-appearance')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsView } from '@renderer/views/Settings/SettingsView'
import { useGamepadNavigation } from '@renderer/hooks/useGamepadNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useSettingsNavigationStore } from '@renderer/state/settingsNavigationStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { focusElement, getFocusableElements, moveFocus } from '@renderer/lib/spatialNavigation'
import { pushBackHandler } from '@renderer/lib/backHandlerStack'
import { applyTextScale, readCachedTextScale, flushTextScaleSave } from '@renderer/lib/textScalePreference'
import { TopBar } from '@renderer/components/TopBar'
import { HomeView } from '@renderer/views/Home/HomeView'
import { LibraryView } from '@renderer/views/Library/LibraryView'
import { StoreView } from '@renderer/views/Store/StoreView'
import { GameDetailPanel } from '@renderer/components/GameDetailPanel'
import { NotificationCenter } from '@renderer/components/NotificationCenter'
import { useNotificationStore } from '@renderer/state/notificationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import { OnboardingWelcome } from '@renderer/views/Onboarding/OnboardingWelcome'

const errors = []
const pad = { id: 'Xbox Controller', index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] }
Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] })
Object.defineProperty(document, 'hasFocus', { value: () => true })
window.addEventListener('error', (event) => errors.push(event.message))
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
const calls = []
let failTextSave = false
const savedScales = []
let settings = { ...usePreferencesStore.getState(), language: 'de', storeRegion: 'de', steamGridDbApiKey: '', rawgApiKey: '', backgroundTrailers: false, gameTitleMusic: false }
const emptyLibrary = { games: [], providerGames: [], excludedGames: [], recentGameIds: [], loadedAt: 0, isLoadingMetadata: false }
const responses = {
  'app.getVersion': '0.1.3',
  'game.resolveTrailer': null, 'game.resolveTitleMusic': null, 'game.resolveAchievements': null,
  'store.search': { products: [] },
  'downloads.get': { revision: 0, updatedAt: 0, activities: [] },
  'system.status.get': { platform: 'windows', state: 'ready', checkedAt: 0, battery: { present: false, charging: false, powerSource: 'ac' }, network: { connected: false, type: 'unknown' }, bluetooth: { available: false, enabled: false } },
  'retroAchievements.credentials.get': { configured: false },
  'steam.credentials.get': { configured: false },
  'playstation.refreshRemotePlayStatus': { apps: [], selectedApp: null },
  'image.getTokenStatus': { state: 'missing', checkedAt: 0 },
  'library.refresh': emptyLibrary,
  'system.checkUpdates': { platform: 'windows', state: 'ready', windowsUpdates: [], graphicsDriverUpdates: [], graphicsAdapters: [], errors: {}, checkedAt: 0 },
  'hardwareControl.getStatus': { state: 'disabled', connectedControllers: 0 },
  'backgroundService.getStatus': { state: 'running', backgroundModeAvailable: true, startWithWindows: false }
  , 'profileAvatar.getCustom': null, 'startupVideo.get': null, 'homeWallpaper.get': null,
  'launcherMusic.getCustom': null, 'uiAudio.getCustom': {},
  'image.resolve': null, 'image.hasCustom': false, 'game.resolveCompletionTimes': null
}
function api(parts = []) {
  return new Proxy(() => {}, {
    get: (_, key) => key === 'then' ? undefined : api([...parts, key]),
    apply: (_, __, args) => {
      const name = parts.join('.')
      if (parts.at(-1).startsWith('on')) return () => {}
      calls.push(name)
      if (name === 'settings.get') return Promise.resolve(settings)
      if (name === 'settings.set') {
        if ('textScale' in args[0]) {
          if (failTextSave) return Promise.reject(new Error('Test save failure'))
          savedScales.push(args[0].textScale)
        }
        settings = { ...settings, ...args[0] }; return Promise.resolve(settings)
      }
      if (name === 'uiAudio.clearCustom') return Promise.resolve()
      if (name in responses) return Promise.resolve(responses[name])
      errors.push('Unexpected API call: ' + name)
      return Promise.resolve(null)
    }
  })
}
window.api = api()
usePreferencesStore.setState({ language: 'de', textScale: 100, backgroundTrailers: false, gameTitleMusic: false })
applyTextScale(100)
useNavigationStore.setState({ mainView: 'settings' })
useSettingsNavigationStore.getState().setPage('experience')
let exited = 0
pushBackHandler(() => exited++)
const sampleGame = { id: 'local:text-size', provider: 'local', providerGameId: 'text-size', name: 'The Long Adventure: A Journey Beyond the Horizon', installed: true, addedAt: Date.now(), lastPlayed: Date.now(), playtimeMinutes: 147,
  local: { executablePath: 'C:/test/game.exe' }, metadata: { genres: ['Adventure', 'Role-playing'], developers: ['Example Studio'], summary: 'Explore a vast world, discover new places and experience an unforgettable adventure with your friends.' } }
let renderView
function Fixture() {
  useGamepadNavigation()
  const [view, setView] = React.useState('settings')
  renderView = setView
  return <>{view !== 'onboarding' && <TopBar />}{view === 'settings' ? <SettingsView /> : view === 'home' ? <HomeView /> : view === 'library' ? <LibraryView /> : view === 'store' ? <StoreView /> : view === 'onboarding' ? <OnboardingWelcome onContinue={() => {}} /> : <GameDetailPanel game={sampleGame} />}<NotificationCenter /></>
}
createRoot(document.getElementById('root')).render(<Fixture />)
window.settingsQA = {
  errors, calls,
  savedScales,
  setScale: (value) => usePreferencesStore.getState().setTextScale(value),
  flushScale: flushTextScaleSave,
  failTextSave: (fail) => { failTextSave = fail },
  cache: readCachedTextScale,
  hydrate: () => usePreferencesStore.getState().hydrate(),
  legacyScale: () => { delete settings.textScale },
  setLayout: (homeLayout) => { usePreferencesStore.setState({ homeLayout }); document.documentElement.dataset.homeLayout = homeLayout },
  showView: (view) => {
    useLibraryStore.setState({ snapshot: { ...emptyLibrary, games: Array.from({ length: 8 }, (_, i) => ({ ...sampleGame, id: 'local:sample-' + i })) } })
    useNavigationStore.setState({ mainView: view === 'details' ? 'library' : view })
    renderView(view)
  },
  notification: () => useNotificationStore.getState().push({ titleKey: 'notification.test.title', messageKey: 'notification.test.body', force: true, durationMs: 60000 }),
  clearNotifications: () => useNotificationStore.setState({ items: [] }),
  button: (index, pressed) => { pad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 } },
  setPage: (page) => useSettingsNavigationStore.getState().setPage(page),
  setLanguage: (language) => usePreferencesStore.setState({ language }),
  enableManualAudio: () => {
    useOrbitPlusStore.setState({
      initialized: true,
      snapshot: {
        access: 'active', connected: true, serviceAvailable: true,
        secureStorageAvailable: true, purchaseUrl: 'https://www.patreon.com/',
        entitlement: { source: 'patreon', plan: 'monthly', features: ['manual-audio', 'cloud-gaming', 'background-motion', 'premium-appearance'], verifiedAt: Date.now(), expiresAt: Date.now() + 86400000 }
      }
    })
    usePreferencesStore.setState({
      audioPreset: 'manual',
      customUiAudioCues: {
        navigate: { name: 'soft-navigation.wav', url: 'orbit-media://ui-audio/navigate/navigate.wav' },
        confirm: { name: 'confirm-chime.ogg', url: 'orbit-media://ui-audio/confirm/confirm.ogg' }
      }
    })
  },
  setBackgroundMotionAccess: (enabled) => {
    useOrbitPlusStore.setState({
      initialized: true,
      snapshot: enabled
        ? {
            access: 'active', connected: true, serviceAvailable: true,
            secureStorageAvailable: true, purchaseUrl: 'https://www.patreon.com/',
            entitlement: { source: 'patreon', plan: 'monthly', features: ['manual-audio', 'cloud-gaming', 'background-motion', 'premium-appearance'], verifiedAt: Date.now(), expiresAt: Date.now() + 86400000 }
          }
        : {
            access: 'locked', connected: false, serviceAvailable: true,
            secureStorageAvailable: true, purchaseUrl: 'https://www.patreon.com/'
          }
    })
  },
  setAppearanceAccess: (enabled) => {
    useOrbitPlusStore.setState({
      initialized: true,
      snapshot: enabled
        ? {
            access: 'active', connected: true, serviceAvailable: true,
            secureStorageAvailable: true, purchaseUrl: 'https://www.patreon.com/',
            entitlement: { source: 'patreon', plan: 'monthly', features: ['manual-audio', 'cloud-gaming', 'background-motion', 'premium-appearance'], verifiedAt: Date.now(), expiresAt: Date.now() + 86400000 }
          }
        : {
            access: 'locked', connected: false, serviceAvailable: true,
            secureStorageAvailable: true, purchaseUrl: 'https://www.patreon.com/'
          }
    })
    usePreferencesStore.getState().syncOrbitPlusAppearance()
  },
  setTheme: (theme) => usePreferencesStore.getState().setTheme(theme),
  setCornerStyle: (cornerStyle) => usePreferencesStore.getState().setCornerStyle(cornerStyle),
  focus: (selector) => focusElement(document.querySelector(selector)),
  move: moveFocus,
  key: (key) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
  },
  state: () => ({
    exited,
    page: useSettingsNavigationStore.getState().page,
    focused: document.activeElement?.getAttribute('data-settings-section-header'),
    focusedId: document.activeElement?.id,
    activeTab: document.activeElement?.getAttribute('data-settings-page'),
    headers: [...document.querySelectorAll('[data-settings-section-header]')].filter(e => !e.closest('[inert]')).map(e => e.dataset.settingsSectionHeader),
    expanded: [...document.querySelectorAll('[data-settings-section-header][aria-expanded="true"]')].filter(e => !e.closest('[inert]')).map(e => e.dataset.settingsSectionHeader),
    hiddenFocusable: getFocusableElements().filter(e => e.closest('[hidden]')).length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    savedLanguage: settings.language
    , textScale: usePreferencesStore.getState().textScale,
    savedScale: settings.textScale,
    scaleSaveState: usePreferencesStore.getState().textScaleSaveState,
    storedBackdropMotion: usePreferencesStore.getState().homeBackdropMotion,
    savedBackdropMotion: settings.homeBackdropMotion
    , theme: usePreferencesStore.getState().theme,
    cornerStyle: usePreferencesStore.getState().cornerStyle,
    appliedTheme: document.documentElement.dataset.theme,
    appliedCornerStyle: document.documentElement.dataset.cornerStyle
  })
}
`

async function main() {
  await fs.mkdir(output, { recursive: true })
  const assets = await fs.readdir(path.join(root, 'out/renderer/assets'))
  const css = assets.find((name) => /^index-.*\.css$/.test(name))
  assert.ok(css, 'Run npm run build first')
  await build({
    stdin: { contents: fixture, resolveDir: root, loader: 'tsx' },
    bundle: true,
    outfile: path.join(output, 'fixture.js'),
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@renderer': path.join(root, 'src/renderer/src'), '@shared': path.join(root, 'src/shared') },
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.png': 'file', '.svg': 'file', '.ogg': 'file' },
    logLevel: 'warning'
  })
  const onboardingCss = assets.find(name => /^OnboardingFlow-.*\.css$/.test(name))
  await fs.writeFile(path.join(output, 'style.css'), (await fs.readFile(path.join(root, 'out/renderer/assets', css), 'utf8')) + (onboardingCss ? await fs.readFile(path.join(root, 'out/renderer/assets', onboardingCss), 'utf8') : ''))
  await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html data-theme="midnight"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
  await app.whenReady()
  const window = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true } })
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') })
  })
  const js = async (code) => {
    try {
      return await window.webContents.executeJavaScript(code)
    } catch (error) {
      console.error('Renderer command:', code)
      console.error(await window.webContents.executeJavaScript('window.settingsQA?.errors'))
      throw error
    }
  }
  const settle = () => js('new Promise(resolve => setTimeout(resolve, 650))')
  const state = () => js('settingsQA.state()')
  const click = async (id) => { await js(`document.querySelector('[data-settings-section-header="${id}"]').click()`); await settle() }
  const open = async (id) => {
    const expanded = await js(`document.querySelector('[data-settings-section-header="${id}"]')?.getAttribute('aria-expanded') === 'true'`)
    if (!expanded) await click(id)
  }
  const key = async (value) => { await js(`settingsQA.key(${JSON.stringify(value)})`); await settle() }
  const waitFor = async (condition) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await js(condition)) return
      await js('new Promise(resolve => setTimeout(resolve, 100))')
    }
    assert.fail(`Timed out: ${condition}; ${JSON.stringify(await state())}; ${JSON.stringify(await js('settingsQA.errors'))}`)
  }
  const button = async (index) => {
    await js(`settingsQA.button(${index}, true)`)
    await js('new Promise(resolve => setTimeout(resolve, 90))')
    await js(`settingsQA.button(${index}, false)`)
    await settle()
  }
  await window.loadFile(path.join(output, 'index.html'))
  await settle()
  if (premiumAppearanceMode) {
    await js('settingsQA.setPage("appearance")')
    await waitFor('settingsQA.state().headers.includes("theme")')
    await click('theme')
    await waitFor('Boolean(document.querySelector(\'[data-theme-option="cobalt"]\'))')

    assert.equal(await js('document.querySelector(\'[data-theme-option="midnight"]\').disabled'), false)
    assert.equal(await js('document.querySelector(\'[data-theme-option="cobalt"]\').disabled'), true)
    assert.equal(await js('document.querySelectorAll(\'[data-theme-option][disabled]\').length'), 6)
    assert.equal(await js('document.querySelector(\'[data-corner-style-choice="theme"]\').disabled'), false)
    assert.equal(await js('document.querySelector(\'[data-corner-style-choice="square"]\').disabled'), true)
    await js('document.querySelector(\'[data-settings-section="theme"]\').scrollIntoView({ block: "start" })')
    await settle()
    assert.equal((await state()).overflow, false)
    await window.webContents.capturePage().then((image) =>
      fs.writeFile(path.join(output, 'premium-appearance-locked-1280-de.png'), image.toPNG())
    )

    await js('settingsQA.setAppearanceAccess(true)')
    await settle()
    assert.equal(await js('document.querySelector(\'[data-theme-option="cobalt"]\').disabled'), false)
    await js('settingsQA.setTheme("cobalt")')
    await js('settingsQA.setCornerStyle("square")')
    await settle()
    assert.deepEqual(
      await js('[settingsQA.state().theme, settingsQA.state().cornerStyle, settingsQA.state().appliedTheme, settingsQA.state().appliedCornerStyle]'),
      ['cobalt', 'square', 'cobalt', 'square']
    )
    await window.webContents.capturePage().then((image) =>
      fs.writeFile(path.join(output, 'premium-appearance-cobalt-square-1280-de.png'), image.toPNG())
    )

    await js('settingsQA.setTheme("magenta")')
    await js('settingsQA.setCornerStyle("round")')
    window.setContentSize(1920, 1080)
    await settle()
    assert.equal((await state()).overflow, false)
    await window.webContents.capturePage().then((image) =>
      fs.writeFile(path.join(output, 'premium-appearance-magenta-round-1920-de.png'), image.toPNG())
    )

    await js('settingsQA.setAppearanceAccess(false)')
    await settle()
    assert.deepEqual(
      await js('[settingsQA.state().theme, settingsQA.state().cornerStyle, settingsQA.state().appliedTheme, settingsQA.state().appliedCornerStyle]'),
      ['magenta', 'round', 'midnight', 'theme'],
      'Locked access preserves the preference while applying free appearance values'
    )
    await js('settingsQA.setAppearanceAccess(true)')
    await settle()
    assert.deepEqual(
      await js('[settingsQA.state().appliedTheme, settingsQA.state().appliedCornerStyle]'),
      ['magenta', 'round'],
      'Restored access reapplies the preserved appearance'
    )
    assert.deepEqual(await js('settingsQA.errors'), [])
    console.log('Premium appearance: six locked colours, four corner styles, square/round rendering, persistence, live entitlement fallback/restoration, and 1280×720/1920×1080 layout passed.')
    window.destroy()
    return
  }
  if (backgroundMotionPlusMode) {
    const stillSelector = '[data-setting-option="home-backdrop-motion:still"]'
    const driftSelector = '[data-setting-option="home-backdrop-motion:drift"]'
    const cinematicSelector = '[data-setting-option="home-backdrop-motion:cinematic"]'
    const openPresentation = async () => {
      await waitFor('settingsQA.state().headers.includes("presentation")')
      const expanded = await js(
        'document.querySelector(\'[data-settings-section-header="presentation"]\')?.getAttribute("aria-expanded") === "true"'
      )
      if (!expanded) await click('presentation')
      await waitFor(`Boolean(document.querySelector(${JSON.stringify(stillSelector)}))`)
    }

    await js('settingsQA.setPage("appearance")')
    await openPresentation()
    assert.equal(await js(`document.querySelector(${JSON.stringify(stillSelector)}).getAttribute('aria-pressed')`), 'true')
    assert.equal(await js(`document.querySelector(${JSON.stringify(driftSelector)}).dataset.premiumLocked`), 'true')
    assert.equal(await js(`document.querySelector(${JSON.stringify(cinematicSelector)}).dataset.premiumLocked`), 'true')
    await js(
      `document.querySelector(${JSON.stringify(driftSelector)}).scrollIntoView({ block: 'center' })`
    )
    await settle()
    await window.webContents.capturePage().then((image) =>
      fs.writeFile(path.join(output, 'background-motion-plus-locked-1280-de.png'), image.toPNG())
    )

    await js(`settingsQA.focus(${JSON.stringify(driftSelector)})`)
    await button(0)
    assert.equal((await state()).page, 'plus', 'Controller activation opens the ORBIT Plus page')

    await js('settingsQA.setPage("appearance")')
    await openPresentation()
    await js('settingsQA.setBackgroundMotionAccess(true)')
    await settle()
    assert.equal(await js(`document.querySelector(${JSON.stringify(driftSelector)}).dataset.premiumLocked`), undefined)
    await js(`document.querySelector(${JSON.stringify(cinematicSelector)}).click()`)
    await settle()
    assert.equal((await state()).storedBackdropMotion, 'cinematic')
    assert.equal((await state()).savedBackdropMotion, 'cinematic')

    await js('settingsQA.showView("home")')
    await waitFor('Boolean(document.querySelector(".home-backdrop-frame"))')
    assert.equal(
      await js('document.querySelector(".home-backdrop-frame")?.dataset.backdropMotion'),
      'cinematic',
      'An active Plus grant applies the saved background motion'
    )
    await js('settingsQA.setBackgroundMotionAccess(false)')
    await settle()
    assert.equal(
      await js('document.querySelector(".home-backdrop-frame")?.dataset.backdropMotion'),
      'still',
      'Losing Plus access stops background motion immediately'
    )
    assert.equal((await state()).storedBackdropMotion, 'cinematic', 'The premium preference is preserved')
    await js('settingsQA.setBackgroundMotionAccess(true)')
    await settle()
    assert.equal(
      await js('document.querySelector(".home-backdrop-frame")?.dataset.backdropMotion'),
      'cinematic',
      'Restored access reapplies the preserved preference'
    )

    window.setContentSize(1920, 1080)
    await settle()
    assert.equal((await state()).overflow, false)
    await window.webContents.capturePage().then((image) =>
      fs.writeFile(path.join(output, 'background-motion-plus-active-home-1920-de.png'), image.toPNG())
    )
    assert.deepEqual(await js('settingsQA.errors'), [])
    console.log('Background motion Plus gate: locked discovery, controller upgrade path, persistence, live entitlement loss/restoration, and 1280×720/1920×1080 layout passed.')
    window.destroy()
    return
  }
  if (textScaleMode) {
    await js('settingsQA.setPage("appearance")')
    await waitFor('settingsQA.state().headers.includes("text-size")')
    await click('text-size')
    assert.equal((await state()).textScale, 100)
    await js('settingsQA.focus("#settings-text-scale")')
    await button(15)
    assert.equal((await state()).textScale, 101, 'D-pad right adjusts the range without moving focus')
    assert.equal((await state()).focusedId, 'settings-text-scale')
    await key('ArrowLeft')
    assert.equal((await state()).textScale, 100)
    await button(14)
    assert.equal((await state()).textScale, 100, 'Minimum is clamped')
    await button(0)
    assert.equal(await js('Boolean(document.querySelector("[data-gamepad-keyboard]"))'), false)
    await key('ArrowDown')
    assert.notEqual((await state()).focusedId, 'settings-text-scale', 'Down leaves the range')

    const beforeBurst = await js('settingsQA.savedScales.length')
    await js('Promise.all(Array.from({ length: 50 }, (_, i) => settingsQA.setScale(101 + i)))')
    assert.equal((await state()).savedScale, 150)
    assert.equal(await js('settingsQA.savedScales.length'), beforeBurst + 1, 'Continuous changes produce one durable save')
    assert.equal(await js('settingsQA.cache()'), 150)
    await js('settingsQA.hydrate().then(() => null)')
    assert.equal((await state()).textScale, 150, 'Persisted scale survives hydration')
    await js('settingsQA.failTextSave(true); settingsQA.setScale(137).catch(() => {})')
    await settle()
    assert.equal((await state()).scaleSaveState, 'error')
    assert.equal((await state()).textScale, 137, 'Failed save retains the preview and offers retry')
    await js('settingsQA.failTextSave(false); document.querySelector("[data-text-scale-retry]").click()')
    await settle()
    assert.equal((await state()).savedScale, 137)
    await js('document.querySelector("[data-text-scale-reset]").click()')
    await settle()
    assert.equal((await state()).textScale, 100)
    await js('settingsQA.legacyScale(); settingsQA.hydrate().then(() => null)')
    assert.equal((await state()).textScale, 100, 'Legacy settings retain the existing text size')

    await js(`(() => {
      const probe = document.createElement('div'); probe.id = 'font-probe';
      probe.style.cssText = 'position:absolute;left:-2000px;top:0;width:32rem';
      probe.innerHTML = '<span class="text-[10px]">Small</span><p class="text-sm">Body</p><div class="text-base"><span class="text-[0.85em]">Relative</span></div>';
      document.body.append(probe);
    })()`)
    const measure = () => js(`(() => { const root = document.querySelector('#font-probe'); return { width: root.getBoundingClientRect().width, fonts: [...root.querySelectorAll('span,p,div')].map(e => parseFloat(getComputedStyle(e).fontSize)), lineHeight: parseFloat(getComputedStyle(root.querySelector('p')).lineHeight), root: parseFloat(getComputedStyle(document.documentElement).fontSize) } })()`)
    const baseline = await measure()
    assert.deepEqual(baseline.fonts.map(x => Math.round(x * 10) / 10), [10, 14, 16, 13.6])
    for (const scale of [125, 150]) {
      await js(`settingsQA.setScale(${scale})`)
      const enlarged = await measure()
      baseline.fonts.forEach((size, i) => assert.ok(Math.abs(enlarged.fonts[i] - size * scale / 100) < 0.02, 'Every font scales exactly once'))
      assert.equal(enlarged.width, baseline.width, 'Layout rem dimensions remain stable')
      assert.equal(enlarged.root, baseline.root, 'Root font size remains stable')
      assert.equal(enlarged.lineHeight, baseline.lineHeight * scale / 100)
    }
    await js('document.querySelector("#font-probe").remove()')
    await key('Escape')
    for (const [width, height, language, density, theme] of [[1280, 720, 'de', 'standard', 'midnight'], [1920, 1080, 'en', 'compact', 'monochrome']]) {
      window.setContentSize(width, height)
      await js(`settingsQA.setLanguage('${language}'); document.documentElement.dataset.density = '${density}'; document.documentElement.dataset.theme = '${theme}'`)
      for (const page of viewsOnly ? [] : ['appearance', 'experience', 'plus', 'libraries', 'hardware', 'updates', 'system']) {
        console.log(`Text 150%: ${page}, ${width} × ${height}, ${language}`)
        await js(`settingsQA.setPage('${page}')`)
        await waitFor('settingsQA.state().headers.length > 0')
        await settle()
        const navFits = await js('[...document.querySelectorAll("[data-settings-page]")].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth })')
        assert.equal(navFits, true, 'All categories fit with enlarged text')
        for (const id of (await state()).headers) {
          await open(id)
          assert.deepEqual((await state()).expanded, [id])
          assert.equal(await js(`(() => { const el = document.getElementById('settings-${id}-panel'); return el.scrollWidth <= el.clientWidth + 1 })()`), true, `${page}/${id} fits at 150% and ${width}`)
          if (id === 'text-size') {
            await js('settingsQA.focus("#settings-text-scale")')
            await settle()
            assert.equal(await js('(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()'), true, 'The focused slider remains visible')
            await window.webContents.capturePage().then(image => fs.writeFile(path.join(output, `text-size-${width}-${language}.png`), image.toPNG()))
          }
          await key('Escape')
          assert.equal((await state()).focused, id)
        }
      }
      for (const view of ['home', 'library', 'store', 'details', 'onboarding']) {
        console.log(`Text 150%: ${view}, ${width} × ${height}, ${language}`)
        await js(`settingsQA.showView('${view}')`)
        await settle()
        assert.deepEqual(await js('settingsQA.errors'), [])
        assert.equal((await state()).overflow, false, `${view} has no horizontal overflow`)
        if (view === 'home') assert.equal(await js('document.querySelector(".home-backdrop-art")?.textContent.trim()'), '', 'Decorative artwork has no overlapping fallback title')
        await window.webContents.capturePage().then(image => fs.writeFile(path.join(output, `text-size-${view}-${width}.png`), image.toPNG()))
        if (view === 'home') {
          for (const layout of ['rolling', 'float', 'coresense', 'xmode']) {
            await js(`settingsQA.setLayout('${layout}')`)
            await settle()
            assert.deepEqual(await js('settingsQA.errors'), [])
            await window.webContents.capturePage().then(image => fs.writeFile(path.join(output, `text-size-home-${layout}-${width}.png`), image.toPNG()))
          }
          await js('settingsQA.setLayout("orbit")')
        }
      }
      await js('settingsQA.showView("settings"); settingsQA.notification()')
      await settle()
      await window.webContents.capturePage().then(image => fs.writeFile(path.join(output, `text-size-notification-${width}.png`), image.toPNG()))
      await js('settingsQA.clearNotifications()')
    }
    assert.deepEqual(await js('settingsQA.errors'), [])
    console.log(`Text scale: live typography, keyboard/controller slider, bounds, batched saving, save error/retry, reset, cache/hydration, legacy defaults, ${viewsOnly ? 'representative main views' : 'all settings and representative main views'} at 150% passed.`)
    window.destroy()
    return
  }
  assert.deepEqual((await state()).expanded, [])
  assert.equal((await state()).headers.length, 6)
  await key('ArrowDown')
  assert.equal((await state()).focused, 'visibility', 'Down enters the first topic from the category')
  await key('ArrowDown')
  assert.equal((await state()).focused, 'sound')
  await key('Enter')
  assert.deepEqual((await state()).expanded, ['sound'])
  await key('ArrowDown')
  assert.equal(await js('document.activeElement.closest("[data-settings-section]").dataset.settingsSection'), 'sound')
  assert.equal((await state()).focused, null, 'Down enters sound controls')
  await key('ArrowUp')
  assert.equal((await state()).focused, 'sound', 'Up returns from the first control to its topic')
  await js('settingsQA.focus("#settings-sound-panel [data-setting-toggle=gameTitleMusic]")')
  await key('ArrowDown')
  assert.equal((await state()).focused, 'notifications', 'Down from the last setting reaches the next topic')
  await key('Escape')
  assert.deepEqual((await state()).expanded, [])
  assert.equal((await state()).focused, 'sound', 'Back restores the section header')
  assert.equal((await state()).exited, 0)
  await window.webContents.capturePage().then((image) => fs.writeFile(path.join(output, 'experience-1280-de.png'), image.toPNG()))
  await click('sound')
  await click('notifications')
  assert.deepEqual((await state()).expanded, ['notifications'], 'Only one topic is open')
  assert.equal((await state()).hiddenFocusable, 0)
  await click('language')
  await js('settingsQA.focus("#settings-language-panel [data-focusable]")')
  await key('Enter')
  assert.equal((await state()).savedLanguage, 'en', 'The existing setting is saved from the open panel')
  await key('Escape')
  await key(']')
  await waitFor('settingsQA.state().headers.includes("plus")')
  assert.equal((await state()).page, 'plus', 'Trigger-equivalent input still changes category')
  assert.equal((await state()).activeTab, 'plus', JSON.stringify({ state: await state(), active: await js('document.activeElement?.outerHTML'), errors: await js('settingsQA.errors') }))
  assert.deepEqual((await state()).expanded, ['plus'], 'The sole ORBIT Plus topic opens automatically')
  assert.equal(await js('document.querySelectorAll("[data-orbit-plus-feature]").length'), 4, 'All four implemented Plus feature groups are listed')
  assert.equal(await js('document.querySelectorAll("[data-orbit-plus-member-benefit]").length'), 4, 'Membership extras remain visibly separated')
  await window.webContents.capturePage().then((image) => fs.writeFile(path.join(output, 'orbit-plus-overview-1280-en.png'), image.toPNG()))
  await js('document.querySelector("[data-orbit-plus-feature]")?.scrollIntoView({ block: "center" })')
  await settle()
  await window.webContents.capturePage().then((image) => fs.writeFile(path.join(output, 'orbit-plus-features-1280-en.png'), image.toPNG()))
  await js('settingsQA.enableManualAudio()')

  for (const [width, height, language, density] of [[1280, 720, 'de', 'standard'], [1920, 1080, 'en', 'compact']]) {
    window.setContentSize(width, height)
    await js(`settingsQA.setLanguage('${language}'); document.documentElement.dataset.density = '${density}'`)
    for (const page of experienceOnly ? ['experience'] : ['appearance', 'experience', 'plus', 'libraries', 'hardware', 'updates', 'system']) {
      console.log(`Checking ${page} at ${width} × ${height} (${language}, ${density})`)
      await js(`settingsQA.setPage('${page}')`)
      await settle()
      await waitFor('settingsQA.state().headers.length > 0')
      assert.equal((await state()).headers.length, { appearance: 8, experience: 6, plus: 1, libraries: 6, hardware: 2, updates: 3, system: 2 }[page])
      assert.equal((await state()).overflow, false, `${page} has no horizontal overflow`)
      for (const id of (await state()).headers) {
        await open(id)
        assert.deepEqual((await state()).expanded, [id])
        assert.equal((await state()).hiddenFocusable, 0)
        const panelFits = await js(`(() => { const el = document.getElementById('settings-${id}-panel'); return el.scrollWidth <= el.clientWidth + 1 })()`)
        assert.equal(panelFits, true, `${page}/${id} fits at ${width}`)
        await key('Escape')
        assert.equal((await state()).focused, id)
      }
    }
  }
  // Switching topics must preserve a draft; closing a topic must remove its inputs from navigation.
  await js('settingsQA.setPage("libraries")')
  await settle()
  await waitFor('settingsQA.state().headers.includes("retro-achievements")')
  await click('retro-achievements')
  await js(`(() => { const input = document.querySelector('#settings-retro-achievements-panel input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Draft player'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await click('store-region')
  await click('retro-achievements')
  assert.equal(await js('document.querySelector("#settings-retro-achievements-panel input").value'), 'Draft player')
  await js('settingsQA.setPage("experience"); settingsQA.setLanguage("de")')
  await settle()
  await waitFor('settingsQA.state().headers.includes("sound")')
  await click('sound')
  await window.webContents.capturePage().then((image) => fs.writeFile(path.join(output, 'sound-1920-de.png'), image.toPNG()))
  await js('settingsQA.focus("[data-ui-audio-remove=navigate]"); document.querySelector("[data-ui-audio-remove=navigate]").click()')
  await settle()
  assert.equal(await js('document.activeElement?.dataset.uiAudioSelect'), 'navigate', 'Removing a custom sound restores focus to its file picker')
  await key('Escape')
  await button(7)
  assert.equal((await state()).page, 'plus', 'RT changes category')
  await waitFor('settingsQA.state().headers.includes("plus")')
  await button(6)
  assert.equal((await state()).page, 'experience', 'LT changes category')
  await waitFor('settingsQA.state().headers.includes("sound")')
  await button(13)
  assert.equal((await state()).focused, 'visibility', 'D-pad enters topic list')
  await button(0)
  assert.deepEqual((await state()).expanded, ['visibility'], 'A opens topic')
  await button(1)
  assert.deepEqual((await state()).expanded, [], 'B closes topic')
  assert.equal((await state()).focused, 'visibility')
  await key('Escape')
  assert.equal((await state()).exited, 1, 'Back exits normally once the topic is closed')
  assert.deepEqual(await js('settingsQA.errors'), [])
  console.log(`Settings: ${experienceOnly ? 'Experience topics' : 'all 28 topics'}, exclusive expansion, saving, draft retention, hidden focus, keyboard/controller/category/back navigation, and 720p/1080p layout passed.`)
  window.destroy()
}

main().then(() => app.quit()).catch((error) => { console.error(error); app.exit(1) })
