// Run after the production build. Renders the real RetroSystemHub in an
// isolated Electron window; it never loads the main app or user data.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { app, BrowserWindow } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')

const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'retro-systems')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { RetroSystemHub } from '@renderer/components/RetroSystemHub'
import { getFocusableElements } from '@renderer/lib/spatialNavigation'

const selections = []
const errors = []
window.addEventListener('error', (event) => errors.push(event.message))
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))
document.documentElement.dataset.theme = 'midnight'
document.documentElement.dataset.density = 'standard'

createRoot(document.getElementById('root')).render(
  <main className="min-h-screen bg-base px-8 py-6 text-white">
    <RetroSystemHub games={[]} columns={4} query="" onSelect={(id) => selections.push(id)} />
  </main>
)

window.retroQA = {
  errors,
  selections,
  ids: () => [...document.querySelectorAll('[data-retro-system]')].map((item) => item.dataset.retroSystem),
  focusableIds: () => getFocusableElements().map((item) => item.dataset.retroSystem).filter(Boolean),
  activate: (id) => document.querySelector('[data-retro-system="' + id + '"]').click(),
  imageReady: (id) => {
    const image = document.querySelector('[data-retro-system="' + id + '"] img')
    return Boolean(image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
  },
  focusAndReveal: (id) => {
    const item = document.querySelector('[data-retro-system="' + id + '"]')
    item.focus()
    item.scrollIntoView({ block: 'center' })
  },
  fitsWidth: () => document.documentElement.scrollWidth <= window.innerWidth,
  setAppearance: (theme, density) => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.density = density
  }
}
`

async function main() {
  await fs.mkdir(output, { recursive: true })
  await build({
    stdin: { contents: fixture, resolveDir: root, loader: 'tsx' },
    bundle: true,
    outfile: path.join(output, 'fixture.js'),
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: {
      '@renderer': path.join(root, 'src/renderer/src'),
      '@shared': path.join(root, 'src/shared')
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.png': 'file', '.svg': 'file' },
    logLevel: 'warning'
  })

  const assets = await fs.readdir(path.join(root, 'out', 'renderer', 'assets'))
  const styles = assets.filter((name) => /^(index|LibraryView)-.*\.css$/u.test(name))
  assert.ok(styles.length > 0, 'Run the production build before the retro UI verifier')
  const css = (
    await Promise.all(
      styles.map((name) => fs.readFile(path.join(root, 'out', 'renderer', 'assets', name), 'utf8'))
    )
  ).join('\n')
  await fs.writeFile(path.join(output, 'style.css'), css)
  await fs.writeFile(
    path.join(output, 'index.html'),
    '<!doctype html><html lang="de"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>'
  )

  await app.whenReady()
  const win = new BrowserWindow({
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
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|data):/u.test(details.url) })
  })
  const js = (code) => win.webContents.executeJavaScript(code)
  const settle = () => js('new Promise((resolve) => setTimeout(resolve, 400))')
  const capture = async (name) => {
    await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  }

  await win.loadFile(path.join(output, 'index.html'))
  await settle()
  const ids = await js('retroQA.ids()')
  assert.ok(ids.includes('ps3'), 'PlayStation 3 system card is missing')
  assert.ok(ids.includes('xbox360'), 'Xbox 360 system card is missing')
  assert.equal(
    await js("Boolean(document.getElementById('retro-systems-title'))"),
    false,
    'Redundant systems heading is still visible'
  )
  assert.ok(
    (await js("document.querySelector('[data-retro-system]').getBoundingClientRect().top")) < 100,
    'System grid leaves excessive empty space above the cards'
  )
  const focusableIds = await js('retroQA.focusableIds()')
  assert.ok(focusableIds.includes('ps3'), 'PlayStation 3 system card is not focusable')
  assert.ok(focusableIds.includes('xbox360'), 'Xbox 360 system card is not focusable')
  assert.equal(await js("retroQA.imageReady('ps3')"), true, 'PlayStation 3 artwork failed to load')
  assert.equal(await js("retroQA.imageReady('xbox360')"), true, 'Xbox 360 artwork failed to load')
  await js("retroQA.activate('ps3'); retroQA.activate('xbox360')")
  assert.deepEqual(await js('retroQA.selections'), ['ps3', 'xbox360'])

  for (const [width, height, theme, density] of [
    [1280, 720, 'midnight', 'standard'],
    [1920, 1080, 'coresense', 'compact']
  ]) {
    win.setContentSize(width, height)
    await js(`retroQA.setAppearance('${theme}', '${density}')`)
    await js("retroQA.focusAndReveal('ps3')")
    await settle()
    assert.equal(await js('retroQA.fitsWidth()'), true, `${width}x${height} has horizontal overflow`)
    assert.equal(await js("document.activeElement?.dataset.retroSystem"), 'ps3')
    await capture(`ps3-${width}x${height}`)
    await js("retroQA.focusAndReveal('xbox360')")
    await settle()
    assert.equal(await js("document.activeElement?.dataset.retroSystem"), 'xbox360')
    await capture(`xbox360-${width}x${height}`)
  }

  assert.deepEqual(await js('retroQA.errors'), [])
  await fs.writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        systems: ['ps3', 'xbox360'],
        viewports: [[1280, 720], [1920, 1080]],
        checks: ['render', 'artwork', 'focus', 'activation', 'horizontal-overflow']
      },
      null,
      2
    )
  )
  console.log('PS3 and Xbox 360 retro system UI verification passed.')
  win.destroy()
}

main().then(() => app.quit()).catch((error) => {
  console.error(error)
  app.exit(1)
})
