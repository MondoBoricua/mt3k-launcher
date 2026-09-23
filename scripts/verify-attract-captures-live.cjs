// Offline Electron fixture: real components, stores, keyboard and gamepad navigation.
// Run after build: electron scripts/verify-attract-captures-live.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { app, BrowserWindow } = require('electron')
const { build } = createRequire(require.resolve('vite'))('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.codex-qa', 'attract-captures')
app.setPath('userData', path.join(output, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const fixture = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AttractMode } from '@renderer/components/AttractMode'
import { CapturesPanel } from '@renderer/components/CapturesPanel'
import { CaptureShelf } from '@renderer/components/CaptureShelf'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useCapturesStore } from '@renderer/state/capturesStore'
import { useAttractModeStore } from '@renderer/state/attractModeStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useGamepadNavigation } from '@renderer/hooks/useGamepadNavigation'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { triggerBack } from '@renderer/lib/backHandlerStack'
const errors = [], calls = []
let pressed = false, focus = true, visible = true, fail = false, clicks = 0
window.addEventListener('error', e => errors.push(e.message))
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)))
Object.defineProperty(document, 'hasFocus', { value: () => focus })
Object.defineProperty(document, 'visibilityState', { get: () => visible ? 'visible' : 'hidden' })
Object.defineProperty(navigator, 'getGamepads', { value: () => [{ index: 0, id: 'Xbox QA', mapping: 'standard', connected: true, axes: [0,0,0,0], buttons: Array.from({length: 17}, (_, i) => ({pressed: i === 0 && pressed, value: i === 0 && pressed ? 1 : 0})) }] })
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g"><stop stop-color="#15335d"/><stop offset="1" stop-color="#25696f"/></linearGradient></defs><path fill="url(#g)" d="M0 0h1600v900H0z"/><circle cx="1100" cy="250" r="170" fill="#50c4c9"/><path fill="#07182c" d="M0 700l450-300 350 200 500-270 300 350v220H0z"/></svg>')
const games = [ { id:'h2', name:'Hades II' }, { id:'m', name:'MARVEL Tōkon: Fighting Souls™' } ].map(g => ({...g, provider:'steam', providerGameId:g.id, metadata:{}, installed:true}))
const hidden = { ...games[0], id:'hidden', name:'Hidden Game' }
const items = [
 { path:'C:/Captures/Hades II.png', kind:'image', capturedAt:1789434191000, sizeBytes:100, gameTitleGuess:'Hades II', thumbnailUrl:art },
 { path:'C:/Captures/Hades II.mp4', kind:'video', capturedAt:1789434190000, sizeBytes:200, gameTitleGuess:'Hades II' },
 { path:'C:/Captures/MARVEL.png', kind:'image', capturedAt:1789434189000, sizeBytes:100, gameTitleGuess:'MARVEL Tōkon Fighting Souls', thumbnailUrl:art },
 { path:'C:/Captures/other.mp4', kind:'video', capturedAt:1789434188000, sizeBytes:200, gameTitleGuess:'Другой клип 龍が如く' },
 { path:'C:/Captures/hidden.mp4', kind:'video', capturedAt:1789434188000, sizeBytes:200, gameTitleGuess:'Hidden Game' }
]
window.api = new Proxy({}, {get: (_, namespace) => new Proxy({}, {get: (_, method) => (...args) => {
 if (method.startsWith('on')) return () => {}
 calls.push([namespace+'.'+method, ...args])
 if (namespace === 'attract') return Promise.resolve({h2:art,m:art,hidden:art})
 if (namespace === 'captures') return fail ? Promise.reject(new Error('QA unavailable')) : Promise.resolve(method === 'list' ? items : undefined)
 return Promise.resolve(null)
}})})
useLibraryStore.setState({snapshot:{games:[...games, hidden], excludedGames:[hidden], providerGames:games, recentGameIds:[], loadedAt:1, isLoadingMetadata:false}})
useNavigationStore.setState({phase:'main',mainView:'library'})
usePreferencesStore.setState({uiSounds:false,attractModeEnabled:false,captureShelfEnabled:false})
function Fixture() {
 useGamepadNavigation()
 const attract = usePreferencesStore(s=>s.attractModeEnabled)
 const captures = usePreferencesStore(s=>s.captureShelfEnabled)
 const panel = useCapturesStore(s=>s.panelOpen)
 return <main className="h-screen overflow-auto bg-surface p-6 text-white">
  <FocusableButton id="opener" onClick={()=>{clicks++;useCapturesStore.getState().showPanel()}}>Library</FocusableButton>
  {captures && <CaptureShelf gameId="h2"/>}
  {captures && panel && <CapturesPanel/>}
  {attract && <AttractMode launchPhase="idle"/>}
 </main>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
window.qa = {
 errors,calls,
 enable: (attract,captures) => usePreferencesStore.setState({attractModeEnabled:attract,captureShelfEnabled:captures}),
 language: language => usePreferencesStore.setState({language}),
 idle: () => useAttractModeStore.setState({lastInputAt:Date.now()-900001}),
 focus: value => {focus=value}, visible: value => {visible=value},
 press: value => {pressed=value}, fail: value => {fail=value},
 open: () => {focusElement(document.getElementById('opener'));useCapturesStore.getState().showPanel()},
 refresh: () => useCapturesStore.getState().refresh(),
 back: () => triggerBack(),
 state: () => ({reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,active:useAttractModeStore.getState().active,title:document.querySelector('[data-attract-mode] h1')?.textContent,
 panel:!!document.querySelector('[data-captures-panel]'),focus:document.activeElement?.id,
 focusInside:!!document.querySelector('[data-captures-panel]')?.contains(document.activeElement),
 groups:[...document.querySelectorAll('[data-captures-panel] h2')].map(e=>e.textContent),
 tiles:document.querySelectorAll('[data-captures-panel] button[aria-label]').length,
 shelf:document.querySelectorAll('[data-capture-shelf] button[aria-label]').length,
 error:!!document.querySelector('[role="alert"]'),clicks,
 overflow:document.documentElement.scrollWidth>innerWidth+1,
 view:useNavigationStore.getState().mainView})
}
`
async function verifySettings(win) {
 const source = await fs.readFile(path.join(root, 'scripts/verify-settings-navigation.cjs'), 'utf8')
 let settingsFixture = source.split('const fixture = `')[1].split('\n`')[0]
 settingsFixture = settingsFixture.replace("const responses = {", "const responses = { 'captures.list': [],")
 settingsFixture += `
 window.featureSettingsQA = {
   current: () => ({attract:usePreferencesStore.getState().attractModeEnabled, minutes:usePreferencesStore.getState().attractModeIdleMinutes, captures:usePreferencesStore.getState().captureShelfEnabled}),
   saved: () => ({attract:settings.attractModeEnabled, minutes:settings.attractModeIdleMinutes, captures:settings.captureShelfEnabled}),
   press: selector => { const element=document.querySelector(selector);focusElement(element);element.click() }
 }
 `
 await build({stdin:{contents:settingsFixture,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(output,'settings.js'),format:'iife',platform:'browser',jsx:'automatic',alias:{'@renderer':path.join(root,'src/renderer/src'),'@shared':path.join(root,'src/shared')},define:{'process.env.NODE_ENV':'"production"'},loader:{'.png':'file','.svg':'file','.ogg':'file'},logLevel:'warning'})
 await fs.writeFile(path.join(output,'settings.html'),'<!doctype html><html data-theme="midnight"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="settings.js"></script></body></html>')
 await win.loadFile(path.join(output,'settings.html'))
 const js=code=>win.webContents.executeJavaScript(code)
 const wait=ms=>new Promise(r=>setTimeout(r,ms))
 await wait(450)
 assert.deepEqual(await js('featureSettingsQA.current()'),{attract:false,minutes:5,captures:false})
 await js(`featureSettingsQA.press('[data-settings-section-header="attract-mode"]')`)
 await wait(100)
 await js(`featureSettingsQA.press('[data-setting-toggle="attractModeEnabled"]')`)
 await wait(100)
 assert.equal((await js('featureSettingsQA.saved()')).attract,true)
 for(const language of ['en','es','de','ru']) {
  await js(`settingsQA.setLanguage('${language}')`);await wait(300)
  const expectedTitle = {en:'Enable attract mode',es:'Activar modo de exhibición',de:'Präsentationsmodus aktivieren',ru:'Включить демонстрационный режим'}[language]
  assert.equal(await js(`document.querySelector('[data-setting-toggle="attractModeEnabled"]').textContent.includes(${JSON.stringify(expectedTitle)})`),true)
  win.webContents.invalidate();await wait(100)
  assert.equal(await js(`document.querySelectorAll('#settings-attract-mode-panel [role="group"] button').length`),4)
  await fs.writeFile(path.join(output,`settings-${language}.png`),(await win.webContents.capturePage()).toPNG())
 }
 await js(`featureSettingsQA.press('#settings-attract-mode-panel [role="group"] button:last-child')`);await wait(100)
 assert.equal((await js('featureSettingsQA.saved()')).minutes,15)
 await js(`featureSettingsQA.press('[data-settings-section-header="captures"]')`);await wait(100)
 await js(`featureSettingsQA.press('[data-setting-toggle="captureShelfEnabled"]')`);await wait(100)
 assert.equal((await js('featureSettingsQA.saved()')).captures,true)
 await js(`settingsQA.showView('library')`);await wait(450)
 assert.equal(await js(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Снимки и клипы')`),true,'library entry exists')
 await js(`settingsQA.showView('details')`);await wait(500)
 assert.equal(await js(`!!document.querySelector('[data-capture-shelf]')`),true,'details mounts shelf')
 assert.deepEqual(await js('settingsQA.errors'),[])
 console.log('Actual Settings, Library and Details integration passed; defaults, persistence and four-language settings screenshots verified.')
}
async function main() {
 await fs.mkdir(output,{recursive:true})
 await build({stdin:{contents:fixture,resolveDir:root,loader:'tsx'},bundle:true,outfile:path.join(output,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',alias:{'@renderer':path.join(root,'src/renderer/src'),'@shared':path.join(root,'src/shared')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'})
 const css=(await fs.readdir(path.join(root,'out/renderer/assets'))).find(n=>/^index-.*\.css$/.test(n))
 await fs.copyFile(path.join(root,'out/renderer/assets',css),path.join(output,'style.css'))
 await fs.writeFile(path.join(output,'index.html'),'<!doctype html><html data-theme="midnight"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
 await app.whenReady()
 const win=new BrowserWindow({width:1280,height:720,useContentSize:true,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}})
 win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!/^(file|data):/.test(details.url)}))
 const js=code=>win.webContents.executeJavaScript(code)
 const wait=ms=>new Promise(r=>setTimeout(r,ms))
 try {
  await win.loadFile(path.join(output,'index.html'));await wait(400)
  assert.deepEqual(await js('qa.calls.filter(c=>/^(captures|attract)\\./.test(c[0]))'),[],'disabled has no feature IPC')
  await js('qa.enable(true,true)');await wait(400)
  assert.equal((await js('qa.state()')).shelf,2,'game shelf matches both captures')
  await js('qa.open()');await wait(250)
  await js('qa.idle()');await wait(650)
  assert.equal((await js('qa.state()')).active,false,'dialog blocks attract')
  for(const language of ['en','es','de','ru']) {
   await js(`qa.language('${language}')`);await wait(100)
   const state=await js('qa.state()')
   assert.equal(state.focusInside,true)
   assert.equal(state.tiles,4)
   assert.equal(state.groups.includes('Hidden Game'),false)
   assert.equal(state.groups.length,3)
   assert.equal(state.overflow,false)
   await fs.writeFile(path.join(output,`captures-${language}.png`),(await win.webContents.capturePage()).toPNG())
  }
  for (const [width,height] of [[1920,1080],[3440,1440],[5120,1440]]) {
   win.setContentSize(width,height);await wait(250)
   assert.equal((await js('qa.state()')).overflow,false)
   await fs.writeFile(path.join(output,`captures-${width}.png`),(await win.webContents.capturePage()).toPNG())
  }
  win.setContentSize(1280,720);await wait(150)
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'ArrowLeft'});await wait(80)
  assert.equal((await js('qa.state()')).focusInside,true,'keyboard remains inside captures')
  await js('qa.fail(true);qa.refresh()');await wait(100)
  assert.equal((await js('qa.state()')).error,true,'translated access error')
  await js('qa.fail(false);qa.back()');await wait(250)
  assert.equal((await js('qa.state()')).focus,'opener','Back restores focus')
  for(const blocker of ['focus','visible']) {
   await js(`qa.${blocker}(false);qa.idle()`);await wait(600)
   assert.equal((await js('qa.state()')).active,false,blocker)
   await js(`qa.${blocker}(true)`)
  }
  await js('qa.idle()');await wait(650)
  let state=await js('qa.state()')
  assert.equal(state.active,true)
  assert.notEqual(state.title,'Hidden Game')
  await fs.writeFile(path.join(output,'attract.png'),(await win.webContents.capturePage()).toPNG())
  const firstSlide=state.title
  await wait(state.reducedMotion ? 17000 : 10000)
  assert.notEqual((await js('qa.state()')).title,firstSlide,'slideshow advances without immediate repeat')
  await js('qa.press(true)');await wait(350)
  state=await js('qa.state()')
  assert.equal(state.active,false,'controller wakes')
  assert.equal(state.clicks,0,'held controller wake does not activate underlying button')
  assert.equal(state.focus,'opener')
  assert.equal(state.view,'library')
  await js('qa.press(false)');await wait(100)
  await js('qa.idle()');await wait(650)
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});await wait(100)
  assert.equal((await js('qa.state()')).active,false,'keyboard wakes')
  assert.equal((await js('qa.state()')).clicks,0,'keyboard wake consumed')
  await wait(650)
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return',isAutoRepeat:true});await wait(100)
  assert.equal((await js('qa.state()')).clicks,0,'held keyboard wake remains consumed')
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'})
  await js('qa.enable(false,false)');await wait(300)
  const calls=await js('qa.calls.length')
  await js('qa.idle()');await wait(650)
  assert.equal((await js('qa.state()')).active,false)
  assert.equal(await js('qa.calls.length'),calls,'disabled stops feature work')
  assert.deepEqual(await js('qa.errors'),[])
  await verifySettings(win)
  console.log('Attract/captures live checks passed: four languages, grouping, hidden games, Back/focus, blockers, controller and keyboard wake consumption, errors and disabled work.')
 } finally {win.destroy();app.quit()}
}
main().catch(error=>{console.error(error);app.exit(1)})
