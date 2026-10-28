/**
 * FSR 4.1 Lite en el proceso principal. En Windows baja OptiScaler tal cual,
 * copia los DLL Lite y guarda un manifiesto para devolver la carpeta igual.
 * En macOS el servicio no toca disco: la UI se esconde.
 */
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { win32 } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { app, dialog, type BrowserWindow } from 'electron'
import Store from 'electron-store'
import type { LibraryGame } from '@shared/ipc'
import { t } from './i18n'
import { settingsStore } from './settingsStore'
import {
  FSR4_DEFAULT_GRAPHICS_API,
  FSR4_DLL_DX12,
  FSR4_DLL_VK,
  FSR4_LITE_DOWNLOAD_BASE,
  FSR4_LITE_LOG,
  FSR4_META_DIR,
  FSR4_SKIP_PACKAGE_FILES,
  OPTISCALER_COMPAT_LIST_URL,
  OPTISCALER_NIGHTLY_API,
  REFRAMEWORK_CONFIG_NAME,
  REFRAMEWORK_DLL_NAME,
  REFRAMEWORK_LATEST_ZIP,
  Fsr4LiteFailure,
  acceptDownloadDigest,
  assessFsr4Target,
  classifyFsr4Device,
  compatNoteForGame,
  compatRequiresReFramework,
  iniAssignments,
  isFsr4GraphicsApi,
  isFsr4RenderScale,
  isNewerOptiBuild,
  isWindowsAppsPath,
  parseOptiScalerSessionLog,
  pickOptiScalerNightly,
  planFsr4Install,
  safeRelativePath,
  selectGameExecutable,
  setIniValues,
  shouldRefreshOptiScaler,
  validateFsrDriverFile,
  widgetFsr4CacheDirectories,
  type Fsr4CacheRecord,
  type Fsr4FileSource,
  type Fsr4GraphicsApi,
  type Fsr4LiteEvent,
  type Fsr4LiteGameView,
  type Fsr4LiteManifest,
  type Fsr4LiteStatus,
  type Fsr4RenderScale,
  type Fsr4SessionStatus
} from '@shared/fsr4LitePolicy'

const TAR = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const POWERSHELL = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const SKIP_WALK = new Set(['engine', '_commonredist', '__redist', 'redist', 'redistributables', 'directx', 'support', 'prerequisites', '.git', 'node_modules', 'content'])

interface Fsr4GameRecord {
  gameId: string
  exeDir?: string
  installed: boolean
  widgetOwned: boolean
  proxyName?: string
  optiBuild?: string
  renderScale: Fsr4RenderScale
  overlay: boolean
  graphicsApi: Fsr4GraphicsApi
  hasFsr2Dll: boolean
  noUpscaler: boolean
  upscalers: Fsr4LiteGameView['upscalers']
  sessionStatus: 'none' | Fsr4SessionStatus
  resolution?: string
  block?: Fsr4LiteGameView['block']
  antiCheat?: string
  compatNote?: string
}

interface CurrentBuild {
  build: string
  root: string
}

let notify: (event: Fsr4LiteEvent) => void = () => undefined
let games: Store<Record<string, Fsr4GameRecord>> | undefined
let deviceCache: { at: number, status: Fsr4LiteStatus } | undefined
const inspectCache = new Map<string, { at: number, view: Fsr4LiteGameView }>()
let busy = false

function store(): Store<Record<string, Fsr4GameRecord>> {
  // Los ids traen dos puntos; sin esto electron-store parte la clave.
  return games ??= new Store<Record<string, Fsr4GameRecord>>({
    name: 'fsr4-lite-games',
    accessPropertiesByDotNotation: false
  })
}

function featureOn(): boolean {
  return process.platform === 'win32' && settingsStore.get('fsr4LiteEnabled') === true
}

function autoUpdateOn(): boolean {
  return settingsStore.get('fsr4LiteAutoUpdate') !== false
}

function defaultOptions(): Pick<Fsr4GameRecord, 'renderScale' | 'overlay' | 'graphicsApi'> {
  const scale = settingsStore.get('fsr4LiteRenderScaleDefault')
  return {
    renderScale: isFsr4RenderScale(scale) ? scale : 'game',
    overlay: settingsStore.get('fsr4LiteOverlayDefault') === true,
    graphicsApi: FSR4_DEFAULT_GRAPHICS_API
  }
}

function cacheRoot(): string {
  return win32.join(app.getPath('userData'), 'fsr4-lite')
}

function log(level: 'info' | 'warn', message: string, detail?: unknown): void {
  const line = `${FSR4_LITE_LOG} ${message}`
  if (level === 'warn') console.warn(line, detail ?? '')
  else console.info(line, detail ?? '')
}

async function existsFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

/** Une una ruta relativa y no deja que se salga de la carpeta del exe. */
function contained(root: string, relative: string): string {
  const safe = safeRelativePath(relative)
  if (!safe) throw new Fsr4LiteFailure('bad-path')
  const dest = win32.normalize(win32.join(root, ...safe.split('/')))
  const base = win32.normalize(root)
  const prefix = base.endsWith('\\') ? base.toLowerCase() : `${base.toLowerCase()}\\`
  if (dest.toLowerCase() !== base.toLowerCase() && !dest.toLowerCase().startsWith(prefix)) {
    throw new Fsr4LiteFailure('bad-path')
  }
  return dest
}

