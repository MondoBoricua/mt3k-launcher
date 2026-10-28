/**
 * FSR 4.1 Lite: decisiones puras (sin disco ni red).
 * OptiScaler se baja tal cual en Windows; aquí solo se planea qué escribir.
 * La receta sigue el comportamiento público del widget de ROG Ally Life,
 * reimplementada. Esos archivos no se copian.
 */

export const FSR4_LITE_LOG = '[fsr4-lite]'

/** Bucket público del autor del widget. Una sola constante, con crédito en la UI. */
export const FSR4_LITE_DOWNLOAD_BASE = 'https://pub-b170628a8d834de98909a5878680e8d8.r2.dev/fsr4'
export const OPTISCALER_NIGHTLY_API = 'https://api.github.com/repos/optiscaler/OptiScaler-nightly/releases?per_page=10'
export const REFRAMEWORK_LATEST_ZIP = 'https://github.com/praydog/REFramework-nightly/releases/latest/download/REFramework.zip'
export const OPTISCALER_COMPAT_LIST_URL = 'https://raw.githubusercontent.com/wiki/optiscaler/OptiScaler/Compatibility-List.md'
export const FSR4_LITE_CREDIT_URL = 'https://github.com/db1522/fsr4-lite-rog-ally'

export const FSR4_DLL_DX12 = 'amdxcffx64.dll'
export const FSR4_DLL_VK = 'amdvkffx64.dll'
export const FSR4_VERSION_LABEL = '4.1.2'
/** Más de 50 MB: los Lite medidos andan en 85 MB y 72 MB. */
export const FSR4_MIN_DLL_BYTES = 50 * 1024 * 1024
export const OPTI_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export const FSR4_META_DIR = '.mt3k-fsr'
export const FSR4_WIDGET_META_DIR = '.ralfsr'
export const FSR4_OPTI_SUBDIR = 'OptiScaler'

/** Mismo orden que el setup de OptiScaler: el primer nombre que el juego no use. */
export const FSR4_PROXY_NAMES = [
  'dxgi.dll',
  'winmm.dll',
  'version.dll',
  'dbghelp.dll',
  'd3d12.dll',
  'wininet.dll',
  'winhttp.dll'
] as const

/** Scripts del paquete: no son runtime y no se copian al juego. */
export const FSR4_SKIP_PACKAGE_FILES = [
  'setup_windows.bat',
  'setup_linux.sh',
  'remove optiscaler.bat',
  'remove_optiscaler.bat'
] as const

export const FSR4_RENDER_SCALES = ['game', 'native', 'quality', 'balanced', 'performance'] as const
export type Fsr4RenderScale = (typeof FSR4_RENDER_SCALES)[number]
export const FSR4_GRAPHICS_APIS = ['DX12', 'DX11', 'Vulkan'] as const
export type Fsr4GraphicsApi = (typeof FSR4_GRAPHICS_APIS)[number]
export type Fsr4UpscalerKind = 'fsr' | 'dlss' | 'xess'
export type Fsr4DeviceClass = 'supported' | 'official-driver' | 'experimental' | 'unsupported' | 'unknown'
export type Fsr4SessionStatus = 'active' | 'not-lite' | 'not-loaded' | 'unknown'
export type Fsr4FileSource = 'widget-cache' | 'downloaded' | 'imported' | 'missing'
export type Fsr4BlockCode =
  | 'not-installed'
  | 'remote'
  | 'windows-apps'
  | 'anti-cheat'
  | 'no-exe'
  | 'no-proxy'
  | 'unsupported-device'

const RENDER_RATIO: Record<Fsr4RenderScale, string> = {
  game: '',
  native: '1.0',
  quality: '1.5',
  balanced: '1.7',
  performance: '2.0'
}

/** Proveedores cuyo ejecutable vive en esta PC. Retro y Remote Play no. */
const LOCAL_PROVIDERS = new Set(['steam', 'epic', 'gog', 'xbox', 'ea', 'ubisoft', 'local'])

/** Juego instalado en esta PC. Retro, nube y tienda remota se quedan fuera. */
export function isFsr4LiteEligibleGame(game: { provider: string, installed?: boolean }): boolean {
  return game.installed === true && LOCAL_PROVIDERS.has(game.provider)
}

/**
 * Marcadores de anti-cheat (carpetas, archivos y exes cuyo protector vive fuera
 * de la carpeta). Misma lista de nombres que documenta el widget, como datos.
 */
const ANTI_CHEAT_DIRS: Record<string, string> = {
  easyanticheat: 'Easy Anti-Cheat',
  easyanticheat_eos: 'Easy Anti-Cheat',
  battleye: 'BattlEye',
  eaanticheat: 'EA Javelin anti-cheat',
  gameguard: 'nProtect GameGuard',
  xigncode: 'XIGNCODE3',
  anticheatexpert: 'Anti-Cheat Expert (ACE)',
  equ8: 'EQU8'
}

