/**
 * FSR 4.1 Lite en el proceso principal. En Windows baja OptiScaler tal cual,
 * copia los DLL Lite y guarda un manifiesto para devolver la carpeta igual.
 * En macOS el servicio no toca disco: la UI se esconde.
 */
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, type Dirent } from 'node:fs'
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
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
  FSR4_DOWNLOAD_TIMEOUT_MS,
  FSR4_LITE_DOWNLOAD_BASE,
  FSR4_LITE_LOG,
  FSR4_LOG_READ_CAP,
  FSR4_MAX_DOWNLOAD_BYTES,
  FSR4_META_DIR,
  FSR4_SKIP_PACKAGE_FILES,
  FSR4_WALK_MAX_FILES,
  OPTI_FAIL_BACKOFF_MS,
  OPTISCALER_COMPAT_LIST_URL,
  OPTISCALER_NIGHTLY_API,
  REFRAMEWORK_CONFIG_NAME,
  REFRAMEWORK_DLL_NAME,
  REFRAMEWORK_LATEST_ZIP,
  Fsr4LiteFailure,
  acceptDownloadDigest,
  acceptDownloadSize,
  classifyListedNode,
  committedCreateAction,
  committedReplaceAction,
  finalDownloadUrlIsHttps,
  gameLaunchBlocksMutation,
  journalBackup,
  journalCopyIntent,
  manifestIsLegacyCommitted,
  mayRecursivelyRemoveDir,
  mayRemoveInstallMeta,
  normalizeStoredManifest,
  pendingCreateAction,
  pendingReplaceAction,
  resolveUnderRoot,
  rootedDirectoryAllowed,
  scanIsIncomplete,
  hasWidgetManifest,
  resolveGameGetWidgetHandoff,
  sessionObservation,
  shouldUninstallBeforeWidget,
  assessFsr4Target,
  assessOptiScalerArchiveEntries,
  assessReFrameworkArchiveEntries,
  classifyFsr4Device,
  classifyGameRoot,
  createFsr4MutationGate,
  fsrCacheIsReusable,
  gameDirWithinInstall,
  compatNoteForGame,
  compatRequiresReFramework,
  iniAssignments,
  isFsr4GraphicsApi,
  isFsr4RenderScale,
  isNewerOptiBuild,
  isWindowsAppsPath,
  launcherMayUpdate,
  pickOptiScalerNightly,
  planFsr4Install,
  resolveGameExecutable,
  sessionLogIsFresh,
  setIniValues,
  shouldRefreshOptiScaler,
  validateFsrDriverFile,
  walkDirectoryDecision,
  widgetFsr4CacheDirectories,
  type Fsr4CacheRecord,
  type Fsr4FileDigest,
  type Fsr4FileSource,
  type Fsr4ManifestState,
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

interface Fsr4GameRecord {
  gameId: string
  exeDir?: string
  installRoot?: string
  installed: boolean
  widgetOwned: boolean
  proxyName?: string
  /** Quedó una copia a medias y hay que repararla. El manifiesto no se bota. */
  repairNeeded?: boolean
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
  /** True solo si la consulta a GitHub respondió bien en esta pasada. */
  remoteChecked?: boolean
}

let notify: (event: Fsr4LiteEvent) => void = () => undefined
let games: Store<Record<string, Fsr4GameRecord>> | undefined
let deviceCache: { at: number, status: Fsr4LiteStatus } | undefined
const inspectCache = new Map<string, { at: number, view: Fsr4LiteGameView }>()
const mutationGate = createFsr4MutationGate()
let sessionState: () => { gameId?: string, phase?: string, startedAt?: number } = () => ({})

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

function assertGameDirectory(dir: string, installRoot?: string): void {
  const refusal = classifyGameRoot(dir)
  if (refusal === 'windows-apps' || isWindowsAppsPath(dir)) throw new Fsr4LiteFailure('windows-apps')
  if (refusal) throw new Fsr4LiteFailure('no-exe')
  if (installRoot && !gameDirWithinInstall(dir, installRoot)) throw new Fsr4LiteFailure('no-exe')
}

function assertNotRunning(gameId: string): void {
  const status = sessionState()
  if (status.gameId === gameId && gameLaunchBlocksMutation(status.phase)) {
    throw new Fsr4LiteFailure('running')
  }
}

async function listedKind(path: string): Promise<{ kind: ReturnType<typeof classifyListedNode>, realPath: string | null }> {
  const listed = await lstat(path).catch(() => null)
  if (!listed) return { kind: 'missing', realPath: null }
  const followed = listed.isSymbolicLink() ? await stat(path).catch(() => null) : null
  const kind = classifyListedNode({
    isSymbolicLink: listed.isSymbolicLink(),
    isDirectory: listed.isDirectory(),
    isFile: listed.isFile(),
    nlink: listed.nlink,
    targetIsDirectory: followed?.isDirectory() === true
  })
  const realPath = kind === 'missing' ? null : await realpath(path).catch(() => null)
  return { kind, realPath }
}

/**
 * La carpeta del juego puede ser un junction o un symlink de directorio
 * (Steam los usa al mover una librería). Se acepta si el realpath queda
 * dentro de la raíz real. Un enlace de archivo no.
 */
async function assertRealRoot(dir: string, installRoot: string): Promise<string> {
  assertGameDirectory(dir, installRoot)
  const installNode = await listedKind(installRoot)
  const realInstall = installNode.realPath
  if (!realInstall || !rootedDirectoryAllowed({ kind: installNode.kind, realPath: realInstall, installRootReal: realInstall })) {
    throw new Fsr4LiteFailure(installNode.kind === 'missing' ? 'no-exe' : 'symlink')
  }
  assertGameDirectory(realInstall, realInstall)
  const node = dir === installRoot ? { kind: installNode.kind, realPath: realInstall } : await listedKind(dir)
  const real = node.realPath
  if (!real || !rootedDirectoryAllowed({ kind: node.kind, realPath: real, installRootReal: realInstall })) {
    throw new Fsr4LiteFailure(node.kind === 'missing' ? 'no-exe' : 'symlink')
  }
  assertGameDirectory(real, realInstall)
  return real
}

/** Cada tramo se mira con lstat. Carpeta reparseada sí, si no se sale. Archivo enlazado, no. */
async function containedReal(rootReal: string, relative: string): Promise<string> {
  return resolveUnderRoot({
    rootReal,
    relative,
    lstat: async (absolute) => lstat(absolute).catch(() => null),
    stat: async (absolute) => stat(absolute).catch(() => null),
    realpath,
    join: (dir, name) => win32.join(dir, name)
  })
}

async function withMutation<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  if (!mutationGate.tryAcquire(owner)) throw new Fsr4LiteFailure('busy')
  try {
    return await fn()
  } finally {
    mutationGate.release(owner)
  }
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
  expectedSize?: number | null
  maxBytes?: number
  timeoutMs?: number
  onProgress?: (received: number, total: number) => void
}): Promise<{ etag?: string, finalUrl: string, size: number, sha256: string }> {
  const maxBytes = options.maxBytes ?? FSR4_MAX_DOWNLOAD_BYTES
  // Solo https. Se sigue el redirect y se vuelve a mirar la URL final.
  if (!finalDownloadUrlIsHttps(url)) throw new Fsr4LiteFailure('download')
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MT3K-Launcher', ...options.headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? FSR4_DOWNLOAD_TIMEOUT_MS)
  })
  if (!response.ok || !response.body) throw new Fsr4LiteFailure('download')
  if (!finalDownloadUrlIsHttps(response.url)) throw new Fsr4LiteFailure('download')
  const lengthHeader = response.headers.get('content-length')
  const contentLength = lengthHeader == null || lengthHeader === '' ? null : Number(lengthHeader)
  if (contentLength != null && (!Number.isFinite(contentLength) || contentLength > maxBytes)) {
    throw new Fsr4LiteFailure('download')
  }
  if (options.expectedSize && contentLength != null && contentLength !== options.expectedSize) {
    throw new Fsr4LiteFailure('download')
  }
  const total = contentLength ?? 0
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
      received += buf.length
      if (received > maxBytes) throw new Fsr4LiteFailure('download')
      hash.update(buf)
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
  const sha256 = hash.digest('hex')
  if (!acceptDownloadSize({ received, contentLength, expectedSize: options.expectedSize, maxBytes })) {
    await rm(tmp, { force: true })
    throw new Fsr4LiteFailure('download')
  }
  if (options.digest && !acceptDownloadDigest(options.digest, sha256)) {
    await rm(tmp, { force: true })
    throw new Fsr4LiteFailure('digest')
  }
  await rm(dest, { force: true })
  await rename(tmp, dest)
  return { etag, finalUrl: response.url, size: received, sha256 }
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