function assertGameDirectory(dir: string): void {
  const norm = win32.normalize(dir)
  if (/^[a-zA-Z]:\\?$/.test(norm)) throw new Fsr4LiteFailure('no-exe')
  if (isWindowsAppsPath(norm)) throw new Fsr4LiteFailure('windows-apps')
  if (/\\windows\\(system32|syswow64)(\\|$)/i.test(norm)) throw new Fsr4LiteFailure('no-exe')
}

function powershell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 12_000,
      maxBuffer: 2_000_000
    }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout ?? ''))
    })
  })
}

async function downloadTo(url: string, dest: string, options: {
  digest?: string
  headers?: Record<string, string>
  onProgress?: (received: number, total: number) => void
}): Promise<{ etag?: string, finalUrl: string, size: number }> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MT3K-Launcher', ...options.headers },
    redirect: 'follow'
  })
  if (!response.ok || !response.body) throw new Fsr4LiteFailure('download')
  const total = Number(response.headers.get('content-length') ?? '0')
  const etag = response.headers.get('etag') ?? undefined
  await mkdir(win32.dirname(dest), { recursive: true })
  const tmp = `${dest}.partial`
  const hash = createHash('sha256')
  const out = createWriteStream(tmp)
  let received = 0
  try {
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(buf)
      received += buf.length
      if (!out.write(buf)) await new Promise<void>((resolve) => { out.once('drain', () => resolve()) })
      options.onProgress?.(received, Number.isFinite(total) ? total : 0)
    }
    out.end()
    await finished(out)
  } catch (error) {
    out.destroy()
    await rm(tmp, { force: true })
    if (error instanceof Fsr4LiteFailure) throw error
    throw new Fsr4LiteFailure('download')
  }
  if (options.digest && !acceptDownloadDigest(options.digest, hash.digest('hex'))) {
    await rm(tmp, { force: true })
    throw new Fsr4LiteFailure('digest')
  }
  await rm(dest, { force: true })
  await rename(tmp, dest)
  return { etag, finalUrl: response.url, size: received }
}

/** bsdtar de System32. Si Windows 10 no abre el .7z, el fallo se llama `tar`. */
function extractArchive(archive: string, dest: string): Promise<void> {
  return mkdir(dest, { recursive: true }).then(() => new Promise((resolve, reject) => {
    execFile(TAR, ['-xf', archive, '-C', dest], { windowsHide: true, timeout: 180_000 }, (error) => {
      if (error) {
        log('warn', `tar no pudo extraer ${win32.basename(archive)}`, error)
        reject(new Fsr4LiteFailure('tar'))
      } else resolve()
    })
  }))
}

async function companyName(path: string): Promise<string | null> {
  const escaped = path.replace(/'/g, "''")
  try {
    const output = await powershell(`[Diagnostics.FileVersionInfo]::GetVersionInfo('${escaped}').CompanyName`)
    const value = output.trim()
    return value.length > 0 ? value : null
  } catch (error) {
    log('warn', 'no se pudo leer la compañía del DLL', error)
    return null
  }
}

async function validateDll(path: string): Promise<void> {
  const info = await stat(path)
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(2)
    await handle.read(header, 0, 2, 0)
    const company = await companyName(path)
    const result = validateFsrDriverFile({ fileName: win32.basename(path), size: info.size, header, company })
    if (!result.ok) throw new Fsr4LiteFailure('dll')
  } finally {
    await handle.close()
  }
}

async function fsrReady(): Promise<boolean> {
  const dir = win32.join(cacheRoot(), 'fsr4')
  return await existsFile(win32.join(dir, FSR4_DLL_DX12)) && await existsFile(win32.join(dir, FSR4_DLL_VK))
}

async function rememberFsr(source: Exclude<Fsr4FileSource, 'missing'>, etags: Record<string, string | undefined>): Promise<void> {
  const dir = win32.join(cacheRoot(), 'fsr4')
  const files: Fsr4CacheRecord['files'] = []
  for (const name of [FSR4_DLL_DX12, FSR4_DLL_VK]) {
    const info = await stat(win32.join(dir, name))
    const etag = etags[name]
    files.push(etag ? { name, size: info.size, etag } : { name, size: info.size })
  }
  const record: Fsr4CacheRecord = { source, files, recordedAt: new Date().toISOString() }
  await writeFile(win32.join(dir, 'record.json'), JSON.stringify(record, null, 2))
}

async function readCacheRecord(): Promise<Fsr4CacheRecord | null> {
  try {
    return JSON.parse(await readFile(win32.join(cacheRoot(), 'fsr4', 'record.json'), 'utf8')) as Fsr4CacheRecord
  } catch {
    return null
  }
}