const ANTI_CHEAT_FILES: Record<string, string> = {
  'easyanticheat_x64.dll': 'Easy Anti-Cheat',
  'easyanticheat_eos_setup.exe': 'Easy Anti-Cheat',
  'start_protected_game.exe': 'Easy Anti-Cheat',
  'beclient_x64.dll': 'BattlEye',
  'beservice_x64.exe': 'BattlEye',
  'beservice.exe': 'BattlEye',
  'eaanticheat.gameservicelauncher.exe': 'EA Javelin anti-cheat',
  'eaanticheat.installer.exe': 'EA Javelin anti-cheat',
  'randgrid.sys': 'Ricochet anti-cheat',
  'gamemon.des': 'nProtect GameGuard',
  'x3.xem': 'XIGNCODE3',
  'ace-base.sys': 'Anti-Cheat Expert (ACE)',
  'mhyprot2.sys': 'HoYoverse anti-cheat',
  'mhyprot3.sys': 'HoYoverse anti-cheat',
  'hoyokprotect.sys': 'HoYoverse anti-cheat',
  'pbsvc.exe': 'PunkBuster',
  'pbcl.dll': 'PunkBuster',
  'valorant-win64-shipping.exe': 'Riot Vanguard',
  'league of legends.exe': 'Riot Vanguard',
  'cs2.exe': 'Valve Anti-Cheat',
  'dota2.exe': 'Valve Anti-Cheat',
  'cod.exe': 'Ricochet anti-cheat',
  'blackops6.exe': 'Ricochet anti-cheat',
  'modernwarfare.exe': 'Ricochet anti-cheat',
  'overwatch.exe': 'Blizzard anti-cheat',
  'genshinimpact.exe': 'HoYoverse anti-cheat',
  'starrail.exe': 'HoYoverse anti-cheat',
  'zenlesszonezero.exe': 'HoYoverse anti-cheat'
}

const NOT_GAME_EXE = [
  'crashreport', 'crashhandler', 'crashpad', 'unrealcefsubprocess', 'cefprocess',
  'unitycrashhandler', 'uninst', 'setup', 'vc_redist', 'vcredist', 'dxsetup',
  'ue4prereq', 'ueprereq', 'easyanticheat', 'start_protected_game', 'redist',
  'installer', 'dotnet', 'battleye', 'beservice'
]

const UPSCALER_FILES: Record<string, 'fsr31' | 'fsr2' | 'dlss' | 'xess'> = {
  'amd_fidelityfx_dx12.dll': 'fsr31',
  'amd_fidelityfx_upscaler_dx12.dll': 'fsr31',
  'amd_fidelityfx_loader_dx12.dll': 'fsr31',
  'amd_fidelityfx_vk.dll': 'fsr31',
  'ffx_fsr2_api_x64.dll': 'fsr2',
  'ffx_fsr2_api_dx12_x64.dll': 'fsr2',
  'ffx_fsr2_api_vk_x64.dll': 'fsr2',
  'nvngx_dlss.dll': 'dlss',
  'libxess.dll': 'xess',
  'libxess_dx11.dll': 'xess'
}

/**
 * Exes públicos de RE Engine. El marcador fiable es re_chunk_*.pak;
 * estos nombres cubren el caso en que el pak todavía no se listó.
 * Onimusha y PRAGMATA entran por el pak, no por un nombre adivinado.
 */
const RE_ENGINE_EXES = new Set([
  'dd2.exe',
  're2.exe',
  're3.exe',
  're4.exe',
  're7.exe',
  're8.exe',
  're9.exe',
  'monsterhunterwilds.exe'
])

export const REFRAMEWORK_CONFIG_NAME = 're2_fw_config.txt'
export const REFRAMEWORK_DLL_NAME = 'dinput8.dll'

/** Home (0x24), menú cerrado al arrancar, y que REFramework recuerde ese estado. */
export const REFRAMEWORK_CONFIG_TEXT = [
  'ShortcutKey=0x24',
  'REFrameworkConfig_RememberMenuState=true',
  'REFrameworkConfig_MenuOpen=false',
  ''
].join('\n')

export class Fsr4LiteFailure extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'Fsr4LiteFailure'
    this.code = code
  }
}

export interface Fsr4IniOptions {
  overlay: boolean
  renderScale: Fsr4RenderScale
  graphicsApi: Fsr4GraphicsApi
  hasFsr2Dll: boolean
  noUpscaler: boolean
}

export interface Fsr4IniAssignment {
  section: string
  key: string
  value: string
}

export interface Fsr4DeviceReport {
  support: Fsr4DeviceClass
  gpuNames: string[]
  primaryGpu?: string
  egpuNote: boolean
}

export interface Fsr4Assessment {
  kind: 'ready' | 'installed' | 'widget' | 'refused'
  block?: Fsr4BlockCode
  antiCheat?: string
  unreal: boolean
  exeRelative?: string
  upscalers: Fsr4UpscalerKind[]
  hasFsr2: boolean
  noUpscaler: boolean
  needsReFramework: boolean
}

export interface Fsr4LiteManifest {
  formatVersion: 1
  gameId: string
  proxyName: string
  optiBuild: string
  fsrVersion: string
  renderScale: Fsr4RenderScale
  overlay: boolean
  graphicsApi: Fsr4GraphicsApi
  hasFsr2Dll: boolean
  noUpscaler: boolean
  reframeworkVersion: string
  reframeworkAdded: boolean
  reframeworkPreexisting: string[]
  createdFiles: string[]
  createdDirs: string[]
  replacedFiles: string[]
  installedAt: string
}

export interface Fsr4PlannedFile {
  path: string
  action: 'create' | 'replace'
  content: string
}

export interface Fsr4InstallPlan {
  proxyName: string
  files: Fsr4PlannedFile[]
  createdDirs: string[]
  manifest: Fsr4LiteManifest
}

export function isFsr4RenderScale(value: unknown): value is Fsr4RenderScale {
  return typeof value === 'string' && (FSR4_RENDER_SCALES as readonly string[]).includes(value)
}

export function isFsr4GraphicsApi(value: unknown): value is Fsr4GraphicsApi {
  return typeof value === 'string' && (FSR4_GRAPHICS_APIS as readonly string[]).includes(value)
}