function listArchive(archive: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(TAR, ['-tf', archive], { windowsHide: true, timeout: 60_000, maxBuffer: 8_000_000 }, (error, stdout) => {
      if (error) reject(new Fsr4LiteFailure('tar'))
      else resolve(String(stdout ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0))
    })
  })
}

async function collectExtracted(root: string): Promise<{ path: string, kind: 'file' | 'dir' | 'link' }[]> {
  const entries: { path: string, kind: 'file' | 'dir' | 'link' }[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = win32.join(dir, entry.name)
      const relative = win32.relative(root, full).replace(/\\/g, '/')
      if (entry.isSymbolicLink()) {
        entries.push({ path: relative, kind: 'link' })
        continue
      }
      if (entry.isDirectory()) {
        entries.push({ path: relative, kind: 'dir' })
        await walk(full)
        continue
      }
      entries.push({ path: relative, kind: 'file' })
    }
  }
  await walk(root)
  return entries
}

/**
 * Extrae a una carpeta temporal. Si alguna entrada se sale, es un enlace
 * o no es el layout esperado, esa carpeta se borra y la caché vieja se queda.
 */
async function extractValidated(archive: string, dest: string, kind: 'opti' | 'ref'): Promise<void> {
  const staging = `${dest}.staging`
  await rm(staging, { recursive: true, force: true })
  const listed = (await listArchive(archive)).map((path) => ({
    path,
    kind: path.includes('->') ? 'link' as const : 'file' as const
  }))
  const preview = kind === 'opti' ? assessOptiScalerArchiveEntries(listed) : assessReFrameworkArchiveEntries(listed)
  if (!preview.ok) throw new Fsr4LiteFailure(kind === 'opti' ? 'layout' : 'reframework')
  try {
    await extractArchive(archive, staging)
    const walked = await collectExtracted(staging)
    const verdict = kind === 'opti' ? assessOptiScalerArchiveEntries(walked) : assessReFrameworkArchiveEntries(walked)
    if (!verdict.ok) throw new Fsr4LiteFailure(kind === 'opti' ? 'layout' : 'reframework')
    await rm(dest, { recursive: true, force: true })
    await rename(staging, dest)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (error instanceof Fsr4LiteFailure) throw error
    throw new Fsr4LiteFailure('tar')
  }
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

async function hashFile(path: string): Promise<Fsr4FileDigest> {
  const data = await readFile(path)
  return { size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
}

async function readPeHeader(path: string): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(4096)
    await handle.read(header, 0, header.length, 0)
    return header
  } finally {
    await handle.close()
  }
}

async function validateDll(path: string): Promise<Fsr4FileDigest> {
  const info = await stat(path)
  const header = await readPeHeader(path)
  const company = await companyName(path)
  const result = validateFsrDriverFile({ fileName: win32.basename(path), size: info.size, header, company })
  if (!result.ok) throw new Fsr4LiteFailure('dll')
  return hashFile(path)
}

async function fsrReady(): Promise<boolean> {
  try {
    const record = await readCacheRecord()
    const dir = win32.join(cacheRoot(), 'fsr4')
    const files: { name: string, size: number, sha256: string, header: Uint8Array, company: string | null }[] = []
    for (const name of [FSR4_DLL_DX12, FSR4_DLL_VK]) {
      const path = win32.join(dir, name)
      const info = await stat(path)
      const header = await readPeHeader(path)
      const digest = await hashFile(path)
      files.push({ name, size: info.size, sha256: digest.sha256, header, company: await companyName(path) })
    }
    return fsrCacheIsReusable({ record, files })
  } catch {
    return false
  }
}

async function rememberFsr(source: Exclude<Fsr4FileSource, 'missing'>, etags: Record<string, string | undefined>): Promise<void> {
  const dir = win32.join(cacheRoot(), 'fsr4')
  const previous = await readCacheRecord()
  const files: Fsr4CacheRecord['files'] = []
  for (const name of [FSR4_DLL_DX12, FSR4_DLL_VK]) {
    const digest = await hashFile(win32.join(dir, name))
    const etag = etags[name]
    files.push(etag ? { name, size: digest.size, sha256: digest.sha256, etag } : { name, size: digest.size, sha256: digest.sha256 })
  }
  const record: Fsr4CacheRecord = {
    source,
    files,
    recordedAt: new Date().toISOString(),
    reframework: previous?.reframework
  }
  await mkdir(dir, { recursive: true })
  await writeFile(win32.join(dir, 'record.json'), JSON.stringify(record, null, 2))
}

async function rememberReFramework(version: string, zipSha256: string, dllSha256: string): Promise<void> {
  const dir = win32.join(cacheRoot(), 'fsr4')
  const previous = await readCacheRecord()
  const record: Fsr4CacheRecord = {
    source: previous?.source ?? 'downloaded',
    files: previous?.files ?? [],
    recordedAt: new Date().toISOString(),
    reframework: { version, zipSha256, dllSha256 }
  }
  await mkdir(dir, { recursive: true })
  await writeFile(win32.join(dir, 'record.json'), JSON.stringify(record, null, 2))
}

async function readCacheRecord(): Promise<Fsr4CacheRecord | null> {
  try {
    return JSON.parse(await readFile(win32.join(cacheRoot(), 'fsr4', 'record.json'), 'utf8')) as Fsr4CacheRecord
  } catch {
    return null
  }
}

/** Valida en una carpeta temporal y solo entonces publica el par en la caché. */
async function publishFsrPair(staging: string, source: Exclude<Fsr4FileSource, 'missing'>, etags: Record<string, string | undefined>): Promise<void> {
  const destDir = win32.join(cacheRoot(), 'fsr4')
  await mkdir(destDir, { recursive: true })
  for (const name of [FSR4_DLL_DX12, FSR4_DLL_VK]) await validateDll(win32.join(staging, name))
  for (const name of [FSR4_DLL_DX12, FSR4_DLL_VK]) {
    const finalPath = win32.join(destDir, name)
    await rm(finalPath, { force: true })
    await rename(win32.join(staging, name), finalPath)
  }
  await rememberFsr(source, etags)
}

/** Primero la caché del widget, si valida; si no, el bucket público. */
async function ensureFsrDlls(gameId: string): Promise<void> {
  if (await fsrReady()) return
  const destDir = win32.join(cacheRoot(), 'fsr4')
  const staging = win32.join(destDir, 'incoming')
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    const local = process.env.LOCALAPPDATA
    if (local) {
      for (const dir of widgetFsr4CacheDirectories(local)) {
        const dx = win32.join(dir, FSR4_DLL_DX12)
        const vk = win32.join(dir, FSR4_DLL_VK)
        if (!await existsFile(dx) || !await existsFile(vk)) continue
        try {
          await validateDll(dx)
          await validateDll(vk)
          await copyFile(dx, win32.join(staging, FSR4_DLL_DX12))
          await copyFile(vk, win32.join(staging, FSR4_DLL_VK))
          await publishFsrPair(staging, 'widget-cache', {})
          log('info', 'DLL Lite tomados de la caché del widget')
          return
        } catch (error) {
          log('warn', 'la caché del widget no pasó la validación', error)
          await rm(staging, { recursive: true, force: true })
          await mkdir(staging, { recursive: true })
        }
      }
    }
    const etags: Record<string, string | undefined> = {}
    for (const name of [FSR4_DLL_DX12, FSR4_DLL_VK]) {
      const result = await downloadTo(`${FSR4_LITE_DOWNLOAD_BASE}/${name}`, win32.join(staging, name), {
        maxBytes: FSR4_MAX_DOWNLOAD_BYTES,
        onProgress: (received, total) => notify({ kind: 'progress', gameId, phase: 'fsr', received, total: total || 158_000_000 })
      })
      etags[name] = result.etag
    }
    await publishFsrPair(staging, 'downloaded', etags)
    log('info', 'DLL Lite descargados')
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
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
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue
    const nested = win32.join(dir, entry.name)
    if (await existsFile(win32.join(nested, 'OptiScaler.dll'))) return nested
  }
  throw new Fsr4LiteFailure('layout')
}