/** Primero la caché del widget, si valida; si no, el bucket público. */
async function ensureFsrDlls(gameId: string): Promise<void> {
  if (await fsrReady()) return
  const destDir = win32.join(cacheRoot(), 'fsr4')
  await mkdir(destDir, { recursive: true })
  const local = process.env.LOCALAPPDATA
  if (local) {
    for (const dir of widgetFsr4CacheDirectories(local)) {
      const dx = win32.join(dir, FSR4_DLL_DX12)
      const vk = win32.join(dir, FSR4_DLL_VK)
      if (!await existsFile(dx) || !await existsFile(vk)) continue
      try {
        await validateDll(dx)
        await validateDll(vk)
        await copyFile(dx, win32.join(destDir, FSR4_DLL_DX12))
        await copyFile(vk, win32.join(destDir, FSR4_DLL_VK))
        await rememberFsr('widget-cache', {})
        log('info', 'DLL Lite tomados de la caché del widget')
        return
      } catch (error) {
        log('warn', 'la caché del widget no pasó la validación', error)
      }
    }
  }
  const etags: Record<string, string | undefined> = {}
  for (const name of [FSR4_DLL_DX12, FSR4_DLL_VK]) {
    const result = await downloadTo(`${FSR4_LITE_DOWNLOAD_BASE}/${name}`, win32.join(destDir, name), {
      onProgress: (received, total) => notify({ kind: 'progress', gameId, phase: 'fsr', received, total: total || 158_000_000 })
    })
    etags[name] = result.etag
    await validateDll(win32.join(destDir, name))
  }
  await rememberFsr('downloaded', etags)
  log('info', 'DLL Lite descargados')
}

async function readCurrentBuild(): Promise<CurrentBuild | null> {
  try {
    const raw = JSON.parse(await readFile(win32.join(cacheRoot(), 'optiscaler', 'current.json'), 'utf8')) as CurrentBuild
    if (!raw?.build || !raw.root || !await existsFile(win32.join(raw.root, 'OptiScaler.dll'))) return null
    return raw
  } catch {
    return null
  }
}

async function findPackageRoot(dir: string): Promise<string> {
  if (await existsFile(win32.join(dir, 'OptiScaler.dll'))) return dir
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = win32.join(dir, entry.name)
    if (await existsFile(win32.join(nested, 'OptiScaler.dll'))) return nested
  }
  throw new Fsr4LiteFailure('optiscaler-layout')
}

async function ensureOptiScaler(gameId: string, checkRemote: boolean): Promise<CurrentBuild> {
  const current = await readCurrentBuild()
  if (current && !checkRemote) return current
  let asset: ReturnType<typeof pickOptiScalerNightly> = null
  try {
    const response = await fetch(OPTISCALER_NIGHTLY_API, {
      headers: { 'User-Agent': 'MT3K-Launcher', Accept: 'application/vnd.github+json' }
    })
    if (response.ok) asset = pickOptiScalerNightly(await response.json())
  } catch (error) {
    log('warn', 'no se pudo consultar OptiScaler', error)
  }
  if (!asset || (current && !isNewerOptiBuild(current.build, asset.name))) {
    if (current) return current
    throw new Fsr4LiteFailure('download')
  }
  const incoming = win32.join(cacheRoot(), 'optiscaler', 'incoming.7z')
  log('info', `bajando ${asset.name}`)
  await downloadTo(asset.url, incoming, {
    digest: asset.digest,
    onProgress: (received, total) => notify({
      kind: 'progress', gameId, phase: 'optiscaler', received, total: total || asset.size || 57_000_000
    })
  })
  const extracted = win32.join(cacheRoot(), 'optiscaler', 'extracted')
  await rm(extracted, { recursive: true, force: true })
  try {
    await extractArchive(incoming, extracted)
  } finally {
    await rm(incoming, { force: true })
  }
  const root = await findPackageRoot(extracted)
  const next = { build: asset.name, root }
  await mkdir(win32.dirname(win32.join(cacheRoot(), 'optiscaler', 'current.json')), { recursive: true })
  await writeFile(win32.join(cacheRoot(), 'optiscaler', 'current.json'), JSON.stringify(next))
  log('info', `OptiScaler listo: ${asset.name}`)
  return next
}

async function readLastCheck(): Promise<number | null> {
  try {
    const value = Number(await readFile(win32.join(cacheRoot(), 'optiscaler', 'last-check.txt'), 'utf8'))
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

async function findNamedFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = win32.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await findNamedFile(full, name)
      if (nested) return nested
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return full
  }
  return null
}

async function ensureReFramework(gameId: string): Promise<{ version: string, dll: string }> {
  const dir = win32.join(cacheRoot(), 'reframework')
  const dll = win32.join(dir, REFRAMEWORK_DLL_NAME)
  const versionFile = win32.join(dir, 'version.txt')
  const marker = win32.join(dir, 'last-check.txt')
  const last = Number(await readFile(marker, 'utf8').catch(() => '0'))
  if (await existsFile(dll) && Date.now() - last < 24 * 60 * 60 * 1000) {
    return { version: (await readFile(versionFile, 'utf8').catch(() => 'nightly')).trim() || 'nightly', dll }
  }
  const zip = win32.join(dir, 'REFramework.zip')
  const result = await downloadTo(REFRAMEWORK_LATEST_ZIP, zip, {
    onProgress: (received, total) => notify({ kind: 'progress', gameId, phase: 'reframework', received, total })
  })
  const tag = /\/releases\/download\/([^/]+)\//i.exec(result.finalUrl)?.[1] ?? 'nightly'
  const unpacked = win32.join(dir, 'unpacked')
  await rm(unpacked, { recursive: true, force: true })
  await extractArchive(zip, unpacked)
  const found = await findNamedFile(unpacked, REFRAMEWORK_DLL_NAME)
  if (!found) throw new Fsr4LiteFailure('reframework')
  await mkdir(dir, { recursive: true })
  await copyFile(found, dll)
  await writeFile(versionFile, tag)
  await writeFile(marker, String(Date.now()))
  await rm(unpacked, { recursive: true, force: true })
  await rm(zip, { force: true })
  log('info', `REFramework ${tag}`)
  return { version: tag, dll }
}

