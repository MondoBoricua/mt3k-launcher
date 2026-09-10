// Offline UI fixture using the real Library, Plus store and spatial navigation.
// Run after build: electron scripts/verify-next-game-picker-live.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { app, BrowserWindow } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')

const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'next-game-picker')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { LibraryView } from '@renderer/views/Library/LibraryView'
import { useGamepadNavigation } from '@renderer/hooks/useGamepadNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useLibraryFilterStore } from '@renderer/state/libraryFilterStore'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { triggerBack } from '@renderer/lib/backHandlerStack'

const calls = [], errors = []
window.addEventListener('error', event => errors.push(event.message))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
Object.defineProperty(document, 'hasFocus', { value: () => true })
Math.random = () => 0.99

const games = [
  { id: 'steam:10', provider: 'steam', providerGameId: '10', appId: 10, name: 'Nebula Protocol', installed: true, addedAt: 1, updatedAt: 1, metadataRevision: 1, metadata: { genres: ['Action'], criticScore: 88, recommendationCount: 24500 } },
  { id: 'steam:20', provider: 'steam', providerGameId: '20', appId: 20, name: 'Mosslight Valley', installed: true, addedAt: 1, updatedAt: 1, metadataRevision: 1, playtimeMinutes: 620, lastPlayedTimestamp: Date.now() - 70 * 86400000, metadata: { genres: ['Adventure'], criticScore: 91, recommendationCount: 9100 } },
  { id: 'epic:30', provider: 'epic', providerGameId: '30', name: 'Ember Tactics', installed: false, addedAt: 1, updatedAt: 1, metadataRevision: 1, metadata: { genres: ['Strategy'], criticScore: 79 } },
  { id: 'steam:40', provider: 'steam', providerGameId: '40', appId: 40, name: 'Future Release', installed: true, addedAt: 1, updatedAt: 1, metadataRevision: 1, metadata: { comingSoon: true } },
  { id: 'gog:50', provider: 'gog', providerGameId: '50', name: 'Glass Horizon', installed: true, addedAt: 1, updatedAt: 1, metadataRevision: 1, metadata: { genres: ['Adventure'], criticScore: 84 } },
  { id: 'xbox:60', provider: 'xbox', providerGameId: '60', name: 'Quiet Signal', installed: false, addedAt: 1, updatedAt: 1, metadataRevision: 1, metadata: { genres: ['Puzzle'], criticScore: 82 } },
  { id: 'local:70', provider: 'local', providerGameId: '70', name: 'Install Me Later', installed: false, addedAt: 1, updatedAt: 1, metadataRevision: 1, metadata: { genres: ['Strategy'], criticScore: 77 } }
]
const snapshot = { games, providerGames: games, excludedGames: [], recentGameIds: [], loadedAt: 1, isLoadingMetadata: false }
const completion = { state: 'available', provider: 'howlongtobeat', mainStoryMinutes: 720, mainExtraMinutes: 960, completionistMinutes: 1440, sourceUrl: 'https://howlongtobeat.com/game/10', fetchedAt: Date.now() }

function api(parts = []) {
  return new Proxy(() => {}, {
    get: (_, key) => key === 'then' ? undefined : api([...parts, key]),
    apply: (_, __, args) => {
      const name = parts.join('.')
      if (parts.at(-1).startsWith('on')) return () => {}
      calls.push(name)
      if (name === 'image.resolve' || name === 'image.hasCustom') return Promise.resolve(null)
      if (name === 'game.resolveCompletionTimes') return Promise.resolve({ ...completion, sourceGameId: Number(args[0].split(':')[1]) })
      if (name === 'settings.get') return Promise.resolve(usePreferencesStore.getState())
      return Promise.resolve(null)
    }
  })
}

window.api = api()
usePreferencesStore.setState({ language: 'de', uiSounds: false, backgroundTrailers: false, gameTitleMusic: false, libraryGridColumns: 6 })
useNavigationStore.setState({ phase: 'main', mainView: 'library' })
useLibraryFilterStore.getState().setSource('steam')
useLibraryStore.setState({ snapshot })
useOrbitPlusStore.setState({
  initialized: true,
  snapshot: {
    access: 'active', connected: true, serviceAvailable: true, secureStorageAvailable: true,
    purchaseUrl: 'https://www.patreon.com/',
    entitlement: { source: 'patreon', plan: 'monthly', features: ['next-game-picker'], verifiedAt: Date.now() }
  }
})

function Fixture() {
  useGamepadNavigation()
  return <main className="h-screen overflow-hidden"><LibraryView /></main>
}