async function ensureOptiScaler(gameId: string, checkRemote: boolean): Promise<CurrentBuild> {
  const current = await readCurrentBuild()
  if (current && !checkRemote) return current
  let asset: ReturnType<typeof pickOptiScalerNightly> = null
  let remoteChecked = false
  try {
    const response = await fetch(OPTISCALER_NIGHTLY_API, {
      headers: { 'User-Agent': 'MT3K-Launcher', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000)
    })
    if (response.ok) {
      remoteChecked = true
      asset = pickOptiScalerNightly(await response.json())
    }
  } catch (error) {
    log('warn', 'no se pudo consultar OptiScaler', error)
  }
  if (!asset || (current && !isNewerOptiBuild(current.build, asset.name))) {
    if (current) return { ...current, remoteChecked }
    throw new Fsr4LiteFailure('download')
  }
  const incoming = win32.join(cacheRoot(), 'optiscaler', 'incoming.7z')
  log('info', `bajando ${asset.name}`)
  await downloadTo(asset.url, incoming, {
    digest: asset.digest,
    expectedSize: asset.size > 0 ? asset.size : null,
    maxBytes: FSR4_MAX_DOWNLOAD_BYTES,
    onProgress: (received, total) => notify({
      kind: 'progress', gameId, phase: 'optiscaler', received, total: total || asset.size || 57_000_000
    })
  })
  const extracted = win32.join(cacheRoot(), 'optiscaler', 'extracted')
  try {
    await extractValidated(incoming, extracted, 'opti')
  } finally {
    await rm(incoming, { force: true })
  }
  const root = await findPackageRoot(extracted)
  const next = { build: asset.name, root }
  await mkdir(win32.dirname(win32.join(cacheRoot(), 'optiscaler', 'current.json')), { recursive: true })
  await writeFile(win32.join(cacheRoot(), 'optiscaler', 'current.json'), JSON.stringify(next))
  log('info', `OptiScaler listo: ${asset.name}`)
  return { ...next, remoteChecked: true }
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
    if (entry.isSymbolicLink()) continue
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
    const recorded = (await readCacheRecord())?.reframework
    const digest = await hashFile(dll)
    if (recorded?.dllSha256 && recorded.dllSha256 === digest.sha256) {
      return { version: recorded.version || (await readFile(versionFile, 'utf8').catch(() => 'nightly')).trim() || 'nightly', dll }
    }
  }
  const zip = win32.join(dir, 'REFramework.zip')
  const result = await downloadTo(REFRAMEWORK_LATEST_ZIP, zip, {
    maxBytes: 80 * 1024 * 1024,
    onProgress: (received, total) => notify({ kind: 'progress', gameId, phase: 'reframework', received, total })
  })
  const tag = /\/releases\/download\/([^/]+)\//i.exec(result.finalUrl)?.[1] ?? 'nightly'
  const unpacked = win32.join(dir, 'unpacked')
  await extractValidated(zip, unpacked, 'ref')
  const found = await findNamedFile(unpacked, REFRAMEWORK_DLL_NAME)
  if (!found) throw new Fsr4LiteFailure('reframework')
  await mkdir(dir, { recursive: true })
  await copyFile(found, dll)
  const dllDigest = await hashFile(dll)
  await rememberReFramework(tag, result.sha256, dllDigest.sha256)
  await writeFile(versionFile, tag)
  await writeFile(marker, String(Date.now()))
  await rm(unpacked, { recursive: true, force: true })
  await rm(zip, { force: true })
  log('info', `REFramework ${tag}`)
  return { version: tag, dll }
}

async function walkInstall(root: string): Promise<{
  files: { relativePath: string, size: number }[]
  dirs: string[]
  hasEngineDir: boolean
  truncated: boolean
}> {
  const files: { relativePath: string, size: number }[] = []
  const dirs: string[] = []
  let hasEngineDir = false
  let truncated = false
  const stack: { dir: string, depth: number }[] = [{ dir: root, depth: 0 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    let entries: Dirent[]
    try {
      entries = await readdir(current.dir, { withFileTypes: true })
    } catch {
      // Si una carpeta no se puede leer, no se da el juego por limpio.
      truncated = scanIsIncomplete({ unreadableDirectory: true, fileCapHit: false })
      continue
    }
    for (const entry of entries) {
      if (files.length >= FSR4_WALK_MAX_FILES) {
        truncated = scanIsIncomplete({ unreadableDirectory: false, fileCapHit: true })
        break
      }
      if (entry.isSymbolicLink()) continue
      const full = win32.join(current.dir, entry.name)
      const relativePath = win32.relative(root, full).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (current.depth === 0 && entry.name.toLowerCase() === 'engine') hasEngineDir = true
        dirs.push(relativePath)
        if (walkDirectoryDecision(entry.name, current.depth) === 'descend') {
          stack.push({ dir: full, depth: current.depth + 1 })
        }
        continue
      }
      if (!entry.isFile()) continue
      let size = 0
      if (entry.name.toLowerCase().endsWith('.exe')) {
        try { size = (await stat(full)).size } catch { size = 0 }
      }
      files.push({ relativePath, size })
    }
    if (truncated) break
  }
  return { files, dirs, hasEngineDir, truncated }
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
      if (entry.isSymbolicLink()) continue
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
  // El manifiesto pasa por el mismo chequeo físico. Un .mt3k-fsr enlazado pa' fuera se niega.
  const dir = await containedReal(exeDir, FSR4_META_DIR)
  await mkdir(dir, { recursive: true })
  const realDir = await realpath(dir)
  if (!gameDirWithinInstall(realDir, exeDir)) throw new Fsr4LiteFailure('symlink')
  const target = win32.join(realDir, 'manifest.json')
  const tmp = `${target}.tmp`
  await writeFile(tmp, JSON.stringify(manifest, null, 2))
  await rename(tmp, target)
}

function digestNamed(record: Record<string, Fsr4FileDigest> | undefined, relative: string): Fsr4FileDigest | undefined {
  if (!record) return undefined
  const want = relative.toLowerCase()
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === want) return value
  }
  return undefined
}

async function backupIsPresent(exeDir: string, relative: string): Promise<boolean> {
  try {
    const backup = await containedReal(exeDir, `${FSR4_META_DIR}/backup/${relative}`)
    return await existsFile(backup)
  } catch {
    return false
  }
}

async function readManifest(exeDir: string): Promise<Fsr4LiteManifest> {
  const manifestPath = await containedReal(exeDir, `${FSR4_META_DIR}/manifest.json`)
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  const replaced = raw && typeof raw === 'object' && Array.isArray((raw as { replacedFiles?: unknown }).replacedFiles)
    ? (raw as { replacedFiles: unknown[] }).replacedFiles.filter((item): item is string => typeof item === 'string')
    : []
  const present = new Set<string>()
  // El manifiesto viejo no trae state. Se mira el disco pa' no tratarlo como pending vacío.
  if (raw && typeof raw === 'object' && (raw as { state?: unknown }).state == null) {
    for (const relative of replaced) {
      if (await backupIsPresent(exeDir, relative)) present.add(relative.toLowerCase())
    }
  }
  return normalizeStoredManifest(raw, (relative) => present.has(relative.toLowerCase()))
}

async function manifestStateOf(exeDir: string): Promise<Fsr4ManifestState | 'absent'> {
  try {
    return (await readManifest(exeDir)).state
  } catch (error) {
    if (error instanceof Fsr4LiteFailure && (error.code === 'manifest' || error.code === 'symlink' || error.code === 'bad-path')) throw error
    return 'absent'
  }
}

async function backupFile(exeDir: string, relative: string): Promise<Fsr4FileDigest> {
  const source = await containedReal(exeDir, relative)
  const backup = await containedReal(exeDir, `${FSR4_META_DIR}/backup/${relative}`)
  await mkdir(win32.dirname(backup), { recursive: true })
  const info = await stat(source)
  await copyFile(source, backup)
  await utimes(backup, info.atime, info.mtime)
  return hashFile(backup)
}