async function walkInstall(root: string): Promise<{ files: { relativePath: string, size: number }[], hasEngineDir: boolean }> {
  const files: { relativePath: string, size: number }[] = []
  let hasEngineDir = false
  const stack: { dir: string, depth: number }[] = [{ dir: root, depth: 0 }]
  while (stack.length > 0 && files.length < 8_000) {
    const current = stack.pop()
    if (!current) break
    for (const entry of await readdir(current.dir, { withFileTypes: true }).catch(() => [])) {
      const full = win32.join(current.dir, entry.name)
      const relativePath = win32.relative(root, full).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (current.depth === 0 && entry.name.toLowerCase() === 'engine') hasEngineDir = true
        if (SKIP_WALK.has(entry.name.toLowerCase()) || current.depth >= 5) continue
        stack.push({ dir: full, depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      let size = 0
      if (entry.name.toLowerCase().endsWith('.exe')) {
        try { size = (await stat(full)).size } catch { size = 0 }
      }
      files.push({ relativePath, size })
    }
  }
  return { files, hasEngineDir }
}

function treeForExe(installRoot: string, exeDir: string, files: { relativePath: string }[]): Record<string, string> {
  const prefix = win32.relative(installRoot, exeDir).replace(/\\/g, '/')
  const tree: Record<string, string> = {}
  for (const file of files) {
    if (!prefix) tree[file.relativePath] = 'exists'
    else if (file.relativePath.startsWith(`${prefix}/`)) tree[file.relativePath.slice(prefix.length + 1)] = 'exists'
  }
  return tree
}

async function listPackageMap(root: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = win32.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const rel = win32.relative(root, full).replace(/\\/g, '/')
      map[rel] = win32.basename(rel).toLowerCase() === 'optiscaler.ini' ? await readFile(full, 'utf8') : 'package'
    }
  }
  await walk(root)
  return map
}

async function writeManifest(exeDir: string, manifest: Fsr4LiteManifest): Promise<void> {
  const dir = contained(exeDir, FSR4_META_DIR)
  await mkdir(dir, { recursive: true })
  const target = win32.join(dir, 'manifest.json')
  const tmp = `${target}.tmp`
  await writeFile(tmp, JSON.stringify(manifest, null, 2))
  await rename(tmp, target)
}

async function readManifest(exeDir: string): Promise<Fsr4LiteManifest> {
  const raw = JSON.parse(await readFile(win32.join(exeDir, FSR4_META_DIR, 'manifest.json'), 'utf8')) as Fsr4LiteManifest
  if (!raw || raw.formatVersion !== 1 || typeof raw.proxyName !== 'string') throw new Fsr4LiteFailure('manifest')
  for (const list of [raw.createdFiles, raw.createdDirs, raw.replacedFiles]) {
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || !safeRelativePath(item))) {
      throw new Fsr4LiteFailure('manifest')
    }
  }
  if (!Array.isArray(raw.reframeworkPreexisting)) raw.reframeworkPreexisting = []
  return raw
}

async function backupFile(exeDir: string, relative: string): Promise<void> {
  const source = contained(exeDir, relative)
  const backup = contained(exeDir, `${FSR4_META_DIR}/backup/${relative}`)
  await mkdir(win32.dirname(backup), { recursive: true })
  const info = await stat(source)
  await copyFile(source, backup)
  await utimes(backup, info.atime, info.mtime)
}

async function copyPlanned(exeDir: string, packageRoot: string, proxyName: string, refDll: string | undefined, file: { path: string, content: string }): Promise<void> {
  const dest = contained(exeDir, file.path)
  await mkdir(win32.dirname(dest), { recursive: true })
  const base = win32.basename(file.path).toLowerCase()
  if (base === 'optiscaler.ini' || base === REFRAMEWORK_CONFIG_NAME.toLowerCase()) {
    await writeFile(dest, file.content)
    return
  }
  if (base === FSR4_DLL_DX12 || base === FSR4_DLL_VK) {
    await copyFile(win32.join(cacheRoot(), 'fsr4', base), dest)
    return
  }
  if (base === REFRAMEWORK_DLL_NAME) {
    if (!refDll) throw new Fsr4LiteFailure('reframework')
    await copyFile(refDll, dest)
    return
  }
  if (file.path.toLowerCase() === proxyName.toLowerCase()) {
    await copyFile(win32.join(packageRoot, 'OptiScaler.dll'), dest)
    return
  }
  const fromPackage = win32.join(packageRoot, ...file.path.split('/'))
  if (await existsFile(fromPackage)) {
    await copyFile(fromPackage, dest)
    return
  }
  throw new Fsr4LiteFailure('optiscaler-layout')
}

function blankRecord(gameId: string): Fsr4GameRecord {
  return {
    gameId,
    installed: false,
    widgetOwned: false,
    ...defaultOptions(),
    hasFsr2Dll: false,
    noUpscaler: true,
    upscalers: [],
    sessionStatus: 'none'
  }
}

function readRecord(gameId: string): Fsr4GameRecord {
  return store().get(gameId) ?? blankRecord(gameId)
}

function saveRecord(record: Fsr4GameRecord): void {
  store().set(record.gameId, { ...record })
}