createRoot(document.getElementById('root')).render(<Fixture />)
window.nextGameQA = {
  calls, errors,
  back: () => triggerBack(),
  toggleUninstalled: () => {
    const toggle = document.querySelector('[data-next-game-include-uninstalled]')
    focusElement(toggle)
    toggle.click()
  },
  open: () => {
    const trigger = document.querySelector('[data-next-game-picker-trigger]')
    focusElement(trigger)
    trigger.click()
  },
  state: () => {
    const dialog = document.querySelector('[data-next-game-picker]')
    const panel = dialog?.querySelector('section')
    const result = dialog?.querySelector('h3')?.textContent ?? ''
    const active = document.activeElement
    const rect = panel?.getBoundingClientRect()
    return {
      result,
      dialog: Boolean(dialog),
      modal: dialog?.getAttribute('aria-modal'),
      focusInside: Boolean(dialog && active && dialog.contains(active)),
      focusRestored: active?.matches('[data-next-game-picker-trigger]') ?? false,
      includeUninstalled: dialog?.querySelector('[data-next-game-include-uninstalled]')?.getAttribute('aria-checked'),
      candidateCount: Number(dialog?.getAttribute('data-next-game-candidate-count') ?? 0),
      visibleTitles: [...(dialog?.querySelectorAll('[data-next-game-carousel-title]') ?? [])]
        .filter(card => Number.parseFloat(getComputedStyle(card).opacity) > 0.1)
        .map(card => card.getAttribute('data-next-game-carousel-title')),
      completionCalls: calls.filter(name => name === 'game.resolveCompletionTimes').length,
      hasHltb: Boolean(dialog && /12\\s*h/.test(dialog.textContent)),
      hasRating: Boolean(dialog && /(77|79|84|88|91)\\/100/.test(dialog.textContent)),
      contained: Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1
    }
  }
}
`

async function main() {
  await fs.mkdir(output, { recursive: true })
  const assets = await fs.readdir(path.join(root, 'out', 'renderer', 'assets'))
  const css = assets.find(name => /^index-.*\.css$/.test(name))
  assert.ok(css, 'Run build first')
  await build({
    stdin: { contents: fixture, resolveDir: root, loader: 'tsx' },
    bundle: true,
    outfile: path.join(output, 'fixture.js'),
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      '@renderer': path.join(root, 'src', 'renderer', 'src'),
      '@shared': path.join(root, 'src', 'shared')
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.png': 'file', '.svg': 'file', '.ogg': 'file' },
    logLevel: 'warning'
  })
  await fs.copyFile(
    path.join(root, 'out', 'renderer', 'assets', css),
    path.join(output, 'style.css')
  )
  await fs.writeFile(
    path.join(output, 'index.html'),
    '<!doctype html><html lang="de" data-theme="midnight"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>'
  )

  await app.whenReady()
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    show: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true
    }
  })
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') })
  )
  const js = code => window.webContents.executeJavaScript(code)
  const wait = milliseconds => js(`new Promise(resolve => setTimeout(resolve, ${milliseconds}))`)

  try {
    await window.loadFile(path.join(output, 'index.html'))
    await wait(500)
    for (const [width, height, name] of [[1280, 720, '720p'], [1920, 1080, '1080p']]) {
      window.setContentSize(width, height)
      await js('nextGameQA.open()')
      await wait(2600)
      const state = await js('nextGameQA.state()')
      assert.equal(state.dialog, true, `${name}: dialog opens`)
      assert.equal(state.modal, 'true', `${name}: dialog is modal`)
      assert.equal(state.focusInside, true, `${name}: focus stays inside`)
      assert.equal(state.result, 'Install Me Later', `${name}: an uninstalled game can win by default`)
      assert.equal(state.includeUninstalled, 'true', `${name}: all games start included`)
      assert.equal(state.candidateCount, 6, `${name}: the picker uses the full library, not the active Steam tab`)
      assert.equal(new Set(state.visibleTitles).size, state.visibleTitles.length, `${name}: settled carousel cards do not repeat`)
      assert.equal(state.hasHltb, true, `${name}: HLTB result is visible`)
      assert.equal(state.hasRating, true, `${name}: critic result is visible`)
      assert.equal(state.contained, true, `${name}: dialog stays inside viewport`)
      assert.equal(state.pageOverflow, false, `${name}: page has no overflow`)
      await fs.writeFile(path.join(output, `next-game-picker-${name}.png`), (await window.webContents.capturePage()).toPNG())
      await js('nextGameQA.toggleUninstalled()')
      await wait(2600)
      const installedOnly = await js('nextGameQA.state()')
      assert.equal(installedOnly.includeUninstalled, 'false', `${name}: all-game inclusion can be disabled`)
      assert.ok(['Nebula Protocol', 'Mosslight Valley', 'Glass Horizon'].includes(installedOnly.result), `${name}: disabling the option limits the full library draw to installed games`)
      assert.equal(installedOnly.focusInside, true, `${name}: toggle keeps focus inside the dialog`)
      assert.equal(await js('nextGameQA.back()'), true, `${name}: Back input is claimed`)
      await wait(400)
      const closed = await js('nextGameQA.state()')
      assert.equal(closed.dialog, false, `${name}: Back closes dialog`)
      assert.equal(closed.focusRestored, true, `${name}: focus returns to trigger`)
    }
    const finalState = await js('nextGameQA.state()')
    assert.equal(finalState.completionCalls, 4, 'Only each selected winner loads HLTB')
    assert.deepEqual(await js('nextGameQA.errors'), [])
    console.log('Next-game picker live checks passed at 1280x720 and 1920x1080 with focus, Back, default all-game selection, optional installed-only selection, HLTB and critic metadata.')
  } finally {
    window.destroy()
    app.quit()
  }
}

main().catch(error => {
  console.error(error)
  app.exit(1)
})