async function packageFile(root: string, relative: string): Promise<string | null> {
  let current = root
  for (const part of relative.split('/')) {
    const entries = await readdir(current).catch(() => [] as string[])
    const hit = entries.find((name) => name.toLowerCase() === part.toLowerCase())
    if (!hit) return null
    current = win32.join(current, hit)
  }
  return await existsFile(current) ? current : null
}

function digestBuffer(data: Buffer): Fsr4FileDigest {
  return { size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
}

/** Huella de los bytes que se van a copiar, antes de tocar la carpeta del juego. */
async function plannedDigest(packageRoot: string, proxyName: string, refDll: string | undefined, file: { path: string, content: string }): Promise<Fsr4FileDigest> {
  const base = win32.basename(file.path).toLowerCase()
  if (base === 'optiscaler.ini' || base === REFRAMEWORK_CONFIG_NAME.toLowerCase()) return digestBuffer(Buffer.from(file.content, 'utf8'))
  if (base === FSR4_DLL_DX12 || base === FSR4_DLL_VK) return hashFile(win32.join(cacheRoot(), 'fsr4', base))
  if (base === REFRAMEWORK_DLL_NAME) {
    if (!refDll) throw new Fsr4LiteFailure('reframework')
    return hashFile(refDll)
  }
  if (file.path.toLowerCase() === proxyName.toLowerCase()) return hashFile(win32.join(packageRoot, 'OptiScaler.dll'))
  const fromPackage = await packageFile(packageRoot, file.path)
  if (!fromPackage) throw new Fsr4LiteFailure('layout')
  return hashFile(fromPackage)
}

async function copyPlanned(exeDir: string, packageRoot: string, proxyName: string, refDll: string | undefined, file: { path: string, content: string }): Promise<string> {
  const dest = await containedReal(exeDir, file.path)
  await mkdir(win32.dirname(dest), { recursive: true })
  const base = win32.basename(file.path).toLowerCase()
  if (base === 'optiscaler.ini' || base === REFRAMEWORK_CONFIG_NAME.toLowerCase()) {
    await writeFile(dest, file.content)
    return dest
  }
  if (base === FSR4_DLL_DX12 || base === FSR4_DLL_VK) {
    await copyFile(win32.join(cacheRoot(), 'fsr4', base), dest)
    return dest
  }
  if (base === REFRAMEWORK_DLL_NAME) {
    if (!refDll) throw new Fsr4LiteFailure('reframework')
    await copyFile(refDll, dest)
    return dest
  }
  if (file.path.toLowerCase() === proxyName.toLowerCase()) {
    await copyFile(win32.join(packageRoot, 'OptiScaler.dll'), dest)
    return dest
  }
  const fromPackage = await packageFile(packageRoot, file.path)
  if (fromPackage) {
    await copyFile(fromPackage, dest)
    return dest
  }
  throw new Fsr4LiteFailure('layout')
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
  dirs: string[]
  tree: Record<string, string>
  hasEngineDir: boolean
  truncated: boolean
}> {
  const executablePath = game.local?.executablePath
  const installRoot = game.installDir || (executablePath ? win32.dirname(executablePath) : '')
  if (!installRoot) throw new Fsr4LiteFailure('no-exe')
  // Se rechaza la raíz (enlace, Windows, Program Files) antes de listar nada.
  const realInstall = await assertRealRoot(installRoot, installRoot)
  const walked = await walkInstall(realInstall)
  const relative = executablePath ? win32.relative(realInstall, executablePath).replace(/\\/g, '/') : ''
  const stored = relative && !relative.startsWith('..') ? relative : null
  const picked = resolveGameExecutable({
    storedRelative: stored,
    entries: walked.files,
    hasEngineDir: walked.hasEngineDir
  })
  if (!picked) throw new Fsr4LiteFailure('no-exe')
  const exeDir = win32.dirname(win32.join(realInstall, ...picked.relativePath.split('/')))
  const realExe = await assertRealRoot(exeDir, realInstall)
  return {
    exeDir: realExe,
    exeName: win32.basename(picked.relativePath),
    installRoot: realInstall,
    names: walked.files.map((file) => file.relativePath),
    dirs: walked.dirs,
    tree: treeForExe(realInstall, realExe, walked.files),
    hasEngineDir: walked.hasEngineDir,
    truncated: walked.truncated
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

async function removeEmptyCreatedDirs(exeDir: string, dirs: readonly string[]): Promise<void> {
  const ordered = [...dirs].sort((a, b) => b.length - a.length)
  for (const relative of ordered) {
    if (relative.replace(/\\/g, '/').toLowerCase().startsWith('.ralfsr')) continue
    const dir = await containedReal(exeDir, relative).catch(() => null)
    if (!dir) continue
    const entries = await readdir(dir).catch(() => null)
    // Recursivo solo si la carpeta es nuestra y está vacía. Un archivo ajeno la deja quieta.
    if (mayRecursivelyRemoveDir({ createdByUs: true, entryNames: entries })) {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function backupTreeHasFiles(exeDir: string): Promise<boolean> {
  const root = await containedReal(exeDir, `${FSR4_META_DIR}/backup`).catch(() => null)
  if (!root) return false
  // Si la carpeta no existe, no hay backups. Si no se puede leer, se asume que sí.
  const listed = await lstat(root).catch(() => null)
  if (!listed) return false
  if (listed.isSymbolicLink() || !listed.isDirectory()) return true
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    const entries = await readdir(current, { withFileTypes: true }).catch(() => null)
    if (!entries) return true
    for (const entry of entries) {
      if (entry.isSymbolicLink()) return true
      const full = win32.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else return true
    }
  }
  return false
}

/** Baja por las carpetas vacías. No borra un directorio que todavía tenga un archivo. */
async function removeEmptyDirsUnder(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => null)
  if (!entries) return
  for (const entry of entries) {
    if (!entry.isSymbolicLink() && entry.isDirectory()) {
      await removeEmptyDirsUnder(win32.join(root, entry.name))
    }
  }
  const left = await readdir(root).catch(() => null)
  if (mayRecursivelyRemoveDir({ createdByUs: true, entryNames: left })) {
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * Borra la metadata solo cuando ya no quedan backups.
 * Primero se quitan los backups restaurados; si queda un archivo, la carpeta se queda.
 */
async function removeMetaIfEmptyOfBackups(exeDir: string, restored: readonly string[]): Promise<boolean> {
  for (const relative of restored) {
    const backup = await containedReal(exeDir, `${FSR4_META_DIR}/backup/${relative}`).catch(() => null)
    if (backup && await existsFile(backup)) await rm(backup, { force: true })
  }
  if (await backupTreeHasFiles(exeDir)) return false
  const dir = await containedReal(exeDir, FSR4_META_DIR).catch(() => null)
  if (!dir) return false
  const manifestPath = win32.join(dir, 'manifest.json')
  await rm(manifestPath, { force: true })
  await rm(`${manifestPath}.tmp`, { force: true })
  await removeEmptyDirsUnder(dir)
  return true
}

async function assessLocated(game: LibraryGame, located: Awaited<ReturnType<typeof locate>>): Promise<ReturnType<typeof assessFsr4Target>> {
  return assessFsr4Target({
    provider: game.provider,
    installed: game.installed,
    executablePath: game.local?.executablePath || located.exeDir,
    installDir: located.installRoot,
    files: located.names,
    dirs: located.dirs,
    exeName: located.exeName,
    hasEngineDir: located.hasEngineDir,
    scanTruncated: located.truncated,
    manifestState: await manifestStateOf(located.exeDir)
  })
}

function touchesWidgetPath(relative: string): boolean {
  const top = relative.replace(/\\/g, '/').split('/')[0]?.toLowerCase()
  return top === '.ralfsr'
}

async function digestIfFile(path: string): Promise<Fsr4FileDigest | null> {
  if (!await existsFile(path)) return null
  return hashFile(path)
}

async function backupLooksRight(exeDir: string, relative: string, manifest: Fsr4LiteManifest): Promise<{ ok: boolean, digest: Fsr4FileDigest | null }> {
  const backup = await containedReal(exeDir, `${FSR4_META_DIR}/backup/${relative}`).catch(() => null)
  if (!backup) return { ok: false, digest: null }
  const digest = await digestIfFile(backup)
  if (!digest) return { ok: false, digest: null }
  const expected = digestNamed(manifest.backupDigests, relative)
  if (expected && (digest.sha256 !== expected.sha256 || digest.size !== expected.size)) return { ok: false, digest }
  return { ok: true, digest }
}

async function restoreBackupFile(exeDir: string, relative: string): Promise<void> {
  const backup = await containedReal(exeDir, `${FSR4_META_DIR}/backup/${relative}`)
  const dest = await containedReal(exeDir, relative)
  const info = await stat(backup)
  await mkdir(win32.dirname(dest), { recursive: true })
  await copyFile(backup, dest)
  await utimes(dest, info.atime, info.mtime)
}

/**
 * Deshace una copia a medias. Si el archivo ya no es el que escribimos, no se pisa.
 * La carpeta .mt3k-fsr se queda mientras tenga un backup que no se restauró.
 */
async function rollbackPending(exeDir: string, manifest: Fsr4LiteManifest): Promise<string[]> {
  const skipped: string[] = []
  const unrestored: string[] = []
  const restored: string[] = []
  for (const relative of manifest.backedUpFiles) {
    if (touchesWidgetPath(relative)) continue
    const looked = await backupLooksRight(exeDir, relative, manifest)
    const dest = await containedReal(exeDir, relative).catch(() => null)
    const current = dest ? await digestIfFile(dest) : null
    const action = pendingReplaceAction({
      current,
      written: digestNamed(manifest.writtenDigests, relative) ?? null,
      backup: looked.digest,
      backupOk: looked.ok
    })
    if (action === 'missing' || action === 'skip') {
      skipped.push(relative)
      unrestored.push(relative)
      continue
    }
    if (action === 'restore') await restoreBackupFile(exeDir, relative)
    restored.push(relative)
  }
  for (const relative of manifest.copiedCreates) {
    if (touchesWidgetPath(relative)) continue
    const dest = await containedReal(exeDir, relative).catch(() => null)
    const current = dest ? await digestIfFile(dest) : null
    const action = pendingCreateAction({
      current,
      expected: digestNamed(manifest.createdDigests, relative) ?? null
    })
    if (action === 'delete' && dest) await rm(dest, { force: true })
    else if (action === 'skip') skipped.push(relative)
  }
  await removeEmptyCreatedDirs(exeDir, manifest.createdDirs)
  if (mayRemoveInstallMeta({ skipped, unrestoredBackups: unrestored })) {
    const removed = await removeMetaIfEmptyOfBackups(exeDir, restored)
    if (!removed) skipped.push(FSR4_META_DIR)
  }
  return skipped
}

async function uninstallCommitted(exeDir: string, manifest: Fsr4LiteManifest): Promise<string[]> {
  const skipped: string[] = []
  const unrestored: string[] = []
  const restored: string[] = []
  const legacy = manifestIsLegacyCommitted(manifest)
  for (const relative of manifest.replacedFiles) {
    if (touchesWidgetPath(relative)) throw new Fsr4LiteFailure('bad-path')
    const looked = await backupLooksRight(exeDir, relative, manifest)
    const dest = await containedReal(exeDir, relative).catch(() => null)
    const current = dest ? await digestIfFile(dest) : null
    const action = committedReplaceAction({
      current,
      written: digestNamed(manifest.writtenDigests, relative) ?? null,
      backupOk: looked.ok,
      legacy
    })
    if (action === 'missing' || action === 'skip') {
      skipped.push(relative)
      if (looked.ok) unrestored.push(relative)
      else unrestored.push(relative)
      continue
    }
    if (action === 'restore') await restoreBackupFile(exeDir, relative)
    restored.push(relative)
  }
  for (const relative of manifest.createdFiles) {
    if (touchesWidgetPath(relative)) continue
    const dest = await containedReal(exeDir, relative).catch(() => null)
    const current = dest ? await digestIfFile(dest) : null
    const action = committedCreateAction({
      current,
      expected: digestNamed(manifest.createdDigests, relative) ?? null,
      legacy
    })
    if (action === 'delete' && dest) await rm(dest, { force: true })
    else if (action === 'skip') skipped.push(relative)
  }
  await removeEmptyCreatedDirs(exeDir, manifest.createdDirs)
  if (mayRemoveInstallMeta({ skipped, unrestoredBackups: unrestored })) {
    const removed = await removeMetaIfEmptyOfBackups(exeDir, restored)
    if (!removed) skipped.push(FSR4_META_DIR)
  }
  return skipped
}

function markRepair(record: Fsr4GameRecord, exeDir: string, installRoot: string): Fsr4GameRecord {
  const next: Fsr4GameRecord = {
    ...record,
    installed: false,
    widgetOwned: false,
    repairNeeded: true,
    exeDir,
    installRoot,
    block: undefined,
    sessionStatus: 'none',
    resolution: undefined
  }
  saveRecord(next)
  inspectCache.delete(record.gameId)
  notify({ kind: 'repair', gameId: record.gameId })
  return next
}

/** Quita lo nuestro y luego marca el juego como del widget. No toca .ralfsr. */
async function handoffToWidget(record: Fsr4GameRecord, exeDir: string, installRoot: string): Promise<Fsr4GameRecord> {
  // Si el juego arrancó entre el chequeo y esta llamada, no se tocan los DLL.
  assertNotRunning(record.gameId)
  const manifest = await readManifest(exeDir).catch((error: unknown) => {
    if (error instanceof Fsr4LiteFailure && (error.code === 'manifest' || error.code === 'symlink' || error.code === 'bad-path')) throw error
    return null
  })
  if (manifest && shouldUninstallBeforeWidget({ manifestState: manifest.state })) {
    const skipped = manifest.state === 'pending'
      ? await rollbackPending(exeDir, manifest)
      : await uninstallCommitted(exeDir, manifest)
    if (skipped.length > 0) {
      markRepair(record, exeDir, installRoot)
      throw new Fsr4LiteFailure('broken')
    }
  } else if (record.installed) {
    log('warn', `widget en ${record.gameId} sin manifiesto nuestro; no se borran archivos a ciegas`)
  }
  const next: Fsr4GameRecord = {
    ...record,
    installed: false,
    widgetOwned: true,
    repairNeeded: false,
    exeDir,
    installRoot,
    block: undefined,
    proxyName: undefined,
    optiBuild: undefined,
    sessionStatus: 'none',
    resolution: undefined
  }
  saveRecord(next)
  inspectCache.delete(record.gameId)
  return next
}

/**
 * La ficha pidió el widget con el juego abierto o con el candado ocupado.
 * No se escribe la carpeta ni se cachea: la próxima lectura en idle puede traspasar.
 */
function deferredWidgetView(record: Fsr4GameRecord, decision: ReturnType<typeof resolveGameGetWidgetHandoff>): Fsr4LiteGameView {
  const view = viewFrom(record, true, decision.phase)
  if (decision.note !== 'after-close') return view
  return { ...view, handoffLater: true }
}

/**
 * Al cerrar la sesión el juego ya no tiene los DLL. Si el widget llegó
 * mientras corría, aquí se quita lo nuestro. Si el candado está ocupado, se deja.
 */
async function handoffWidgetIfIdle(gameId: string): Promise<void> {
  const record = readRecord(gameId)
  const root = record.installRoot || record.exeDir
  if (!record.exeDir || !root) return
  const status = sessionState()
  if (status.gameId === gameId && gameLaunchBlocksMutation(status.phase)) {
    log('info', `traspaso al widget espera: ${gameId} sigue abierto`)
    return
  }
  if (mutationGate.held()) {
    log('info', `traspaso al widget espera: candado ocupado (${gameId})`)
    return
  }
  const walked = await walkInstall(root).catch((error: unknown) => {
    log('warn', 'no se pudo mirar la carpeta al cerrar la sesión', error)
    return null
  })
  if (!walked || !hasWidgetManifest(walked.files.map((file) => file.relativePath))) return
  const state = await manifestStateOf(record.exeDir).catch((error: unknown) => {
    log('warn', 'no se pudo leer el manifiesto pa traspasar al widget', error)
    return null
  })
  if (!state) return
  const decision = resolveGameGetWidgetHandoff({
    manifestState: state,
    running: false,
    gateHeld: mutationGate.held() != null,
    stored: record
  })
  if (!decision.mutate) return
  if (!mutationGate.tryAcquire('handoff')) return
  try {
    await handoffToWidget(readRecord(gameId), record.exeDir, root)
    log('info', `traspaso al widget al cerrar la sesión ${gameId}`)
  } catch (error) {
    if (error instanceof Fsr4LiteFailure && error.code === 'running') {
      log('info', `traspaso al widget espera: ${gameId} sigue abierto`)
      return
    }
    log('warn', 'no se pudo traspasar al widget al cerrar la sesión', error)
  } finally {
    mutationGate.release('handoff')
  }
}

async function installInto(game: LibraryGame): Promise<Fsr4LiteGameView> {
  if (!featureOn()) throw new Fsr4LiteFailure('disabled')
  return withMutation('install', async () => {
    assertNotRunning(game.id)
    const hardware = await deviceStatus()
    if (hardware.device.support === 'unsupported') throw new Fsr4LiteFailure('unsupported-device')
    let located = await locate(game)
    let assessment = await assessLocated(game, located)
    const record = readRecord(game.id)
    const takeWidget = async (): Promise<Fsr4LiteGameView> => {
      const state = await manifestStateOf(located.exeDir)
      if (shouldUninstallBeforeWidget({ manifestState: state })) {
        const next = await handoffToWidget(record, located.exeDir, located.installRoot)
        return viewFrom(next, true, 'widget')
      }
      const next = { ...record, widgetOwned: true, installed: false, repairNeeded: false, exeDir: located.exeDir, installRoot: located.installRoot, block: undefined }
      saveRecord(next)
      inspectCache.delete(game.id)
      return viewFrom(next, true, 'widget')
    }
    if (assessment.kind === 'widget') return takeWidget()
    if (assessment.kind === 'broken') throw new Fsr4LiteFailure('broken')
    if (assessment.block) throw new Fsr4LiteFailure(assessment.block)
    if (assessment.kind === 'installed') {
      const next = { ...record, installed: true, exeDir: located.exeDir, installRoot: located.installRoot, widgetOwned: false }
      saveRecord(next)
      inspectCache.delete(game.id)
      return viewFrom(next, true, 'installed')
    }
    const opti = await ensureOptiScaler(game.id, true)
    await ensureFsrDlls(game.id)
    // Después de bajar, el juego pudo cambiar o arrancar. Se vuelve a mirar antes de escribir.
    assertNotRunning(game.id)
    located = await locate(game)
    assessment = await assessLocated(game, located)
    if (assessment.kind === 'widget') return takeWidget()
    if (assessment.kind === 'broken') throw new Fsr4LiteFailure('broken')
    if (assessment.block) throw new Fsr4LiteFailure(assessment.block)
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
    // El plan trae huellas del texto, no de los bytes. El journal en disco arranca vacío.
    let manifest: Fsr4LiteManifest = {
      ...plan.manifest,
      state: 'pending',
      backedUpFiles: [],
      copiedCreates: [],
      writtenDigests: {},
      createdDigests: {},
      backupDigests: {}
    }
    let mutated = false
    try {
      await writeManifest(located.exeDir, manifest)
      mutated = true
      for (const file of plan.files) {
        assertNotRunning(game.id)
        if (file.action === 'replace') {
          const backupDigest = await backupFile(located.exeDir, file.path)
          manifest = journalBackup(manifest, file.path, backupDigest)
          await writeManifest(located.exeDir, manifest)
        }
        assertNotRunning(game.id)
        const intent = await plannedDigest(opti.root, plan.proxyName, ref?.dll, file)
        // Se anota la copia antes de hacerla. Si el hash de después falla, el rollback ya sabe del archivo.
        manifest = journalCopyIntent(manifest, file, intent)
        await writeManifest(located.exeDir, manifest)
        assertNotRunning(game.id)
        notify({ kind: 'progress', gameId: game.id, phase: 'copy', received: 1, total: plan.files.length })
        const dest = await copyPlanned(located.exeDir, opti.root, plan.proxyName, ref?.dll, file)
        const written = await hashFile(dest)
        if (written.sha256 !== intent.sha256 || written.size !== intent.size) throw new Fsr4LiteFailure('changed')
        manifest = journalCopyIntent(manifest, file, written)
        await writeManifest(located.exeDir, manifest)
      }
      manifest = { ...manifest, state: 'committed' }
      await writeManifest(located.exeDir, manifest)
    } catch (error) {
      if (mutated) {
        log('warn', 'la instalación no terminó; se intenta deshacer', error)
        try {
          const skipped = await rollbackPending(located.exeDir, await readManifest(located.exeDir))
          if (skipped.length > 0) {
            markRepair(record, located.exeDir, located.installRoot)
            throw new Fsr4LiteFailure('broken')
          }
        } catch (rollbackError) {
          if (rollbackError instanceof Fsr4LiteFailure && rollbackError.code === 'broken') throw rollbackError
          log('warn', 'no se pudo deshacer la instalación a medias', rollbackError)
          markRepair(record, located.exeDir, located.installRoot)
          throw new Fsr4LiteFailure('broken')
        }
      }
      throw error
    }
    const saved: Fsr4GameRecord = {
      ...record,
      exeDir: located.exeDir,
      installRoot: located.installRoot,
      installed: true,
      repairNeeded: false,
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
  })
}

async function uninstallFrom(game: LibraryGame): Promise<Fsr4LiteGameView> {
  if (!featureOn()) throw new Fsr4LiteFailure('disabled')
  return withMutation('uninstall', async () => {
    assertNotRunning(game.id)
    const record = readRecord(game.id)
    const located = await locate(game)
    const assessment = await assessLocated(game, located)
    if (assessment.kind === 'widget') {
      const state = await manifestStateOf(located.exeDir)
      if (shouldUninstallBeforeWidget({ manifestState: state })) {
        const next = await handoffToWidget(record, located.exeDir, located.installRoot)
        return viewFrom(next, true, 'widget')
      }
      const next = { ...record, widgetOwned: true, installed: false, repairNeeded: false, exeDir: located.exeDir, installRoot: located.installRoot }
      saveRecord(next)
      inspectCache.delete(game.id)
      return viewFrom(next, true, 'widget')
    }
    if (assessment.block) throw new Fsr4LiteFailure(assessment.block)
    const manifest = await readManifest(located.exeDir).catch(() => null)
    if (!manifest) throw new Fsr4LiteFailure('not-installed')
    log('info', `quitando FSR 4.1 Lite de ${located.exeDir}`)
    const skipped = manifest.state === 'pending'
      ? await rollbackPending(located.exeDir, manifest)
      : await uninstallCommitted(located.exeDir, manifest)
    if (skipped.length > 0) {
      log('warn', `se dejaron archivos que ya no coinciden: ${skipped.join(', ')}`)
      markRepair(record, located.exeDir, located.installRoot)
      throw new Fsr4LiteFailure('changed')
    }
    const next: Fsr4GameRecord = {
      ...record,
      exeDir: located.exeDir,
      installRoot: located.installRoot,
      installed: false,
      repairNeeded: false,
      proxyName: undefined,
      optiBuild: undefined,
      sessionStatus: 'none',
      resolution: undefined
    }
    saveRecord(next)
    inspectCache.delete(game.id)
    return viewFrom(next, true, 'ready')
  })
}

async function refreshInstalled(build: CurrentBuild): Promise<void> {
  for (const record of Object.values(store().store)) {
    if (!record?.installed || !record.exeDir || !isNewerOptiBuild(record.optiBuild, build.build)) continue
    try {
      const status = sessionState()
      const running = status.gameId === record.gameId && gameLaunchBlocksMutation(status.phase)
      const root = record.installRoot || record.exeDir
      const refusal = classifyGameRoot(record.exeDir)
      const walked = await walkInstall(root)
      let manifest = await readManifest(record.exeDir)
      const decision = launcherMayUpdate({
        files: walked.files.map((file) => file.relativePath),
        dirs: walked.dirs,
        manifestState: manifest.state,
        running,
        rootRefusal: refusal,
        scanTruncated: walked.truncated
      })
      if (decision !== 'ok') {
        log('warn', `no se actualiza ${record.gameId}: ${decision}`)
        if (decision === 'widget' && record.exeDir) {
          await handoffToWidget(record, record.exeDir, root)
        }
        continue
      }
      assertNotRunning(record.gameId)
      manifest.optiBuild = build.build
      await writeManifest(record.exeDir, manifest)
      for (const rel of Object.keys(await listPackageMap(build.root))) {
        const base = win32.basename(rel).toLowerCase()
        if ((FSR4_SKIP_PACKAGE_FILES as readonly string[]).includes(base)) continue
        if (base === 'optiscaler.ini' || base === FSR4_DLL_DX12 || base === FSR4_DLL_VK) continue
        const destRel = base === 'optiscaler.dll' && !rel.includes('/') ? manifest.proxyName : rel
        if (destRel.replace(/\\/g, '/').toLowerCase().startsWith('.ralfsr')) continue
        if (destRel.replace(/\\/g, '/').toLowerCase().startsWith('.mt3k-fsr')) continue
        assertNotRunning(record.gameId)
        const dest = await containedReal(record.exeDir, destRel)
        const source = base === 'optiscaler.dll' && !rel.includes('/')
          ? win32.join(build.root, 'OptiScaler.dll')
          : await packageFile(build.root, rel)
        if (!source) continue
        const alreadyOurs = manifest.createdFiles.some((item) => item.toLowerCase() === destRel.toLowerCase())
        const alreadyReplaced = manifest.replacedFiles.some((item) => item.toLowerCase() === destRel.toLowerCase())
        const action = (await existsFile(dest)) ? 'replace' as const : 'create' as const
        if (action === 'replace' && !alreadyOurs && !alreadyReplaced) {
          const backupDigest = await backupFile(record.exeDir, destRel)
          manifest = journalBackup(manifest, destRel, backupDigest)
          manifest = { ...manifest, replacedFiles: manifest.replacedFiles.some((item) => item.toLowerCase() === destRel.toLowerCase()) ? manifest.replacedFiles : [...manifest.replacedFiles, destRel] }
          await writeManifest(record.exeDir, manifest)
        } else if (action === 'create' && !alreadyOurs) {
          const parent = destRel.includes('/') ? destRel.slice(0, destRel.lastIndexOf('/')) : ''
          if (parent && !manifest.createdDirs.some((dir) => dir.toLowerCase() === parent.toLowerCase())) {
            let parentExists = false
            try { parentExists = (await stat(await containedReal(record.exeDir, parent))).isDirectory() } catch { parentExists = false }
            if (!parentExists) manifest = { ...manifest, createdDirs: [...manifest.createdDirs, parent] }
          }
          if (!manifest.createdFiles.some((item) => item.toLowerCase() === destRel.toLowerCase())) {
            manifest = { ...manifest, createdFiles: [...manifest.createdFiles, destRel] }
          }
        }
        assertNotRunning(record.gameId)
        const intent = await hashFile(source)
        const journalAction = (alreadyOurs || action === 'create') ? 'create' as const : 'replace' as const
        manifest = journalCopyIntent(manifest, { path: destRel, action: journalAction }, intent)
        await writeManifest(record.exeDir, manifest)
        assertNotRunning(record.gameId)
        await mkdir(win32.dirname(dest), { recursive: true })
        await copyFile(source, dest)
        const written = await hashFile(dest)
        if (written.sha256 !== intent.sha256 || written.size !== intent.size) throw new Fsr4LiteFailure('changed')
        manifest = journalCopyIntent(manifest, { path: destRel, action: manifest.createdFiles.some((item) => item.toLowerCase() === destRel.toLowerCase()) ? 'create' : 'replace' }, written)
        await writeManifest(record.exeDir, manifest)
      }
      saveRecord({ ...record, optiBuild: build.build })
      log('info', `actualizado ${record.gameId} a ${build.build}`)
    } catch (error) {
      log('warn', `no se pudo actualizar ${record.gameId}`, error)
    }
  }
}

async function readBackoff(): Promise<number | null> {
  try {
    const value = Number(await readFile(win32.join(cacheRoot(), 'optiscaler', 'backoff-until.txt'), 'utf8'))
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

async function maybeUpdate(): Promise<void> {
  if (!featureOn() || !autoUpdateOn()) return
  if (mutationGate.held()) return
  if (!mutationGate.tryAcquire('update')) return
  try {
    const last = await readLastCheck()
    const backoff = await readBackoff()
    if (!shouldRefreshOptiScaler({
      enabled: true,
      platform: process.platform,
      now: Date.now(),
      lastCheckAt: last,
      backoffUntil: backoff
    })) return
    try {
      const build = await ensureOptiScaler('launcher', true)
      await refreshInstalled(build)
      if (!build.remoteChecked) {
        const marker = win32.join(cacheRoot(), 'optiscaler', 'backoff-until.txt')
        await mkdir(win32.dirname(marker), { recursive: true })
        await writeFile(marker, String(Date.now() + OPTI_FAIL_BACKOFF_MS))
        return
      }
      const marker = win32.join(cacheRoot(), 'optiscaler', 'last-check.txt')
      await mkdir(win32.dirname(marker), { recursive: true })
      await writeFile(marker, String(Date.now()))
      await rm(win32.join(cacheRoot(), 'optiscaler', 'backoff-until.txt'), { force: true })
    } catch (error) {
      const marker = win32.join(cacheRoot(), 'optiscaler', 'backoff-until.txt')
      await mkdir(win32.dirname(marker), { recursive: true })
      await writeFile(marker, String(Date.now() + OPTI_FAIL_BACKOFF_MS))
      log('warn', 'actualización automática falló', error)
    }
  } finally {
    mutationGate.release('update')
  }
}

export const fsr4LiteService = {
  initialize(listener: (event: Fsr4LiteEvent) => void): void {
    notify = listener
    if (process.platform === 'win32') {
      void maybeUpdate().catch((error) => log('warn', 'actualización automática falló', error))
    }
  },

  bindSession(read: () => { gameId?: string, phase?: string, startedAt?: number }): void {
    sessionState = read
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
    // El diálogo queda afuera del candado. Borrar el staging y publicar, adentro.
    return withMutation('import', async () => {
      const dir = win32.join(cacheRoot(), 'fsr4')
      const staging = win32.join(dir, 'incoming')
      await rm(staging, { recursive: true, force: true })
      await mkdir(staging, { recursive: true })
      try {
        await copyFile(dx, win32.join(staging, FSR4_DLL_DX12))
        await copyFile(vk, win32.join(staging, FSR4_DLL_VK))
        await publishFsrPair(staging, 'imported', {})
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
      deviceCache = undefined
      log('info', 'DLL Lite importados')
      return deviceStatus()
    })
  },

  gameGet(game: LibraryGame | undefined): Promise<Fsr4LiteGameView> {
    if (!game || !featureOn()) return Promise.resolve(viewFrom(blankRecord(game?.id ?? ''), process.platform === 'win32', 'hidden'))
    const cached = inspectCache.get(game.id)
    if (cached && Date.now() - cached.at < 120_000) return Promise.resolve(cached.view)
    return locate(game).then(async (located) => {
      const assessment = await assessLocated(game, located)
      const record = readRecord(game.id)
      if (assessment.kind === 'widget') {
        const state = await manifestStateOf(located.exeDir)
        if (shouldUninstallBeforeWidget({ manifestState: state })) {
          const status = sessionState()
          const running = status.gameId === game.id && gameLaunchBlocksMutation(status.phase)
          const decision = resolveGameGetWidgetHandoff({
            manifestState: state,
            running,
            gateHeld: mutationGate.held() != null,
            stored: record
          })
          // Juego abierto o candado ocupado: se enseña el estado y no se copian DLL.
          if (!decision.mutate) {
            log('info', decision.note === 'after-close'
              ? `widget en ${game.id} con el juego abierto; el traspaso espera`
              : `widget en ${game.id} con el candado ocupado; se deja la fase guardada`)
            return deferredWidgetView(record, decision)
          }
          if (!mutationGate.tryAcquire('handoff')) {
            const busy = resolveGameGetWidgetHandoff({
              manifestState: state,
              running: false,
              gateHeld: true,
              stored: record
            })
            return deferredWidgetView(record, busy)
          }
          try {
            const handed = await handoffToWidget(record, located.exeDir, located.installRoot)
            const view = viewFrom(handed, true, 'widget')
            inspectCache.set(game.id, { at: Date.now(), view })
            return view
          } catch (error) {
            if (error instanceof Fsr4LiteFailure && error.code === 'running') {
              const waiting = resolveGameGetWidgetHandoff({
                manifestState: state,
                running: true,
                gateHeld: false,
                stored: record
              })
              return deferredWidgetView(record, waiting)
            }
            if (error instanceof Fsr4LiteFailure && error.code === 'broken') {
              const view = viewFrom({ ...readRecord(game.id), repairNeeded: true }, true, 'broken')
              inspectCache.set(game.id, { at: Date.now(), view })
              return view
            }
            throw error
          } finally {
            mutationGate.release('handoff')
          }
        }
      }
      const note = await compatNote(game.name).catch(() => undefined)
      const repairNeeded = record.repairNeeded === true && assessment.kind !== 'ready' && assessment.kind !== 'widget'
      const next: Fsr4GameRecord = {
        ...record,
        exeDir: located.exeDir,
        installRoot: located.installRoot,
        installed: assessment.kind === 'installed' && !repairNeeded,
        widgetOwned: assessment.kind === 'widget',
        repairNeeded,
        upscalers: assessment.upscalers,
        hasFsr2Dll: assessment.hasFsr2,
        noUpscaler: assessment.noUpscaler,
        block: assessment.block,
        antiCheat: assessment.antiCheat,
        compatNote: note ?? record.compatNote
      }
      saveRecord(next)
      const phase: Fsr4LiteGameView['phase'] = repairNeeded
        ? 'broken'
        : assessment.kind === 'widget'
          ? 'widget'
          : assessment.kind === 'broken'
            ? 'broken'
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
    const renderScale = row.renderScale
    const overlay = row.overlay
    const graphicsApi = row.graphicsApi
    if (!isFsr4RenderScale(renderScale) || typeof overlay !== 'boolean' || !isFsr4GraphicsApi(graphicsApi)) {
      throw new Fsr4LiteFailure('options')
    }
    return withMutation('options', async () => {
      assertNotRunning(game.id)
      const record = { ...readRecord(game.id), renderScale, overlay, graphicsApi }
      const located = await locate(game)
      assertNotRunning(game.id)
      const assessment = await assessLocated(game, located)
      assertNotRunning(game.id)
      if (assessment.kind === 'widget') {
        const state = await manifestStateOf(located.exeDir)
        assertNotRunning(game.id)
        if (shouldUninstallBeforeWidget({ manifestState: state })) {
          const next = await handoffToWidget(record, located.exeDir, located.installRoot)
          return viewFrom(next, true, 'widget')
        }
        return viewFrom({ ...record, widgetOwned: true, installed: false, repairNeeded: false }, true, 'widget')
      }
      if (assessment.kind === 'broken') throw new Fsr4LiteFailure('broken')
      if (assessment.block) throw new Fsr4LiteFailure(assessment.block)
      if (assessment.kind === 'installed') {
        const manifest = await readManifest(located.exeDir)
        assertNotRunning(game.id)
        if (manifest.state !== 'committed') throw new Fsr4LiteFailure('broken')
        const names = await readdir(located.exeDir)
        assertNotRunning(game.id)
        const iniName = names.find((name) => name.toLowerCase() === 'optiscaler.ini')
        if (!iniName) throw new Fsr4LiteFailure('manifest')
        const replaced = manifest.replacedFiles.find((file) => file.toLowerCase() === 'optiscaler.ini')
        if (replaced) {
          const backup = await containedReal(located.exeDir, `${FSR4_META_DIR}/backup/${replaced}`)
          assertNotRunning(game.id)
          if (!await existsFile(backup)) throw new Fsr4LiteFailure('backup-missing')
        }
        const iniPath = await containedReal(located.exeDir, iniName)
        assertNotRunning(game.id)
        const currentIni = await readFile(iniPath, 'utf8')
        assertNotRunning(game.id)
        const nextIni = setIniValues(currentIni, iniAssignments({
          renderScale,
          overlay,
          graphicsApi,
          hasFsr2Dll: record.hasFsr2Dll,
          noUpscaler: record.noUpscaler
        }))
        // Después de cada await: si el juego arrancó, no se escribe el ini.
        assertNotRunning(game.id)
        await writeFile(iniPath, nextIni)
        const written = await hashFile(iniPath)
        const key = replaced ?? iniName
        await writeManifest(located.exeDir, {
          ...manifest,
          renderScale,
          overlay,
          graphicsApi,
          writtenDigests: { ...manifest.writtenDigests, [key]: written },
          createdDigests: manifest.createdFiles.some((file) => file.toLowerCase() === 'optiscaler.ini')
            ? { ...manifest.createdDigests, [key]: written }
            : manifest.createdDigests
        })
        log('info', `opciones ${game.id} api=${graphicsApi} escala=${renderScale} overlay=${overlay}`)
      }
      saveRecord({ ...record, exeDir: located.exeDir, installRoot: located.installRoot, installed: assessment.kind === 'installed' })
      inspectCache.delete(game.id)
      const phase: Fsr4LiteGameView['phase'] = assessment.kind === 'installed' ? 'installed' : 'ready'
      return viewFrom({ ...record, installed: assessment.kind === 'installed' }, true, phase)
    })
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

  async onSessionEnded(game: LibraryGame, startedAt?: number): Promise<void> {
    try {
      if (!featureOn()) return
      // gameSessionManager asigna la fase nueva después de soltar este await.
      // Sin esto, el traspaso vería "running" y se iría.
      await Promise.resolve()
      const record = readRecord(game.id)
      try {
        if (!record.installed || !record.exeDir) return
        const names = await readdir(record.exeDir).catch(() => [] as string[])
        const logName = names.find((name) => name.toLowerCase() === 'optiscaler.log')
        if (!logName) return
        const logPath = win32.join(record.exeDir, logName)
        const info = await stat(logPath)
        if (startedAt == null || !sessionLogIsFresh(info.mtimeMs, startedAt)) {
          // Un log viejo no deja el badge de la sesión anterior.
          const observed = sessionObservation({ logMtimeMs: info.mtimeMs, sessionStartedAt: startedAt ?? null, logText: null })
          const changed = record.sessionStatus !== observed.status || Boolean(record.resolution)
          saveRecord({ ...record, sessionStatus: observed.status, resolution: undefined })
          inspectCache.delete(game.id)
          log('info', `sesión ${game.id} sin log nuevo`)
          if (changed) notify({ kind: 'session', gameId: game.id, status: observed.status })
          return
        }
        const length = Math.min(info.size, FSR4_LOG_READ_CAP)
        const start = Math.max(0, info.size - length)
        const handle = await open(logPath, 'r')
        let text = ''
        try {
          const buf = Buffer.alloc(length)
          await handle.read(buf, 0, length, start)
          text = buf.toString('utf8')
        } finally {
          await handle.close()
        }
        const parsed = sessionObservation({ logMtimeMs: info.mtimeMs, sessionStartedAt: startedAt ?? null, logText: text })
        const changed = record.sessionStatus !== parsed.status
        saveRecord({ ...record, sessionStatus: parsed.status, resolution: parsed.resolution })
        inspectCache.delete(game.id)
        log('info', `sesión ${game.id} ${parsed.status} ${parsed.resolution ?? ''}`.trim())
        if (changed) notify({ kind: 'session', gameId: game.id, status: parsed.status, resolution: parsed.resolution })
      } finally {
        // El log ya se anotó. Si el widget llegó con el juego abierto, ahora se quita lo nuestro.
        await handoffWidgetIfIdle(game.id)
      }
    } catch (error) {
      log('warn', 'no se pudo leer el log de la sesión', error)
    }
  },

  onFeatureEnabled(): void {
    deviceCache = undefined
    void maybeUpdate().catch((error) => log('warn', 'actualización automática falló', error))
  }
}