function viewFrom(record: Fsr4GameRecord, supported: boolean, phase: Fsr4LiteGameView['phase']): Fsr4LiteGameView {
  return {
    supported,
    phase,
    block: record.block,
    antiCheat: record.antiCheat,
    upscalers: record.upscalers,
    noUpscaler: record.noUpscaler,
    renderScale: record.renderScale,
    overlay: record.overlay,
    graphicsApi: record.graphicsApi,
    sessionStatus: record.sessionStatus,
    resolution: record.resolution,
    optiBuild: record.optiBuild,
    compatNote: record.compatNote
  }
}

async function compatNote(name: string): Promise<string | undefined> {
  const file = win32.join(cacheRoot(), 'compat.md')
  let markdown = ''
  try {
    const info = await stat(file)
    if (Date.now() - info.mtimeMs < 24 * 60 * 60 * 1000) markdown = await readFile(file, 'utf8')
  } catch { /* se vuelve a bajar */ }
  if (!markdown) {
    try {
      const response = await fetch(OPTISCALER_COMPAT_LIST_URL, { signal: AbortSignal.timeout(8_000) })
      if (response.ok) {
        markdown = await response.text()
        await mkdir(cacheRoot(), { recursive: true })
        await writeFile(file, markdown)
      }
    } catch (error) {
      log('warn', 'lista de compatibilidad no disponible', error)
    }
  }
  return compatNoteForGame(markdown, name) ?? undefined
}

async function locate(game: LibraryGame): Promise<{
  exeDir: string
  exeName: string
  installRoot: string
  names: string[]
  tree: Record<string, string>
  hasEngineDir: boolean
}> {
  const executablePath = game.local?.executablePath
  const installRoot = game.installDir || (executablePath ? win32.dirname(executablePath) : '')
  if (!installRoot) throw new Fsr4LiteFailure('no-exe')
  const walked = await walkInstall(installRoot)
  const relative = executablePath ? win32.relative(installRoot, executablePath).replace(/\\/g, '/') : ''
  const picked = relative && !relative.startsWith('..')
    ? { relativePath: relative }
    : selectGameExecutable(walked.files, walked.hasEngineDir)
  if (!picked) throw new Fsr4LiteFailure('no-exe')
  const exeDir = win32.dirname(win32.join(installRoot, ...picked.relativePath.split('/')))
  assertGameDirectory(exeDir)
  return {
    exeDir,
    exeName: win32.basename(picked.relativePath),
    installRoot,
    names: walked.files.map((file) => file.relativePath),
    tree: treeForExe(installRoot, exeDir, walked.files),
    hasEngineDir: walked.hasEngineDir
  }
}

async function deviceStatus(): Promise<Fsr4LiteStatus> {
  if (process.platform !== 'win32') {
    return { supported: false, device: { support: 'unsupported', gpuNames: [], egpuNote: false }, fsrSource: 'missing', optiBuild: null }
  }
  if (deviceCache && Date.now() - deviceCache.at < 60_000) return deviceCache.status
  let device = classifyFsr4Device({ adapters: [] })
  try {
    // Comillas simples: el shell de JS no puede comerse las variables de PowerShell.
    const output = await powershell([
      "$names = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })",
      "$cpu = ''; $model = ''; $maker = ''",
      "try { $cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name } catch {}",
      "try { $cs = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1; $model = [string]$cs.Model; $maker = [string]$cs.Manufacturer } catch {}",
      "[pscustomobject]@{ adapters = @($names); cpu = $cpu; model = $model; manufacturer = $maker } | ConvertTo-Json -Compress"
    ].join('; '))
    const parsed = JSON.parse(output) as { adapters?: unknown, cpu?: unknown, model?: unknown, manufacturer?: unknown }
    const adapters = Array.isArray(parsed.adapters)
      ? parsed.adapters.filter((item): item is string => typeof item === 'string')
      : typeof parsed.adapters === 'string' ? [parsed.adapters] : []
    device = classifyFsr4Device({
      adapters,
      cpu: typeof parsed.cpu === 'string' ? parsed.cpu : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      manufacturer: typeof parsed.manufacturer === 'string' ? parsed.manufacturer : undefined
    })
  } catch (error) {
    log('warn', 'no se pudieron leer las gráficas', error)
    device = { support: 'unknown', gpuNames: [], egpuNote: false }
  }
  const record = await readCacheRecord()
  const ready = await fsrReady()
  const build = await readCurrentBuild()
  const status: Fsr4LiteStatus = {
    supported: true,
    device,
    fsrSource: ready && record?.source ? record.source : 'missing',
    optiBuild: build?.build ?? null
  }
  deviceCache = { at: Date.now(), status }
  return status
}

async function preexistingReFramework(exeDir: string): Promise<string[]> {
  const names: string[] = []
  for (const entry of await readdir(exeDir, { withFileTypes: true }).catch(() => [])) {
    const lower = entry.name.toLowerCase()
    if (lower === 'reframework' || lower === REFRAMEWORK_DLL_NAME || lower.endsWith('_fw_config.txt') || lower.endsWith('_fw_log.txt')) {
      names.push(entry.name)
    }
  }
  return names
}