export function normalizeFsr4GameOptions(value: {
  renderScale?: unknown
  overlay?: unknown
  graphicsApi?: unknown
}): Fsr4IniOptions & { renderScale: Fsr4RenderScale, overlay: boolean, graphicsApi: Fsr4GraphicsApi } {
  return {
    renderScale: isFsr4RenderScale(value.renderScale) ? value.renderScale : 'game',
    overlay: value.overlay === true,
    graphicsApi: isFsr4GraphicsApi(value.graphicsApi) ? value.graphicsApi : 'DX12',
    hasFsr2Dll: false,
    noUpscaler: false
  }
}

/** Ruta relativa segura: sin absolutos ni `..`. Barras unificadas. */
export function safeRelativePath(value: string): string | null {
  const rel = value.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return null
  const parts = rel.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return parts.join('/')
}

export function basenameOf(value: string): string {
  const rel = value.replace(/\\/g, '/')
  const slash = rel.lastIndexOf('/')
  return slash >= 0 ? rel.slice(slash + 1) : rel
}

/** WindowsApps es Game Pass empaquetado: no se toca. */
export function isWindowsAppsPath(value: string | undefined): boolean {
  if (!value) return false
  return value.replace(/\//g, '\\').toLowerCase().split('\\').includes('windowsapps')
}

export function isUnrealExePath(value: string): boolean {
  const norm = value.replace(/\//g, '\\').toLowerCase()
  return norm.includes('\\binaries\\win64\\') || norm.includes('\\binaries\\wingdk\\')
}

/**
 * Carpetas donde el widget guarda los DLL Lite, en el orden medido:
 * primero la ruta virtualizada del paquete, luego la de AppData suelta.
 */
export function widgetFsr4CacheDirectories(localAppData: string): string[] {
  const root = localAppData.replace(/[\\/]+$/, '')
  return [
    `${root}\\Packages\\ROGAllyLife.FSR4Lite_vzv52xcmgmz62\\LocalCache\\Local\\RAL FSR Helper\\fsr4`,
    `${root}\\RAL FSR Helper\\fsr4`
  ]
}

export function chooseFsr4Proxy(existingFileNames: readonly string[]): string | null {
  const taken = new Set(existingFileNames.map((name) => basenameOf(name).toLowerCase()))
  return FSR4_PROXY_NAMES.find((name) => !taken.has(name)) ?? null
}

export function upscalerKinds(fileNames: readonly string[]): Fsr4UpscalerKind[] {
  const found = new Set<Fsr4UpscalerKind>()
  let fsr2 = false
  let fsr31 = false
  for (const name of fileNames) {
    const kind = UPSCALER_FILES[basenameOf(name).toLowerCase()]
    if (kind === 'fsr2') fsr2 = true
    if (kind === 'fsr31') fsr31 = true
    if (kind === 'dlss') found.add('dlss')
    if (kind === 'xess') found.add('xess')
  }
  if (fsr31 || fsr2) found.add('fsr')
  const order: Fsr4UpscalerKind[] = ['fsr', 'dlss', 'xess']
  return order.filter((kind) => found.has(kind))
}

export function folderHasFsr2(fileNames: readonly string[]): boolean {
  return fileNames.some((name) => UPSCALER_FILES[basenameOf(name).toLowerCase()] === 'fsr2')
}

/** Pak de RE Engine o un exe conocido de Capcom. */
export function needsReFramework(exeName: string | undefined, fileNames: readonly string[]): boolean {
  if (exeName && RE_ENGINE_EXES.has(basenameOf(exeName).toLowerCase())) return true
  return fileNames.some((name) => /^re_chunk_.*\.pak$/i.test(basenameOf(name)))
}

export function detectAntiCheat(exeName: string | undefined, fileNames: readonly string[]): string | null {
  if (exeName) {
    const byExe = ANTI_CHEAT_FILES[basenameOf(exeName).toLowerCase()]
    if (byExe) return byExe
  }
  for (const name of fileNames) {
    const rel = name.replace(/\\/g, '/')
    const parts = rel.split('/')
    for (const part of parts.slice(0, -1)) {
      const dir = ANTI_CHEAT_DIRS[part.toLowerCase()]
      if (dir) return dir
    }
    const file = ANTI_CHEAT_FILES[basenameOf(rel).toLowerCase()]
    if (file) return file
  }
  return null
}

function isMetaManifest(name: string, folder: string): boolean {
  const rel = name.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
  return rel === `${folder}/manifest.json` || rel.endsWith(`/${folder}/manifest.json`)
}

export function hasWidgetManifest(fileNames: readonly string[]): boolean {
  return fileNames.some((name) => isMetaManifest(name, FSR4_WIDGET_META_DIR))
}

export function hasOurManifest(fileNames: readonly string[]): boolean {
  return fileNames.some((name) => isMetaManifest(name, FSR4_META_DIR))
}

export interface Fsr4ExeCandidate {
  relativePath: string
  size: number
}

function isGameExeName(fileName: string): boolean {
  const stem = basenameOf(fileName).replace(/\.exe$/i, '').toLowerCase()
  return stem.length > 0 && !NOT_GAME_EXE.some((part) => stem.includes(part))
}

/**
 * Elige la carpeta del exe. Unreal: el Shipping bajo Binaries\Win64 o WinGDK,
 * nunca el de Engine. Si no hay Shipping pero existe Engine, el exe más grande
 * de un proyecto. Si no, el exe más grande a tres niveles.
 */
export function selectGameExecutable(
  entries: readonly Fsr4ExeCandidate[],
  hasEngineDir: boolean
): { relativePath: string, unreal: boolean } | null {
  const exes = entries.filter((entry) => {
    const rel = safeRelativePath(entry.relativePath)
    return rel !== null && rel.toLowerCase().endsWith('.exe') && isGameExeName(rel)
  })
  const shipping = (folder: 'win64' | 'wingdk', suffix: string): Fsr4ExeCandidate | undefined =>
    exes.find((entry) => {
      const rel = entry.relativePath.replace(/\\/g, '/').toLowerCase()
      if (rel.split('/').includes('engine')) return false
      return rel.includes(`/binaries/${folder}/`) && rel.endsWith(suffix)
    })
  const win64 = shipping('win64', '-win64-shipping.exe')
  if (win64) return { relativePath: win64.relativePath.replace(/\\/g, '/'), unreal: true }
  const wingdk = shipping('wingdk', '-wingdk-shipping.exe')
  if (wingdk) return { relativePath: wingdk.relativePath.replace(/\\/g, '/'), unreal: true }
  if (hasEngineDir) {
    const project = exes
      .filter((entry) => {
        const rel = entry.relativePath.replace(/\\/g, '/').toLowerCase()
        return rel.includes('/binaries/win64/') && !rel.split('/').includes('engine')
      })
      .sort((a, b) => b.size - a.size)[0]
    if (project) return { relativePath: project.relativePath.replace(/\\/g, '/'), unreal: true }
  }
  const shallow = exes
    .filter((entry) => entry.relativePath.replace(/\\/g, '/').split('/').length - 1 <= 3)
    .sort((a, b) => b.size - a.size)[0]
  return shallow ? { relativePath: shallow.relativePath.replace(/\\/g, '/'), unreal: false } : null
}

export function assessFsr4Target(input: {
  provider: string
  installed: boolean
  executablePath?: string
  installDir?: string
  files: readonly string[]
  exeName?: string
  entries?: readonly Fsr4ExeCandidate[]
  hasEngineDir?: boolean
}): Fsr4Assessment {
  const empty: Fsr4Assessment = {
    kind: 'refused',
    unreal: false,
    upscalers: [],
    hasFsr2: false,
    noUpscaler: true,
    needsReFramework: false
  }
  if (!input.installed) return { ...empty, block: 'not-installed' }
  if (!LOCAL_PROVIDERS.has(input.provider)) return { ...empty, block: 'remote' }
  if (isWindowsAppsPath(input.executablePath) || isWindowsAppsPath(input.installDir)) {
    return { ...empty, block: 'windows-apps' }
  }
  if (hasWidgetManifest(input.files)) return { ...empty, kind: 'widget', noUpscaler: false }
  const antiCheat = detectAntiCheat(input.exeName, input.files)
  if (antiCheat) return { ...empty, block: 'anti-cheat', antiCheat }
  const picked = input.exeName
    ? null
    : selectGameExecutable(input.entries ?? [], input.hasEngineDir === true)
  const exeRelative = input.exeName ? undefined : picked?.relativePath
  const exeName = input.exeName ?? (exeRelative ? basenameOf(exeRelative) : undefined)
  if (!exeName && !input.executablePath) return { ...empty, block: 'no-exe' }
  const unreal = picked?.unreal === true || (input.executablePath ? isUnrealExePath(input.executablePath) : false)
  const upscalers = upscalerKinds(input.files)
  const hasFsr2 = folderHasFsr2(input.files)
  const installedByUs = hasOurManifest(input.files)
  return {
    kind: installedByUs ? 'installed' : 'ready',
    unreal,
    exeRelative,
    upscalers,
    hasFsr2,
    noUpscaler: upscalers.length === 0,
    needsReFramework: needsReFramework(exeName, input.files)
  }
}

function isVirtualAdapter(name: string): boolean {
  return /virtual|indirect|basic display|remote display|iddcx|spacedesk|parsec|sunshine|miracast|hyper-v/i.test(name)
}

function isAmdGraphics(name: string): boolean {
  if (isVirtualAdapter(name)) return false
  return /radeon|\bamd\b/i.test(name)
}

function isNonAmdDiscrete(name: string): boolean {
  if (isVirtualAdapter(name)) return false
  if (isAmdGraphics(name)) return false
  return /nvidia|geforce|\brtx\b|\bgtx\b|quadro|intel\(r\) arc|\bintel arc\b/i.test(name)
}

function textHas(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

/**
 * Clase de soporte a partir de los adaptadores (y, si llegan, CPU y modelo).
 * 890M es RDNA 3.5 → supported. Official solo en ROG Xbox Ally X / X20.
 * Una NVIDIA suelta al lado de la Radeon enciende la nota de eGPU.
 */
export function classifyFsr4Device(input: {
  adapters: readonly string[]
  cpu?: string
  model?: string
  manufacturer?: string
}): Fsr4DeviceReport {
  const names = input.adapters.map((name) => name.trim()).filter((name) => name.length > 0)
  const visible = names.filter((name) => !isVirtualAdapter(name))
  const amd = visible.find((name) => isAmdGraphics(name))
  const egpuNote = Boolean(amd) && visible.some((name) => isNonAmdDiscrete(name))
  if (names.length === 0) {
    return { support: 'unknown', gpuNames: [], egpuNote: false }
  }
  if (!amd) {
    return { support: 'unsupported', gpuNames: visible, egpuNote: false }
  }
  const cpu = input.cpu ?? ''
  const model = input.model ?? ''
  const maker = input.manufacturer ?? ''
  const blob = `${cpu} ${model} ${maker} ${amd}`
  const xboxAlly = (textHas(model, 'xbox') || textHas(model, 'rc73') || textHas(model, 'ally x') || textHas(model, 'x20'))
    && (textHas(maker, 'asus') || textHas(model, 'rog') || textHas(model, 'ally'))
  const z2Extreme = textHas(cpu, 'z2 extreme') || textHas(amd, '890m')
  if (xboxAlly && z2Extreme) {
    return { support: 'official-driver', gpuNames: visible, primaryGpu: amd, egpuNote }
  }
  const rdna2 = ['z2 go', 'z2 a', 'steam deck', 'custom apu 0405', 'custom apu 0932', '680m', '660m', '6800u', '6600u', '6800hs', '6900hs', '7735u', '7735hs', '7736u']
    .some((needle) => textHas(blob, needle))
  if (rdna2 && !textHas(amd, '890m') && !textHas(cpu, 'z2 extreme')) {
    return { support: 'experimental', gpuNames: visible, primaryGpu: amd, egpuNote }
  }
  return { support: 'supported', gpuNames: visible, primaryGpu: amd, egpuNote }
}

/** Valores que se escriben encima del ini del paquete. Lo que no está aquí se queda. */
export function iniAssignments(options: Fsr4IniOptions): Fsr4IniAssignment[] {
  const ratio = RENDER_RATIO[options.renderScale]
  const dx11 = options.hasFsr2Dll && options.graphicsApi === 'DX11'
  const vulkan = options.hasFsr2Dll && options.graphicsApi === 'Vulkan'
  const overlay = options.overlay
  return [
    { section: 'Upscalers', key: 'Dx12Upscaler', value: 'ffx' },
    { section: 'Upscalers', key: 'Dx11Upscaler', value: 'ffx_12' },
    { section: 'Upscalers', key: 'VulkanUpscaler', value: 'ffx_12' },
    { section: 'FSR', key: 'Fsr4GpuSupport', value: '4' },
    { section: 'FSR', key: 'Fsr4Model', value: '3' },
    { section: 'FSR', key: 'Fsr4EnableWatermark', value: 'false' },
    { section: 'FrameGen', key: 'Enabled', value: 'false' },
    { section: 'Log', key: 'LogToFile', value: 'true' },
    { section: 'Log', key: 'LogLevel', value: '2' },
    { section: 'Menu', key: 'DisableSplash', value: 'true' },
    { section: 'Menu', key: 'ShowFps', value: overlay ? 'true' : 'auto' },
    { section: 'Menu', key: 'FpsOverlayType', value: overlay ? '1' : 'auto' },
    { section: 'Menu', key: 'FpsOverlayShowRatio', value: overlay ? 'true' : 'auto' },
    { section: 'Menu', key: 'FpsScale', value: overlay ? '0.8' : 'auto' },
    { section: 'Menu', key: 'FpsOverlayPos', value: overlay ? '0' : 'auto' },
    { section: 'Menu', key: 'FpsOverlayHorizontal', value: overlay ? 'false' : 'auto' },
    { section: 'UpscaleRatio', key: 'UpscaleRatioOverrideEnabled', value: ratio ? 'true' : 'auto' },
    { section: 'UpscaleRatio', key: 'UpscaleRatioOverrideValue', value: ratio || 'auto' },
    { section: 'Inputs', key: 'UseFsr2Dx11Inputs', value: dx11 ? 'true' : 'auto' },
    { section: 'Inputs', key: 'UseFsr2VulkanInputs', value: vulkan ? 'true' : 'auto' },
    { section: 'Inputs', key: 'Fsr2Pattern', value: options.noUpscaler ? 'true' : 'auto' },
    { section: 'Inputs', key: 'Fsr3Pattern', value: options.noUpscaler ? 'true' : 'auto' }
  ]
}

interface ParsedIniLine {
  raw: string
  kind: 'section' | 'key' | 'other'
  section: string
  key?: string
}

function parseIniLines(text: string): ParsedIniLine[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows = normalized.length === 0 ? [] : normalized.split('\n')
  let section = ''
  return rows.map((raw) => {
    const trimmed = raw.trim()
    const sectionMatch = /^\[([^\]]+)]$/.exec(trimmed)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      return { raw, kind: 'section', section }
    }
    const keyMatch = /^([^;#][^=]*?)=(.*)$/.exec(trimmed)
    if (keyMatch) {
      return { raw, kind: 'key', section, key: keyMatch[1].trim() }
    }
    return { raw, kind: 'other', section }
  })
}

/** Lee una clave. La usa el verificador y quien reescribe el ini de un juego ya instalado. */
export function iniValue(text: string, section: string, key: string): string | undefined {
  for (const line of parseIniLines(text)) {
    if (line.kind === 'key' && line.section === section && line.key === key) {
      const eq = line.raw.indexOf('=')
      return eq >= 0 ? line.raw.slice(eq + 1).trim() : undefined
    }
  }
  return undefined
}

/**
 * Conserva el ini del paquete (comentarios y claves ajenas) y fija las nuestras.
 * Si la sección no existe, se agrega al final.
 */
export function setIniValues(packageIni: string, assignments: readonly Fsr4IniAssignment[]): string {
  const lines = parseIniLines(packageIni)
  const pending = assignments.map((item) => ({ ...item, done: false }))
  const output: string[] = []
  // Al cerrar una sección se agregan las claves que el paquete no traía.
  const flushSection = (section: string): void => {
    for (const item of pending) {
      if (!item.done && item.section === section) {
        output.push(`${item.key}=${item.value}`)
        item.done = true
      }
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.kind === 'key' && line.key) {
      const match = pending.find((item) => !item.done && item.section === line.section && item.key === line.key)
      if (match) {
        output.push(`${match.key}=${match.value}`)
        match.done = true
      } else {
        output.push(line.raw)
      }
    } else {
      output.push(line.raw)
    }
    const next = lines[index + 1]
    if (line.section && (!next || next.section !== line.section)) flushSection(line.section)
  }
  const missingSections = [...new Set(pending.filter((item) => !item.done).map((item) => item.section))]
  for (const section of missingSections) {
    if (output.length > 0 && output[output.length - 1] !== '') output.push('')
    output.push(`[${section}]`)
    flushSection(section)
  }
  return `${output.join('\n').replace(/\n*$/, '')}\n`
}

export function mergeOptiScalerIni(packageIni: string, options: Fsr4IniOptions): string {
  return setIniValues(packageIni, iniAssignments(options))
}

function parentDirs(rel: string): string[] {
  const parts = rel.split('/')
  const dirs: string[] = []
  for (let index = 1; index < parts.length; index += 1) dirs.push(parts.slice(0, index).join('/'))
  return dirs
}

function existingDirsFromTree(tree: Record<string, string>): Set<string> {
  const dirs = new Set<string>()
  for (const file of Object.keys(tree)) {
    for (const dir of parentDirs(file)) dirs.add(dir)
  }
  return dirs
}

/**
 * Arma el plan de copia. El DLL de OptiScaler se renombra al proxy.
 * Los Lite van dentro de OptiScaler\. El ini del paquete se fusiona, no se pega crudo.
 */
export function planFsr4Install(input: {
  tree: Record<string, string>
  packageFiles: Record<string, string>
  fsrDx12: string
  fsrVk: string
  options: Fsr4IniOptions
  gameId: string
  optiBuild: string
  nowIso: string
  reframework?: { version: string, preexisting: readonly string[], dllContent: string }
}): Fsr4InstallPlan {
  const tree: Record<string, string> = {}
  for (const [path, content] of Object.entries(input.tree)) {
    const rel = safeRelativePath(path)
    if (rel) tree[rel] = content
  }
  const rootNames = Object.keys(tree).filter((path) => !path.includes('/'))
  const proxyName = chooseFsr4Proxy(rootNames)
  if (!proxyName) throw new Fsr4LiteFailure('no-proxy')
  const files: Fsr4PlannedFile[] = []
  const packageIni = input.packageFiles['OptiScaler.ini'] ?? input.packageFiles['optiscaler.ini'] ?? ''
  for (const [rawPath, content] of Object.entries(input.packageFiles)) {
    const rel = safeRelativePath(rawPath)
    if (!rel) continue
    const base = basenameOf(rel).toLowerCase()
    if ((FSR4_SKIP_PACKAGE_FILES as readonly string[]).includes(base)) continue
    if (base === 'optiscaler.dll' && !rel.includes('/')) {
      files.push({ path: proxyName, action: tree[proxyName] === undefined ? 'create' : 'replace', content })
      continue
    }
    if (base === 'optiscaler.ini' && !rel.includes('/')) continue
    files.push({ path: rel, action: tree[rel] === undefined ? 'create' : 'replace', content })
  }
  files.push({
    path: 'OptiScaler.ini',
    action: tree['OptiScaler.ini'] === undefined ? 'create' : 'replace',
    content: mergeOptiScalerIni(packageIni, input.options)
  })
  files.push({
    path: `${FSR4_OPTI_SUBDIR}/${FSR4_DLL_DX12}`,
    action: tree[`${FSR4_OPTI_SUBDIR}/${FSR4_DLL_DX12}`] === undefined ? 'create' : 'replace',
    content: input.fsrDx12
  })
  files.push({
    path: `${FSR4_OPTI_SUBDIR}/${FSR4_DLL_VK}`,
    action: tree[`${FSR4_OPTI_SUBDIR}/${FSR4_DLL_VK}`] === undefined ? 'create' : 'replace',
    content: input.fsrVk
  })
  const preexisting = new Set((input.reframework?.preexisting ?? []).map((name) => name.toLowerCase()))
  const reframeworkAdded = Boolean(input.reframework) && !preexisting.has(REFRAMEWORK_DLL_NAME)
  if (reframeworkAdded && input.reframework) {
    files.push({
      path: REFRAMEWORK_DLL_NAME,
      action: 'create',
      content: input.reframework.dllContent
    })
    if (!preexisting.has(REFRAMEWORK_CONFIG_NAME.toLowerCase())) {
      files.push({ path: REFRAMEWORK_CONFIG_NAME, action: 'create', content: REFRAMEWORK_CONFIG_TEXT })
    }
  }
  // Si el paquete y los Lite pisan la misma ruta, gana el Lite.
  const uniqueFiles = [...new Map(files.map((file) => [file.path, file])).values()]
  const dirs = existingDirsFromTree(tree)
  const createdDirs = [...new Set(uniqueFiles.filter((file) => file.action === 'create').flatMap((file) => parentDirs(file.path)))]
    .filter((dir) => !dirs.has(dir) && !dir.startsWith(`${FSR4_META_DIR}`))
  const manifest: Fsr4LiteManifest = {
    formatVersion: 1,
    gameId: input.gameId,
    proxyName,
    optiBuild: input.optiBuild,
    fsrVersion: FSR4_VERSION_LABEL,
    renderScale: input.options.renderScale,
    overlay: input.options.overlay,
    graphicsApi: input.options.graphicsApi,
    hasFsr2Dll: input.options.hasFsr2Dll,
    noUpscaler: input.options.noUpscaler,
    reframeworkVersion: reframeworkAdded ? input.reframework?.version ?? '' : '',
    reframeworkAdded,
    reframeworkPreexisting: [...(input.reframework?.preexisting ?? [])],
    createdFiles: uniqueFiles.filter((file) => file.action === 'create').map((file) => file.path),
    createdDirs,
    replacedFiles: uniqueFiles.filter((file) => file.action === 'replace').map((file) => file.path),
    installedAt: input.nowIso
  }
  // El log lo crea OptiScaler al jugar. Si no estaba, desinstalar lo borra.
  if (tree['OptiScaler.log'] === undefined) manifest.createdFiles.push('OptiScaler.log')
  return { proxyName, files: uniqueFiles, createdDirs, manifest }
}

/** Aplica el plan sobre una copia del árbol. Los reemplazos quedan en el backup. */
export function applyInstallPlan(tree: Record<string, string>, plan: Fsr4InstallPlan): Record<string, string> {
  const next: Record<string, string> = { ...tree }
  for (const file of plan.files) {
    if (file.action === 'replace' && next[file.path] !== undefined) {
      next[`${FSR4_META_DIR}/backup/${file.path}`] = next[file.path]
    }
    next[file.path] = file.content
  }
  next[`${FSR4_META_DIR}/manifest.json`] = JSON.stringify(plan.manifest)
  return next
}

/**
 * Deshace el plan: restaura backups, borra lo creado y, si nosotros pusimos
 * REFramework, también sus archivos de runtime que no estaban antes.
 */
export function applyUninstallPlan(tree: Record<string, string>, manifest: Fsr4LiteManifest): Record<string, string> {
  const next: Record<string, string> = { ...tree }
  for (const file of manifest.replacedFiles) {
    const backup = next[`${FSR4_META_DIR}/backup/${file}`]
    if (backup !== undefined) next[file] = backup
  }
  for (const file of manifest.createdFiles) delete next[file]
  const created = [...manifest.createdDirs].sort((a, b) => b.length - a.length)
  for (const dir of created) {
    for (const key of Object.keys(next)) {
      if (key === dir || key.startsWith(`${dir}/`)) delete next[key]
    }
  }
  if (manifest.reframeworkAdded) {
    const keep = new Set(manifest.reframeworkPreexisting.map((name) => name.toLowerCase()))
    for (const key of Object.keys(next)) {
      const base = basenameOf(key).toLowerCase()
      const top = key.split('/')[0]?.toLowerCase()
      const runtime = top === 'reframework'
        || base === REFRAMEWORK_DLL_NAME
        || base === REFRAMEWORK_CONFIG_NAME.toLowerCase()
        || base.endsWith('_fw_log.txt')
        || base.endsWith('_fw_config.txt')
      if (runtime && !keep.has(base) && !keep.has(top ?? '')) delete next[key]
    }
  }
  for (const key of Object.keys(next)) {
    if (key === FSR4_META_DIR || key.startsWith(`${FSR4_META_DIR}/`)) delete next[key]
  }
  return next
}

export function roundTripInstall(input: Parameters<typeof planFsr4Install>[0]): {
  installed: Record<string, string>
  restored: Record<string, string>
  plan: Fsr4InstallPlan
} {
  const plan = planFsr4Install(input)
  const installed = applyInstallPlan(input.tree, plan)
  return { installed, restored: applyUninstallPlan(installed, plan.manifest), plan }
}

const FEATURE_RESOLUTION = /Render Resolution:\s*(\d+)x(\d+),\s*Display Resolution\s*(\d+)x(\d+)/gi
const WIDTH_RESOLUTION = /renderWidth:\s*(\d+),\s*maxWidth:\s*(\d+)/gi

function lastResolution(log: string): string | undefined {
  let match: RegExpExecArray | null
  let found: string | undefined
  const feature = new RegExp(FEATURE_RESOLUTION)
  while ((match = feature.exec(log))) {
    found = `${match[1]}x${match[2]} → ${match[3]}x${match[4]}`
  }
  const widths = new RegExp(WIDTH_RESOLUTION)
  let width: RegExpExecArray | null = null
  let lastWidth: RegExpExecArray | null = null
  while ((width = widths.exec(log))) lastWidth = width
  const featureLast = [...log.matchAll(new RegExp(FEATURE_RESOLUTION))].pop()
  if (lastWidth && (!featureLast || lastWidth.index > (featureLast.index ?? 0))) {
    return `${lastWidth[1]} → ${lastWidth[2]}`
  }
  return found
}

/**
 * Lee OptiScaler.log después de la sesión.
 * Lite enganchado → active. Copia del driver (DriverStore) → not-lite.
 * Vacío → not-loaded. OptiScaler presente sin señal clara → unknown.
 */
export function parseOptiScalerSessionLog(log: string | null | undefined): {
  status: Fsr4SessionStatus
  resolution?: string
} {
  if (log == null || log.trim() === '') return { status: 'not-loaded' }
  const text = log.length > 2_000_000 ? log.slice(0, 2_000_000) : log
  const line = lastResolution(text)
  const resolution = line ? `Rendering ${line}` : undefined
  const lite = text.includes('ffxProvider_FSR4Lite_Int8')
  const driver = /driverstore/i.test(text) && /amdxcffx64\.dll|amdvkffx64\.dll/i.test(text)
  const cannot = /can't run any fsr 4 model|doesn't support fsr 4/i.test(text)
  if (lite && !driver) return { status: 'active', resolution }
  if (driver || cannot) return { status: 'not-lite', resolution }
  if (!/optiscaler/i.test(text)) return { status: 'not-loaded' }
  return { status: 'unknown', resolution }
}

export function shouldRefreshOptiScaler(input: {
  enabled: boolean
  platform: string
  now: number
  lastCheckAt: number | null
}): boolean {
  if (!input.enabled || input.platform !== 'win32') return false
  if (input.lastCheckAt == null) return true
  return input.now - input.lastCheckAt >= OPTI_CHECK_INTERVAL_MS
}

export function optiScalerBuildDate(name: string): number | null {
  const match = /_(\d{8})\.7z$/i.exec(name.trim())
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

/** Un build más nuevo es una fecha YYYYMMDD mayor en el nombre del .7z. */
export function isNewerOptiBuild(installed: string | null | undefined, candidate: string): boolean {
  if (!installed) return true
  const left = optiScalerBuildDate(installed)
  const right = optiScalerBuildDate(candidate)
  if (left == null || right == null) return installed.toLowerCase() !== candidate.toLowerCase()
  return right > left
}

export interface Fsr4NightlyAsset {
  tag: string
  name: string
  url: string
  digest: string
  size: number
}

/** Elige el .7z con la fecha más alta que traiga digest sha256. */
export function pickOptiScalerNightly(releases: unknown): Fsr4NightlyAsset | null {
  if (!Array.isArray(releases)) return null
  let best: Fsr4NightlyAsset | null = null
  for (const release of releases) {
    if (!release || typeof release !== 'object') continue
    const tag = typeof (release as { tag_name?: unknown }).tag_name === 'string'
      ? (release as { tag_name: string }).tag_name
      : ''
    const assets = (release as { assets?: unknown }).assets
    if (!Array.isArray(assets)) continue
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object') continue
      const row = asset as { name?: unknown, browser_download_url?: unknown, digest?: unknown, size?: unknown }
      if (typeof row.name !== 'string' || !/^OptiScaler_.+\.7z$/i.test(row.name)) continue
      if (typeof row.browser_download_url !== 'string' || typeof row.digest !== 'string') continue
      if (!/^sha256:[0-9a-f]{64}$/i.test(row.digest.trim())) continue
      const size = typeof row.size === 'number' ? row.size : 0
      const date = optiScalerBuildDate(row.name) ?? 0
      const bestDate = best ? optiScalerBuildDate(best.name) ?? 0 : -1
      if (!best || date > bestDate) {
        best = { tag, name: row.name, url: row.browser_download_url, digest: row.digest.trim(), size }
      }
    }
  }
  return best
}

export function acceptDownloadDigest(githubDigest: string, sha256Hex: string): boolean {
  const match = /^sha256:([0-9a-f]{64})$/i.exec(githubDigest.trim())
  if (!match) return false
  return match[1].toLowerCase() === sha256Hex.trim().toLowerCase()
}

export function companyIsAmd(company: string | null | undefined): boolean {
  if (!company) return false
  const value = company.toLowerCase()
  return value.includes('advanced micro devices') || /(^|[^a-z])amd([^a-z]|$)/.test(value)
}

/** PE (MZ), compañía AMD y tamaño > 50 MB. El nombre tiene que ser uno de los dos DLL. */
export function validateFsrDriverFile(input: {
  fileName: string
  size: number
  header: Uint8Array | readonly number[]
  company: string | null
}): { ok: true } | { ok: false, reason: 'name' | 'size' | 'pe' | 'company' } {
  const name = basenameOf(input.fileName).toLowerCase()
  if (name !== FSR4_DLL_DX12 && name !== FSR4_DLL_VK) return { ok: false, reason: 'name' }
  if (!Number.isFinite(input.size) || input.size <= FSR4_MIN_DLL_BYTES) return { ok: false, reason: 'size' }
  if (input.header.length < 2 || input.header[0] !== 0x4d || input.header[1] !== 0x5a) return { ok: false, reason: 'pe' }
  if (!companyIsAmd(input.company)) return { ok: false, reason: 'company' }
  return { ok: true }
}

export interface Fsr4CacheRecord {
  source: Exclude<Fsr4FileSource, 'missing'>
  files: { name: string, size: number, etag?: string }[]
  recordedAt: string
}

export function compatNoteForGame(markdown: string, gameName: string): string | null {
  const needle = gameName.trim().toLowerCase()
  if (needle.length < 3) return null
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((cell) => cell.trim()).filter((cell) => cell.length > 0)
    if (cells.length < 2) continue
    if (cells[0].toLowerCase() === 'game' || /^[-:]+$/.test(cells[0])) continue
    if (!cells[0].toLowerCase().includes(needle) && !needle.includes(cells[0].toLowerCase())) continue
    const notes = cells[cells.length - 1]
    return notes.length > 0 ? notes : null
  }
  return null
}

export function compatRequiresReFramework(notes: string | null | undefined): boolean {
  return Boolean(notes && /requires\W+\[?reframework/i.test(notes))
}

/** La API gráfica no viene en la ficha: DX12 es el supuesto hasta que el usuario lo cambie. */
export const FSR4_DEFAULT_GRAPHICS_API: Fsr4GraphicsApi = 'DX12'

export interface Fsr4LiteStatus {
  supported: boolean
  device: Fsr4DeviceReport
  fsrSource: Fsr4FileSource
  optiBuild: string | null
}

export interface Fsr4LiteGameView {
  supported: boolean
  phase: 'hidden' | 'ready' | 'installed' | 'widget' | 'blocked'
  block?: Fsr4BlockCode
  antiCheat?: string
  upscalers: Fsr4UpscalerKind[]
  noUpscaler: boolean
  renderScale: Fsr4RenderScale
  overlay: boolean
  graphicsApi: Fsr4GraphicsApi
  sessionStatus: 'none' | Fsr4SessionStatus
  resolution?: string
  optiBuild?: string
  compatNote?: string
}

export type Fsr4LiteEvent =
  | { kind: 'progress', gameId: string, phase: 'optiscaler' | 'fsr' | 'reframework' | 'copy', received: number, total: number }
  | { kind: 'session', gameId: string, status: Fsr4SessionStatus, resolution?: string }
