// Run after npm run build: electron scripts/verify-download-center-live.cjs
// Uses local fixture data only; it never starts, pauses, or removes a real download.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { app, BrowserWindow } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')

const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'download-center')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const fixture = String.raw`
import React from 'react'
import { createRoot } from 'react-dom/client'
import { DownloadCenterPanel } from '@renderer/components/DownloadCenterPanel'
import { useDownloadStore } from '@renderer/state/downloadStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { triggerBack } from '@renderer/lib/backHandlerStack'

const errors = []
let downloadGets = 0
window.addEventListener('error', (event) => errors.push(event.message))
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))

const activity = {
  id: 'xbox:request:9nblggh4r315',
  provider: 'xbox',
  providerGameId: '9NBLGGH4R315',
  title: 'The Long Download: Hardened Edition',
  phase: 'downloading',
  confidence: 'exact',
  progress: 0.42,
  bytesDownloaded: 21_000_000_000,
  bytesTotal: 50_000_000_000,
  bytesPerSecond: 12_500_000,
  etaSeconds: 1_920,
  updatedAt: Date.now() - 1_500
}
const snapshot = {
  revision: 7,
  checkedAt: Date.now(),
  updatedAt: Date.now(),
  activities: [activity]
}

function api(parts = []) {
  return new Proxy(() => {}, {
    get: (_, key) => key === 'then' ? undefined : api([...parts, key]),
    apply: (_, __, args) => {
      const name = parts.join('.')
      if (name === 'downloads.get') {
        downloadGets += 1
        return Promise.resolve({ ...snapshot, checkedAt: Date.now() })
      }
      if (name === 'downloads.control') return Promise.resolve({ state: 'accepted' })
      if (name === 'image.resolve') return Promise.resolve(null)
      if (parts.at(-1).startsWith('on')) return () => {}
      errors.push('Unexpected API call: ' + name + ' ' + JSON.stringify(args))
      return Promise.resolve(null)
    }
  })
}

window.api = api()
usePreferencesStore.setState({ language: 'de' })
useDownloadStore.setState({
  snapshot,
  centerOpen: true,
  selectedActivityId: activity.id
})

function Fixture() {
  const open = useDownloadStore((state) => state.centerOpen)
  return open ? <DownloadCenterPanel /> : <div data-download-center-closed="true" />
}

createRoot(document.getElementById('root')).render(<Fixture />)
window.downloadCenterQA = {
  errors,
  back: triggerBack,
  getCalls: () => downloadGets,
  setPresentation: (language, density, theme) => {
    usePreferencesStore.setState({ language })
    document.documentElement.dataset.density = density
    document.documentElement.dataset.theme = theme
  }
}
`

async function main() {
  await fs.mkdir(output, { recursive: true })
  const assets = await fs.readdir(path.join(root, 'out', 'renderer', 'assets'))
  const css = assets.find((name) => /^index-.*\.css$/.test(name))
  assert.ok(css, 'Run npm run build first')

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
    '<!doctype html><html data-theme="midnight"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>'
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
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('data:') })
  })
  const js = (code) => window.webContents.executeJavaScript(code)
  const settle = () => js('new Promise((resolve) => setTimeout(resolve, 650))')

  await window.loadFile(path.join(output, 'index.html'))
  await settle()
  assert.match(
    await js('document.querySelector("[data-download-throughput]")?.textContent.trim() ?? ""'),
    /^100\sMbit\/s$/u
  )
  assert.match(
    await js('document.activeElement?.textContent ?? ""'),
    /Pausieren/u,
    'The primary Xbox action receives initial focus'
  )

  await js('document.querySelector("[aria-controls=download-center-info-panel]").click()')
  await settle()
  const initialGetCalls = await js('downloadCenterQA.getCalls()')
  assert.ok(initialGetCalls >= 1, 'Opening the info dock refreshes monitor diagnostics')
  await js('new Promise((resolve) => setTimeout(resolve, 2_200))')
  assert.ok(
    (await js('downloadCenterQA.getCalls()')) > initialGetCalls,
    'The open info dock refreshes its checked-at heartbeat'
  )
  assert.equal(await js('Boolean(document.querySelector("[data-download-info-panel=true]"))'), true)
  assert.match(
    await js('document.querySelector("[data-download-info-metric=speed]")?.textContent ?? ""'),
    /100\sMbit\/s/u
  )
  assert.match(
    await js('document.querySelector("[data-download-info-metric=checked-at]")?.textContent ?? ""'),
    /Zuletzt geprüft/u
  )
  assert.deepEqual(
    await js('[...document.querySelectorAll("[data-provider-automation]")].map((node) => [node.dataset.providerAutomation, node.dataset.automationLevel])'),
    [
      ['xbox', 'automatic'],
      ['steam', 'assisted'],
      ['epic', 'assisted'],
      ['ubisoft', 'manual']
    ]
  )
  assert.equal(
    await js('document.activeElement?.getAttribute("aria-label")'),
    'Infopanel schließen',
    'Opening the dock moves focus into it'
  )
  assert.equal(
    await js(`(() => {
      const panel = document.querySelector('[data-download-info-panel=true]')
      const rect = panel.getBoundingClientRect()
      const scroller = panel.querySelector('.overflow-y-auto')
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 &&
        rect.bottom <= innerHeight && scroller.scrollWidth <= scroller.clientWidth + 1
    })()`),
    true,
    'The info dock fits at 1280x720 without horizontal clipping'
  )
  await window.webContents.capturePage().then((image) =>
    fs.writeFile(path.join(output, 'download-info-1280-de.png'), image.toPNG())
  )

  await js('downloadCenterQA.back()')
  await settle()
  assert.equal(await js('Boolean(document.querySelector("[data-download-info-panel=true]"))'), false)
  assert.equal(
    await js('document.activeElement?.getAttribute("aria-controls")'),
    'download-center-info-panel',
    'Back closes only the info dock and restores its trigger'
  )
  const closedGetCalls = await js('downloadCenterQA.getCalls()')
  await js('new Promise((resolve) => setTimeout(resolve, 2_200))')
  assert.equal(
    await js('downloadCenterQA.getCalls()'),
    closedGetCalls,
    'Closing the info dock clears its diagnostics polling interval'
  )

  window.setContentSize(1920, 1080)
  await js('downloadCenterQA.setPresentation("en", "compact", "monochrome")')
  await js('document.querySelector("[aria-controls=download-center-info-panel]").click()')
  await settle()
  assert.equal(
    await js('document.documentElement.scrollWidth <= innerWidth'),
    true,
    'The Download Center has no page overflow at 1920x1080'
  )
  await window.webContents.capturePage().then((image) =>
    fs.writeFile(path.join(output, 'download-info-1920-en-compact.png'), image.toPNG())
  )

  await js('downloadCenterQA.back()')
  await settle()
  await js('downloadCenterQA.back()')
  await settle()
  assert.equal(await js('Boolean(document.querySelector("[data-download-center-closed=true]"))'), true)
  assert.deepEqual(await js('downloadCenterQA.errors'), [])
  console.log('Download Center live UI: Mbit/s, timestamps, provider automation, focus/back, and 720p/1080p layout passed.')
  window.destroy()
}

main().then(() => app.quit()).catch((error) => {
  console.error(error)
  app.exit(1)
})