async function removeReFrameworkRuntime(exeDir: string, manifest: Fsr4LiteManifest): Promise<void> {
  if (!manifest.reframeworkAdded) return
  const keep = new Set(manifest.reframeworkPreexisting.map((name) => name.toLowerCase()))
  for (const entry of await readdir(exeDir, { withFileTypes: true }).catch(() => [])) {
    const lower = entry.name.toLowerCase()
    const runtime = lower === 'reframework' || lower === REFRAMEWORK_DLL_NAME || lower.endsWith('_fw_config.txt') || lower.endsWith('_fw_log.txt')
    if (runtime && !keep.has(lower)) await rm(win32.join(exeDir, entry.name), { recursive: true, force: true })
  }
}

async function installInto(game: LibraryGame): Promise<Fsr4LiteGameView> {
  if (!featureOn()) throw new Fsr4LiteFailure('disabled')
  if (busy) throw new Fsr4LiteFailure('busy')
  busy = true
  try {
    const hardware = await deviceStatus()
    if (hardware.device.support === 'unsupported') throw new Fsr4LiteFailure('unsupported-device')
    const located = await locate(game)
    const assessment = assessFsr4Target({
      provider: game.provider,
      installed: game.installed,
      executablePath: located.exeDir,
      installDir: located.installRoot,
      files: located.names,
      exeName: located.exeName,
      hasEngineDir: located.hasEngineDir
    })
    const record = readRecord(game.id)
    if (assessment.kind === 'widget') {
      const next = { ...record, widgetOwned: true, installed: false, exeDir: located.exeDir, block: undefined }
      saveRecord(next)
      inspectCache.delete(game.id)
      return viewFrom(next, true, 'widget')
    }
    if (assessment.block) throw new Fsr4LiteFailure(assessment.block)
    if (assessment.kind === 'installed') {
      const next = { ...record, installed: true, exeDir: located.exeDir, widgetOwned: false }
      saveRecord(next)
      inspectCache.delete(game.id)
      return viewFrom(next, true, 'installed')
    }
    const opti = await ensureOptiScaler(game.id, true)
    await ensureFsrDlls(game.id)
    const note = record.compatNote ?? await compatNote(game.name).catch(() => undefined)
    const addRef = assessment.needsReFramework || compatRequiresReFramework(note)
    const preexisting = addRef ? await preexistingReFramework(located.exeDir) : []
    const ownsRef = addRef && !preexisting.some((name) => name.toLowerCase() === REFRAMEWORK_DLL_NAME)
    const ref = ownsRef ? await ensureReFramework(game.id) : undefined
    const plan = planFsr4Install({
      tree: located.tree,
      packageFiles: await listPackageMap(opti.root),
      fsrDx12: 'dx12',
      fsrVk: 'vk',
      options: {
        overlay: record.overlay,
        renderScale: record.renderScale,
        graphicsApi: record.graphicsApi,
        hasFsr2Dll: assessment.hasFsr2,
        noUpscaler: assessment.noUpscaler
      },
      gameId: game.id,
      optiBuild: opti.build,
      nowIso: new Date().toISOString(),
      reframework: addRef ? { version: ref?.version ?? '', preexisting, dllContent: 'ref' } : undefined
    })
    // El manifiesto queda escrito antes de tocar archivos del juego.
    await writeManifest(located.exeDir, plan.manifest)
    for (const file of plan.files) {
      if (file.action === 'replace') await backupFile(located.exeDir, file.path)
    }
    for (const file of plan.files) {
      notify({ kind: 'progress', gameId: game.id, phase: 'copy', received: 1, total: plan.files.length })
      await copyPlanned(located.exeDir, opti.root, plan.proxyName, ref?.dll, file)
    }
    const saved: Fsr4GameRecord = {
      ...record,
      exeDir: located.exeDir,
      installed: true,
      widgetOwned: false,
      proxyName: plan.proxyName,
      optiBuild: opti.build,
      hasFsr2Dll: assessment.hasFsr2,
      noUpscaler: assessment.noUpscaler,
      upscalers: assessment.upscalers,
      block: undefined,
      antiCheat: undefined,
      compatNote: note,
      sessionStatus: 'none'
    }
    saveRecord(saved)
    inspectCache.delete(game.id)
    log('info', `instalado en ${located.exeDir} proxy=${plan.proxyName} build=${opti.build}`)
    return viewFrom(saved, true, 'installed')
  } finally {
    busy = false
  }
}

async function uninstallFrom(game: LibraryGame): Promise<Fsr4LiteGameView> {
  if (!featureOn()) throw new Fsr4LiteFailure('disabled')
  const record = readRecord(game.id)
  if (!record.exeDir || !record.installed) throw new Fsr4LiteFailure('not-installed')
  assertGameDirectory(record.exeDir)
  const manifest = await readManifest(record.exeDir)
  log('info', `quitando FSR 4.1 Lite de ${record.exeDir}`)
  for (const relative of manifest.replacedFiles) {
    const backup = contained(record.exeDir, `${FSR4_META_DIR}/backup/${relative}`)
    if (!await existsFile(backup)) continue
    const info = await stat(backup)
    const dest = contained(record.exeDir, relative)
    await mkdir(win32.dirname(dest), { recursive: true })
    await copyFile(backup, dest)
    await utimes(dest, info.atime, info.mtime)
  }
  for (const relative of manifest.createdFiles) await rm(contained(record.exeDir, relative), { force: true })
  for (const relative of [...manifest.createdDirs].sort((a, b) => b.length - a.length)) {
    await rm(contained(record.exeDir, relative), { recursive: true, force: true })
  }
  await removeReFrameworkRuntime(record.exeDir, manifest)
  await rm(win32.join(record.exeDir, FSR4_META_DIR), { recursive: true, force: true })
  const next: Fsr4GameRecord = { ...record, installed: false, proxyName: undefined, optiBuild: undefined, sessionStatus: 'none', resolution: undefined }
  saveRecord(next)
  inspectCache.delete(game.id)
  return viewFrom(next, true, 'ready')
}

async function refreshInstalled(build: CurrentBuild): Promise<void> {
  for (const record of Object.values(store().store)) {
    if (!record?.installed || !record.exeDir || !isNewerOptiBuild(record.optiBuild, build.build)) continue
    try {
      const manifest = await readManifest(record.exeDir)
      manifest.optiBuild = build.build
      await writeManifest(record.exeDir, manifest)
      for (const rel of Object.keys(await listPackageMap(build.root))) {
        const base = win32.basename(rel).toLowerCase()
        if ((FSR4_SKIP_PACKAGE_FILES as readonly string[]).includes(base)) continue
        if (base === 'optiscaler.ini' || base === FSR4_DLL_DX12 || base === FSR4_DLL_VK) continue
        const destRel = base === 'optiscaler.dll' && !rel.includes('/') ? manifest.proxyName : rel
        const dest = contained(record.exeDir, destRel)
        const source = base === 'optiscaler.dll' && !rel.includes('/')
          ? win32.join(build.root, 'OptiScaler.dll')
          : win32.join(build.root, ...rel.split('/'))
        // El manifiesto se actualiza antes de pisar el archivo, para poder deshacer.
        const alreadyOurs = manifest.createdFiles.some((item) => item.toLowerCase() === destRel.toLowerCase())
        const alreadyReplaced = manifest.replacedFiles.some((item) => item.toLowerCase() === destRel.toLowerCase())
        if (await existsFile(dest)) {
          if (!alreadyOurs && !alreadyReplaced) {
            await backupFile(record.exeDir, destRel)
            manifest.replacedFiles = [...manifest.replacedFiles, destRel]
            await writeManifest(record.exeDir, manifest)
          }
        } else if (!alreadyOurs) {
          manifest.createdFiles = [...manifest.createdFiles, destRel]
          const parent = destRel.includes('/') ? destRel.slice(0, destRel.lastIndexOf('/')) : ''
          if (parent && !manifest.createdDirs.some((dir) => dir.toLowerCase() === parent.toLowerCase())) {
            let parentExists = false
            try { parentExists = (await stat(contained(record.exeDir, parent))).isDirectory() } catch { parentExists = false }
            if (!parentExists) manifest.createdDirs = [...manifest.createdDirs, parent]
          }
          await writeManifest(record.exeDir, manifest)
        }
        await mkdir(win32.dirname(dest), { recursive: true })
        await copyFile(source, dest)
      }
      await writeManifest(record.exeDir, manifest)
      saveRecord({ ...record, optiBuild: build.build })
      log('info', `actualizado ${record.gameId} a ${build.build}`)
    } catch (error) {
      log('warn', `no se pudo actualizar ${record.gameId}`, error)
    }
  }
}

async function maybeUpdate(): Promise<void> {
  if (!featureOn() || !autoUpdateOn() || busy) return
  const last = await readLastCheck()
  if (!shouldRefreshOptiScaler({ enabled: true, platform: process.platform, now: Date.now(), lastCheckAt: last })) return
  const marker = win32.join(cacheRoot(), 'optiscaler', 'last-check.txt')
  await mkdir(win32.dirname(marker), { recursive: true })
  await writeFile(marker, String(Date.now()))
  try {
    const build = await ensureOptiScaler('launcher', true)
    await refreshInstalled(build)
  } catch (error) {
    log('warn', 'actualización automática falló', error)
  }
}

export const fsr4LiteService = {
  initialize(listener: (event: Fsr4LiteEvent) => void): void {
    notify = listener
    if (process.platform === 'win32') void maybeUpdate()
  },

  status: (): Promise<Fsr4LiteStatus> => deviceStatus(),

  async importDlls(window: BrowserWindow): Promise<Fsr4LiteStatus> {
    if (process.platform !== 'win32') throw new Fsr4LiteFailure('disabled')
    const picked = await dialog.showOpenDialog(window, {
      title: t('MT3K Launcher · Select FSR 4.1 Lite files'),
      buttonLabel: t('Use these FSR files'),
      message: t('Select amdxcffx64.dll and amdvkffx64.dll.'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('FSR driver files'), extensions: ['dll'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return deviceStatus()
    const byName = new Map(picked.filePaths.map((file) => [win32.basename(file).toLowerCase(), file]))
    const dx = byName.get(FSR4_DLL_DX12)
    const vk = byName.get(FSR4_DLL_VK)
    if (!dx || !vk) throw new Fsr4LiteFailure('dll')
    await validateDll(dx)
    await validateDll(vk)
    const dir = win32.join(cacheRoot(), 'fsr4')
    await mkdir(dir, { recursive: true })
    await copyFile(dx, win32.join(dir, FSR4_DLL_DX12))
    await copyFile(vk, win32.join(dir, FSR4_DLL_VK))
    await rememberFsr('imported', {})
    deviceCache = undefined
    log('info', 'DLL Lite importados')
    return deviceStatus()
  },

  gameGet(game: LibraryGame | undefined): Promise<Fsr4LiteGameView> {
    if (!game || !featureOn()) return Promise.resolve(viewFrom(blankRecord(game?.id ?? ''), process.platform === 'win32', 'hidden'))
    const cached = inspectCache.get(game.id)
    if (cached && Date.now() - cached.at < 120_000) return Promise.resolve(cached.view)
    return locate(game).then(async (located) => {
      const assessment = assessFsr4Target({
        provider: game.provider,
        installed: game.installed,
        executablePath: located.exeDir,
        installDir: located.installRoot,
        files: located.names,
        exeName: located.exeName,
        hasEngineDir: located.hasEngineDir
      })
      const record = readRecord(game.id)
      const note = await compatNote(game.name).catch(() => undefined)
      const next: Fsr4GameRecord = {
        ...record,
        exeDir: located.exeDir,
        installed: assessment.kind === 'installed',
        widgetOwned: assessment.kind === 'widget',
        upscalers: assessment.upscalers,
        hasFsr2Dll: assessment.hasFsr2,
        noUpscaler: assessment.noUpscaler,
        block: assessment.block,
        antiCheat: assessment.antiCheat,
        compatNote: note ?? record.compatNote
      }
      saveRecord(next)
      const phase: Fsr4LiteGameView['phase'] = assessment.kind === 'widget'
        ? 'widget'
        : assessment.kind === 'installed'
          ? 'installed'
          : assessment.kind === 'refused'
            ? 'blocked'
            : 'ready'
      const view = viewFrom(next, true, phase)
      inspectCache.set(game.id, { at: Date.now(), view })
      return view
    }).catch((error: unknown) => {
      const code = error instanceof Fsr4LiteFailure ? error.code : 'no-exe'
      const next = { ...readRecord(game.id), installed: false, block: code as Fsr4GameRecord['block'] }
      saveRecord(next)
      const view = viewFrom(next, true, 'blocked')
      inspectCache.set(game.id, { at: Date.now(), view })
      return view
    })
  },

  async setOptions(game: LibraryGame, value: unknown): Promise<Fsr4LiteGameView> {
    if (!featureOn()) throw new Fsr4LiteFailure('disabled')
    if (!value || typeof value !== 'object') throw new Fsr4LiteFailure('options')
    const row = value as Record<string, unknown>
    if (!isFsr4RenderScale(row.renderScale) || typeof row.overlay !== 'boolean' || !isFsr4GraphicsApi(row.graphicsApi)) {
      throw new Fsr4LiteFailure('options')
    }
    const record = { ...readRecord(game.id), renderScale: row.renderScale, overlay: row.overlay, graphicsApi: row.graphicsApi }
    if (record.installed && record.exeDir) {
      const iniPath = contained(record.exeDir, 'OptiScaler.ini')
      const nextIni = setIniValues(await readFile(iniPath, 'utf8'), iniAssignments({
        renderScale: row.renderScale,
        overlay: row.overlay,
        graphicsApi: row.graphicsApi,
        hasFsr2Dll: record.hasFsr2Dll,
        noUpscaler: record.noUpscaler
      }))
      const manifest = await readManifest(record.exeDir)
      await writeManifest(record.exeDir, { ...manifest, renderScale: row.renderScale, overlay: row.overlay, graphicsApi: row.graphicsApi })
      await writeFile(iniPath, nextIni)
      log('info', `opciones ${game.id} api=${row.graphicsApi} escala=${row.renderScale} overlay=${row.overlay}`)
    }
    saveRecord(record)
    inspectCache.delete(game.id)
    return viewFrom(record, true, record.installed ? 'installed' : record.widgetOwned ? 'widget' : 'ready')
  },

  install: (game: LibraryGame): Promise<Fsr4LiteGameView> => installInto(game),
  uninstall: (game: LibraryGame): Promise<Fsr4LiteGameView> => uninstallFrom(game),

  openGameBar(): void {
    if (process.platform !== 'win32') throw new Fsr4LiteFailure('disabled')
    // Hipótesis: este AppsFolder abre Xbox Game Bar. Si no, Win+G sigue sirviendo.
    spawn(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), [
      'shell:AppsFolder\\Microsoft.XboxGamingOverlay_8wekyb3d8bbwe!App'
    ], { detached: true, stdio: 'ignore' }).unref()
    log('info', 'pedido de abrir Game Bar')
  },

  async onSessionEnded(game: LibraryGame): Promise<void> {
    if (!featureOn()) return
    const record = readRecord(game.id)
    if (!record.installed || !record.exeDir) return
    const text = await readFile(win32.join(record.exeDir, 'OptiScaler.log'), 'utf8').catch(() => '')
    const parsed = parseOptiScalerSessionLog(text)
    const changed = record.sessionStatus !== parsed.status
    saveRecord({ ...record, sessionStatus: parsed.status, resolution: parsed.resolution })
    inspectCache.delete(game.id)
    log('info', `sesión ${game.id} ${parsed.status} ${parsed.resolution ?? ''}`.trim())
    if (changed) notify({ kind: 'session', gameId: game.id, status: parsed.status, resolution: parsed.resolution })
  },

  onFeatureEnabled(): void {
    deviceCache = undefined
    void maybeUpdate()
  }
}
