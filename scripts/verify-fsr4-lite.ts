/**
 * Verifica la lógica pura de FSR 4.1 Lite en macOS.
 * No baja archivos ni toca un juego de verdad: eso es de Windows.
 */
import assert from 'node:assert/strict'
import {
  FSR4_DEFAULT_GRAPHICS_API,
  FSR4_DLL_DX12,
  FSR4_MIN_DLL_BYTES,
  OPTI_CHECK_INTERVAL_MS,
  REFRAMEWORK_CONFIG_TEXT,
  FSR4_WALK_MAX_DEPTH,
  OPTI_FAIL_BACKOFF_MS,
  acceptDownloadDigest,
  acceptDownloadSize,
  applyUninstallPlan,
  assessFsr4Target,
  assessOptiScalerArchiveEntries,
  chooseFsr4Proxy,
  classifyFsr4Device,
  classifyGameRoot,
  classifyInstallPath,
  compatNoteForGame,
  compatRequiresReFramework,
  createFsr4MutationGate,
  fsrCacheIsReusable,
  iniValue,
  isNewerOptiBuild,
  launcherMayUpdate,
  mergeOptiScalerIni,
  parseOptiScalerSessionLog,
  pe64HeaderValid,
  pickOptiScalerNightly,
  planFsr4Install,
  resolveGameExecutable,
  roundTripInstall,
  safeRelativePath,
  selectGameExecutable,
  sessionLogIsFresh,
  setIniValues,
  shouldRefreshOptiScaler,
  validateFsrDriverFile,
  walkDirectoryDecision,
  type Fsr4GraphicsApi,
  type Fsr4IniOptions,
  type Fsr4RenderScale
} from '../src/shared/fsr4LitePolicy.ts'

const PACKAGE_INI = [
  '[Upscalers]',
  'Dx12Upscaler=auto',
  'DlssUpscaler=auto',
  '; keep me',
  '',
  '[Custom]',
  'Keep=yes',
  '',
  '[Menu]',
  'ShowFps=auto',
  ''
].join('\n')

const RATIO: Record<Fsr4RenderScale, string> = {
  game: '',
  native: '1.0',
  quality: '1.5',
  balanced: '1.7',
  performance: '2.0'
}

function expectRecipe(options: Fsr4IniOptions): void {
  const ini = mergeOptiScalerIni(PACKAGE_INI, options)
  assert.equal(iniValue(ini, 'Upscalers', 'Dx12Upscaler'), 'ffx')
  assert.equal(iniValue(ini, 'Upscalers', 'Dx11Upscaler'), 'ffx_12')
  assert.equal(iniValue(ini, 'Upscalers', 'VulkanUpscaler'), 'ffx_12')
  assert.equal(iniValue(ini, 'Upscalers', 'DlssUpscaler'), 'auto', 'una clave del paquete se queda')
  assert.equal(iniValue(ini, 'Custom', 'Keep'), 'yes')
  assert.match(ini, /; keep me/)
  assert.equal(iniValue(ini, 'FSR', 'Fsr4GpuSupport'), '4')
  assert.equal(iniValue(ini, 'FSR', 'Fsr4Model'), '3')
  assert.equal(iniValue(ini, 'FSR', 'Fsr4EnableWatermark'), 'false')
  assert.equal(iniValue(ini, 'FrameGen', 'Enabled'), 'false')
  assert.equal(iniValue(ini, 'Log', 'LogToFile'), 'true')
  assert.equal(iniValue(ini, 'Log', 'LogLevel'), '2')
  assert.equal(iniValue(ini, 'Menu', 'DisableSplash'), 'true')
  assert.equal(iniValue(ini, 'Menu', 'ShowFps'), options.overlay ? 'true' : 'auto')
  assert.equal(iniValue(ini, 'Menu', 'FpsOverlayType'), options.overlay ? '1' : 'auto')
  assert.equal(iniValue(ini, 'Menu', 'FpsOverlayShowRatio'), options.overlay ? 'true' : 'auto')
  assert.equal(iniValue(ini, 'Menu', 'FpsScale'), options.overlay ? '0.8' : 'auto')
  assert.equal(iniValue(ini, 'Menu', 'FpsOverlayPos'), options.overlay ? '0' : 'auto')
  assert.equal(iniValue(ini, 'Menu', 'FpsOverlayHorizontal'), options.overlay ? 'false' : 'auto')
  const ratio = RATIO[options.renderScale]
  assert.equal(iniValue(ini, 'UpscaleRatio', 'UpscaleRatioOverrideEnabled'), ratio ? 'true' : 'auto')
  assert.equal(iniValue(ini, 'UpscaleRatio', 'UpscaleRatioOverrideValue'), ratio || 'auto')
  const dx11 = options.hasFsr2Dll && options.graphicsApi === 'DX11'
  const vulkan = options.hasFsr2Dll && options.graphicsApi === 'Vulkan'
  assert.equal(iniValue(ini, 'Inputs', 'UseFsr2Dx11Inputs'), dx11 ? 'true' : 'auto')
  assert.equal(iniValue(ini, 'Inputs', 'UseFsr2VulkanInputs'), vulkan ? 'true' : 'auto')
  assert.equal(iniValue(ini, 'Inputs', 'Fsr2Pattern'), options.noUpscaler ? 'true' : 'auto')
  assert.equal(iniValue(ini, 'Inputs', 'Fsr3Pattern'), options.noUpscaler ? 'true' : 'auto')
}

const scales: Fsr4RenderScale[] = ['game', 'native', 'quality', 'balanced', 'performance']
const apis: Fsr4GraphicsApi[] = ['DX12', 'DX11', 'Vulkan']
for (const renderScale of scales) {
  for (const overlay of [false, true]) {
    for (const graphicsApi of apis) {
      for (const hasFsr2Dll of [false, true]) {
        for (const noUpscaler of [false, true]) {
          expectRecipe({ renderScale, overlay, graphicsApi, hasFsr2Dll, noUpscaler })
        }
      }
    }
  }
}
assert.equal(FSR4_DEFAULT_GRAPHICS_API, 'DX12')

assert.equal(chooseFsr4Proxy([]), 'dxgi.dll')
assert.equal(chooseFsr4Proxy(['dxgi.dll', 'WinMM.dll']), 'version.dll')
assert.equal(chooseFsr4Proxy([
  'dxgi.dll', 'winmm.dll', 'version.dll', 'dbghelp.dll', 'd3d12.dll', 'wininet.dll', 'winhttp.dll'
]), null)

const unreal = selectGameExecutable([
  { relativePath: 'Engine/Binaries/Win64/CrashReportClient.exe', size: 9_000 },
  { relativePath: 'Game/Binaries/Win64/Game-Win64-Shipping.exe', size: 100 },
  { relativePath: 'Game/Binaries/Win64/Game.exe', size: 5 }
], true)
assert.equal(unreal?.relativePath, 'Game/Binaries/Win64/Game-Win64-Shipping.exe')
assert.equal(unreal?.unreal, true)

const wingdk = selectGameExecutable([
  { relativePath: 'Proj/Binaries/WinGDK/Proj-WinGDK-Shipping.exe', size: 80 }
], false)
assert.equal(wingdk?.unreal, true)
assert.match(wingdk?.relativePath ?? '', /WinGDK/)

const projectExe = selectGameExecutable([
  { relativePath: 'Engine/Binaries/Win64/UE4Editor.exe', size: 9_999 },
  { relativePath: 'Proj/Binaries/Win64/Tiny.exe', size: 10 },
  { relativePath: 'Proj/Binaries/Win64/Proj.exe', size: 500 }
], true)
assert.equal(projectExe?.relativePath, 'Proj/Binaries/Win64/Proj.exe')
assert.equal(projectExe?.unreal, true)

const plain = selectGameExecutable([
  { relativePath: 'bin/crashreport.exe', size: 9_000 },
  { relativePath: 'game.exe', size: 20 },
  { relativePath: 'tools/helper.exe', size: 50 }
], false)
assert.equal(plain?.relativePath, 'tools/helper.exe')
assert.equal(plain?.unreal, false)

const blocked = assessFsr4Target({
  provider: 'steam',
  installed: true,
  installDir: 'D:/Games/Online',
  exeName: 'game.exe',
  files: ['EasyAntiCheat/start_protected_game.exe', 'game.exe']
})
assert.equal(blocked.block, 'anti-cheat')
assert.equal(blocked.antiCheat, 'Easy Anti-Cheat')

assert.equal(assessFsr4Target({
  provider: 'steam',
  installed: true,
  exeName: 'cs2.exe',
  executablePath: 'D:/Steam/cs2.exe',
  files: ['cs2.exe']
}).antiCheat, 'Valve Anti-Cheat')

assert.equal(assessFsr4Target({
  provider: 'xbox',
  installed: true,
  executablePath: 'C:/Program Files/WindowsApps/Publisher.Game/game.exe',
  files: ['game.exe']
}).block, 'windows-apps')

assert.equal(assessFsr4Target({
  provider: 'playstation',
  installed: true,
  executablePath: 'C:/Games/a.exe',
  files: []
}).block, 'remote')

const widget = assessFsr4Target({
  provider: 'steam',
  installed: true,
  exeName: 'game.exe',
  executablePath: 'D:/Games/game.exe',
  files: ['.ralfsr/manifest.json', 'game.exe', 'nvngx_dlss.dll']
})
assert.equal(widget.kind, 'widget')
assert.equal(widget.block, undefined)

const ready = assessFsr4Target({
  provider: 'steam',
  installed: true,
  exeName: 'game.exe',
  executablePath: 'D:/Games/Binaries/Win64/game.exe',
  files: ['nvngx_dlss.dll', 'ffx_fsr2_api_dx12_x64.dll', 'libxess.dll']
})
assert.equal(ready.kind, 'ready')
assert.equal(ready.unreal, true)
assert.deepEqual(ready.upscalers, ['fsr', 'dlss', 'xess'])
assert.equal(ready.hasFsr2, true)
assert.equal(ready.noUpscaler, false)

assert.equal(assessFsr4Target({
  provider: 'local',
  installed: true,
  exeName: 'DD2.exe',
  executablePath: 'D:/DD2/DD2.exe',
  files: ['DD2.exe', 're_chunk_000.pak']
}).needsReFramework, true)

const ally = classifyFsr4Device({
  adapters: [
    'AMD Radeon(TM) 890M Graphics',
    'NVIDIA GeForce RTX 4060',
    'Virtual Display Adapter'
  ]
})
assert.equal(ally.support, 'supported')
assert.equal(ally.egpuNote, true)
assert.equal(ally.primaryGpu, 'AMD Radeon(TM) 890M Graphics')
assert.deepEqual(ally.gpuNames, [
  'AMD Radeon(TM) 890M Graphics',
  'NVIDIA GeForce RTX 4060'
])

assert.equal(classifyFsr4Device({
  adapters: ['AMD Radeon(TM) 890M Graphics'],
  cpu: 'AMD Ryzen Z2 Extreme',
  model: 'ROG Xbox Ally X',
  manufacturer: 'ASUSTeK COMPUTER INC.'
}).support, 'official-driver')

assert.equal(classifyFsr4Device({
  adapters: ['AMD Radeon Graphics'],
  cpu: 'AMD Ryzen Z2 Go'
}).support, 'experimental')

const nvidiaOnly = classifyFsr4Device({ adapters: ['NVIDIA GeForce RTX 4060'] })
assert.equal(nvidiaOnly.support, 'unsupported')
assert.equal(nvidiaOnly.egpuNote, false)
assert.equal(classifyFsr4Device({ adapters: [] }).support, 'unknown')

const before: Record<string, string> = {
  'game.exe': 'game',
  'dxgi.dll': 'original-dxgi',
  'OptiScaler.ini': 'original-ini',
  'OptiScaler/readme.txt': 'keep'
}
const trip = roundTripInstall({
  tree: before,
  packageFiles: {
    'OptiScaler.dll': 'proxy-bytes',
    'OptiScaler.ini': PACKAGE_INI,
    'setup_windows.bat': 'do-not-copy',
    'setup_linux.sh': 'do-not-copy',
    'remove optiscaler.bat': 'do-not-copy',
    'Licenses/GPL.txt': 'gpl',
    'OptiScaler/amd_fidelityfx_dx12.dll': 'fsr3',
    'OptiScaler/D3D12_OptiScaler/note.txt': 'nested'
  },
  fsrDx12: 'lite-dx12',
  fsrVk: 'lite-vk',
  options: {
    overlay: true,
    renderScale: 'quality',
    graphicsApi: 'DX12',
    hasFsr2Dll: false,
    noUpscaler: false
  },
  gameId: 'steam:1',
  optiBuild: 'OptiScaler_v10.0.0-pre1_20261027.7z',
  nowIso: '2026-10-27T00:00:00.000Z',
  reframework: { version: 'nightly-01389', preexisting: [], dllContent: 'refw' }
})
assert.equal(trip.plan.proxyName, 'winmm.dll')
assert.equal(trip.installed['dxgi.dll'], 'original-dxgi')
assert.equal(trip.installed['winmm.dll'], 'proxy-bytes')
assert.equal(trip.installed['setup_windows.bat'], undefined)
assert.equal(trip.installed['Licenses/GPL.txt'], 'gpl')
assert.equal(trip.installed[`OptiScaler/${FSR4_DLL_DX12}`], 'lite-dx12')
assert.equal(trip.installed['OptiScaler/amdvkffx64.dll'], 'lite-vk')
assert.equal(trip.installed['OptiScaler/readme.txt'], 'keep')
assert.equal(iniValue(trip.installed['OptiScaler.ini'], 'UpscaleRatio', 'UpscaleRatioOverrideValue'), '1.5')
assert.equal(iniValue(trip.installed['OptiScaler.ini'], 'Menu', 'ShowFps'), 'true')
assert.match(trip.installed['dinput8.dll'], /refw/)
assert.match(trip.installed['re2_fw_config.txt'], /ShortcutKey=0x24/)
assert.match(REFRAMEWORK_CONFIG_TEXT, /REFrameworkConfig_MenuOpen=false/)
assert.equal(trip.installed['.mt3k-fsr/backup/OptiScaler.ini'], 'original-ini')
const clean = applyUninstallPlan(trip.installed, trip.plan.manifest)
assert.deepEqual(clean, before)
const withRuntime = {
  ...trip.installed,
  'reframework/log.txt': 'runtime',
  're2_fw_log.txt': 'runtime-log',
  'OptiScaler/user-mod.dll': 'mod',
  'OptiScaler.log': 'session'
}
const restored = applyUninstallPlan(withRuntime, trip.plan.manifest)
assert.equal(restored['reframework/log.txt'], 'runtime')
assert.equal(restored['re2_fw_log.txt'], 'runtime-log')
assert.equal(restored['OptiScaler/user-mod.dll'], 'mod')
assert.equal(restored['OptiScaler.log'], 'session')
assert.equal(restored['dxgi.dll'], 'original-dxgi')
assert.equal(restored['OptiScaler.ini'], 'original-ini')
assert.equal(restored['winmm.dll'], undefined)
assert.equal(restored['.mt3k-fsr/manifest.json'], undefined)

const leaveTheirs = planFsr4Install({
  tree: { 'game.exe': 'game', 'dinput8.dll': 'theirs' },
  packageFiles: { 'OptiScaler.dll': 'proxy', 'OptiScaler.ini': '' },
  fsrDx12: 'a',
  fsrVk: 'b',
  options: { overlay: false, renderScale: 'game', graphicsApi: 'DX12', hasFsr2Dll: false, noUpscaler: true },
  gameId: 'local:1',
  optiBuild: 'OptiScaler_v10.0.0-pre1_20261027.7z',
  nowIso: '2026-10-27T00:00:00.000Z',
  reframework: { version: 'nightly-1', preexisting: ['dinput8.dll', 'reframework'], dllContent: 'ours' }
})
assert.equal(leaveTheirs.manifest.reframeworkAdded, false)
assert.equal(leaveTheirs.files.some((file) => file.path === 'dinput8.dll'), false)

const activeLog = [
  'OptiScaler loaded',
  'amdxcffx64.dll from D:/Games/OptiScaler/amdxcffx64.dll',
  'ffxProvider_FSR4Lite_Int8 hooked',
  'Render Resolution: 1280x720, Display Resolution 1920x1080'
].join('\n')
const active = parseOptiScalerSessionLog(activeLog)
assert.equal(active.status, 'active')
assert.equal(active.resolution, '1280x720 → 1920x1080')

const notLite = parseOptiScalerSessionLog([
  'OptiScaler loaded',
  'C:\\Windows\\System32\\DriverStore\\FileRepository\\amdxcffx64.dll'
].join('\n'))
assert.equal(notLite.status, 'not-lite')
assert.equal(parseOptiScalerSessionLog('').status, 'not-loaded')
assert.equal(parseOptiScalerSessionLog(null).status, 'not-loaded')
assert.equal(parseOptiScalerSessionLog('OptiScaler started, waiting').status, 'unknown')

const day = OPTI_CHECK_INTERVAL_MS
assert.equal(shouldRefreshOptiScaler({
  enabled: true, platform: 'win32', now: 1_000_000, lastCheckAt: 1_000_000 - day + 1
}), false)
assert.equal(shouldRefreshOptiScaler({
  enabled: true, platform: 'win32', now: 1_000_000, lastCheckAt: 1_000_000 - day
}), true)
assert.equal(shouldRefreshOptiScaler({
  enabled: true, platform: 'win32', now: 50, lastCheckAt: null
}), true)
assert.equal(shouldRefreshOptiScaler({
  enabled: false, platform: 'win32', now: 50, lastCheckAt: null
}), false)
assert.equal(shouldRefreshOptiScaler({
  enabled: true, platform: 'darwin', now: 50, lastCheckAt: null
}), false)

const older = 'OptiScaler_v10.0.0-pre1_20261026.7z'
const newer = 'OptiScaler_v10.0.0-pre1_20261027.7z'
assert.equal(isNewerOptiBuild(older, newer), true)
assert.equal(isNewerOptiBuild(newer, newer), false)
assert.equal(isNewerOptiBuild(newer, older), false)
assert.equal(isNewerOptiBuild(null, newer), true)

const digest = 'ab'.repeat(32)
const picked = pickOptiScalerNightly([
  {
    tag_name: 'nightly-20261026',
    assets: [{
      name: older,
      browser_download_url: 'https://example.test/old.7z',
      digest: `sha256:${'cd'.repeat(32)}`,
      size: 10
    }]
  },
  {
    tag_name: 'nightly-20261027',
    assets: [
      { name: 'readme.txt', browser_download_url: 'https://example.test/readme', digest: `sha256:${digest}`, size: 1 },
      { name: newer, browser_download_url: 'https://example.test/new.7z', digest: `sha256:${digest}`, size: 57_000_000 }
    ]
  }
])
assert.equal(picked?.name, newer)
assert.equal(picked?.digest, `sha256:${digest}`)
assert.equal(acceptDownloadDigest(picked?.digest ?? '', digest.toUpperCase()), true)
assert.equal(acceptDownloadDigest(`sha256:${'ff'.repeat(32)}`, digest), false)
assert.equal(acceptDownloadDigest('md5:abc', digest), false)
assert.equal(pickOptiScalerNightly([{ tag_name: 'x', assets: [{ name: newer, browser_download_url: 'https://example.test/a.7z' }] }]), null)

function samplePe64Header(): Uint8Array {
  const header = new Uint8Array(512)
  header[0] = 0x4d
  header[1] = 0x5a
  header[0x3c] = 0x80
  const pe = 0x80
  header[pe] = 0x50
  header[pe + 1] = 0x45
  header[pe + 4] = 0x64
  header[pe + 5] = 0x86
  header[pe + 6] = 1
  header[pe + 20] = 0xf0
  header[pe + 24] = 0x0b
  header[pe + 25] = 0x02
  return header
}

const measured = 85_684_104
assert.ok(measured > FSR4_MIN_DLL_BYTES)
assert.equal(pe64HeaderValid(samplePe64Header()), true)
assert.deepEqual(validateFsrDriverFile({
  fileName: 'amdxcffx64.dll',
  size: measured,
  header: samplePe64Header(),
  company: 'Advanced Micro Devices, Inc.'
}), { ok: true })
assert.equal(validateFsrDriverFile({
  fileName: 'amdvkffx64.dll',
  size: 72_497_568,
  header: samplePe64Header(),
  company: 'AMD'
}).ok, true)
assert.equal(validateFsrDriverFile({
  fileName: 'amdxcffx64.dll',
  size: measured,
  header: [0x4d, 0x5a],
  company: 'Advanced Micro Devices, Inc.'
}).ok, false)
assert.equal(validateFsrDriverFile({
  fileName: 'amdxcffx64.dll',
  size: 49 * 1024 * 1024,
  header: [0x4d, 0x5a],
  company: 'AMD'
}).ok, false)
assert.equal(validateFsrDriverFile({
  fileName: 'amdxcffx64.dll',
  size: measured,
  header: [0x50, 0x4b],
  company: 'AMD'
}).ok, false)
assert.equal(validateFsrDriverFile({
  fileName: 'amdxcffx64.dll',
  size: measured,
  header: [0x4d, 0x5a],
  company: 'NVIDIA Corporation'
}).ok, false)
assert.equal(validateFsrDriverFile({
  fileName: 'evil.dll',
  size: measured,
  header: [0x4d, 0x5a],
  company: 'AMD'
}).ok, false)

const note = compatNoteForGame([
  '| Game | API | Notes |',
  '| --- | --- | --- |',
  '| Example Game | DX12 | Requires REFramework |'
].join('\n'), 'Example Game')
assert.equal(note, 'Requires REFramework')
assert.equal(compatRequiresReFramework(note), true)
assert.equal(compatNoteForGame('| Other | DX12 | fine |', 'Example Game'), null)

const probeBase = {
  packageFiles: { 'OptiScaler.dll': 'proxy', 'OptiScaler.ini': '[Custom]\nKeep=yes\n[Menu]\nShowFps=auto\n' },
  fsrDx12: 'lite-dx',
  fsrVk: 'lite-vk',
  options: { overlay: false, renderScale: 'game' as const, graphicsApi: 'DX12' as const, hasFsr2Dll: false, noUpscaler: true },
  gameId: 'local:1',
  optiBuild: 'OptiScaler_v10_20261027.7z',
  nowIso: '2026-10-27T00:00:00.000Z'
}

// P1: en un disco que no distingue mayúsculas, el archivo que ya está se reemplaza.
const casePlan = planFsr4Install({
  ...probeBase,
  tree: { 'game.exe': 'game', 'optiscaler.ini': 'user', 'optiscaler/amdxcffx64.dll': 'user-dll', 'DXGI.dll': 'wrapper' }
})
assert.equal(casePlan.proxyName, 'winmm.dll')
assert.deepEqual(classifyInstallPath({ 'DXGI.dll': 'wrapper' }, 'dxgi.dll'), { action: 'replace', path: 'DXGI.dll' })
const caseIni = casePlan.files.find((file) => file.path.toLowerCase() === 'optiscaler.ini')
const caseDll = casePlan.files.find((file) => file.path.toLowerCase().endsWith('amdxcffx64.dll'))
assert.equal(caseIni?.action, 'replace')
assert.equal(caseIni?.path, 'optiscaler.ini')
assert.equal(caseDll?.action, 'replace')
assert.equal(caseDll?.path, 'optiscaler/amdxcffx64.dll')
assert.ok(casePlan.manifest.replacedFiles.some((file) => file.toLowerCase() === 'optiscaler.ini'))
assert.equal(casePlan.files.some((file) => file.path.toLowerCase() === 'dxgi.dll'), false)

// Un ini editado y un mod no se borran. Un backup que no está, para todo.
const edited = roundTripInstall({ ...probeBase, tree: { 'game.exe': 'game' } })
edited.installed['OptiScaler.ini'] = 'user-edit'
edited.installed['dxgi.dll'] = 'game-update'
edited.installed['OptiScaler/user-mod.dll'] = 'mod'
const kept = applyUninstallPlan(edited.installed, edited.plan.manifest)
assert.equal(kept['OptiScaler.ini'], 'user-edit')
assert.equal(kept['dxgi.dll'], 'game-update')
assert.equal(kept['OptiScaler/user-mod.dll'], 'mod')
assert.throws(() => applyUninstallPlan(
  { 'OptiScaler.ini': 'ours', '.mt3k-fsr/manifest.json': '{}' },
  { ...edited.plan.manifest, replacedFiles: ['OptiScaler.ini'], state: 'committed' }
), /backup-missing/)

// P6: raíces que no son una carpeta de juego.
assert.equal(classifyGameRoot('C:\\Windows'), 'windows')
assert.equal(classifyGameRoot('C:\\Windows\\System32'), 'system')
assert.equal(classifyGameRoot('C:\\Program Files'), 'program-files')
assert.equal(classifyGameRoot('C:\\Program Files (x86)'), 'program-files')
assert.equal(classifyGameRoot('\\\\server\\share\\'), 'unc-root')
assert.equal(classifyGameRoot('relative'), 'relative')
assert.equal(classifyGameRoot('C:\\'), 'drive-root')
assert.equal(classifyGameRoot('D:\\Games\\Example'), null)
assert.equal(safeRelativePath('foo:stream'), null)
assert.equal(safeRelativePath('OptiScaler.ini.'), null)
assert.equal(safeRelativePath('CON'), null)

// P8: el bootstrapper de la raíz no gana al Shipping.
const shippingOverBootstrap = resolveGameExecutable({
  storedRelative: 'root.exe',
  hasEngineDir: true,
  entries: [
    { relativePath: 'root.exe', size: 10 },
    { relativePath: 'Project/Binaries/Win64/Game-Win64-Shipping.exe', size: 100 }
  ]
})
assert.equal(shippingOverBootstrap?.relativePath, 'Project/Binaries/Win64/Game-Win64-Shipping.exe')
assert.equal(shippingOverBootstrap?.unreal, true)

// P9: dos DLL chiquitos no se reusan aunque estén en la caché.
assert.equal(fsrCacheIsReusable({
  record: { files: [
    { name: 'amdxcffx64.dll', size: 7, sha256: 'aa' },
    { name: 'amdvkffx64.dll', size: 7, sha256: 'bb' }
  ] },
  files: [
    { name: 'amdxcffx64.dll', size: 7, sha256: 'aa', header: [0x4d, 0x5a], company: 'AMD' },
    { name: 'amdvkffx64.dll', size: 7, sha256: 'bb', header: [0x4d, 0x5a], company: 'AMD' }
  ]
}), false)

// P11: si apareció el widget, el actualizador no toca el proxy.
assert.equal(launcherMayUpdate({
  files: ['.ralfsr/manifest.json', 'dxgi.dll'],
  manifestState: 'committed',
  running: false,
  rootRefusal: null,
  scanTruncated: false
}), 'widget')
assert.equal(launcherMayUpdate({
  files: ['dxgi.dll'],
  manifestState: 'pending',
  running: false,
  rootRefusal: null,
  scanTruncated: false
}), 'broken')
assert.equal(launcherMayUpdate({
  files: ['Engine/EasyAntiCheat/start_protected_game.exe'],
  dirs: ['Engine/EasyAntiCheat'],
  manifestState: 'committed',
  running: true,
  rootRefusal: null,
  scanTruncated: false
}), 'running')

// P14: el paquete no puede escribir el manifiesto ni el backup.
assert.throws(() => planFsr4Install({
  ...probeBase,
  tree: { 'game.exe': 'game' },
  packageFiles: { ...probeBase.packageFiles, '.mt3k-fsr/manifest.json': 'hostile', '.mt3k-fsr/backup/OptiScaler.ini': 'hostile' }
}), /bad-package/)
assert.equal(assessOptiScalerArchiveEntries([
  { path: 'OptiScaler.dll', kind: 'file' },
  { path: 'OptiScaler.ini', kind: 'file' },
  { path: '../outside.dll', kind: 'file' }
]).ok, false)
assert.equal(assessOptiScalerArchiveEntries([
  { path: 'OptiScaler.dll', kind: 'link' },
  { path: 'OptiScaler.ini', kind: 'file' }
]).ok, false)
assert.equal(assessOptiScalerArchiveEntries([
  { path: 'OptiScaler.dll', kind: 'file' },
  { path: 'OptiScaler.ini', kind: 'file' },
  { path: 'OptiScaler/amd_fidelityfx_dx12.dll', kind: 'file' },
  { path: 'Licenses/GPL.txt', kind: 'file' }
]).ok, true)

// P18: install, quitar, opciones y el actualizador comparten un solo candado.
const gate = createFsr4MutationGate()
assert.equal(gate.tryAcquire('update'), true)
assert.equal(gate.tryAcquire('uninstall'), false)
assert.equal(gate.held(), 'update')
gate.release('update')
assert.equal(gate.tryAcquire('uninstall'), true)
gate.release('uninstall')

// P24: un log más viejo que la sesión no se lee. La resolución no trae inglés fijo.
assert.equal(sessionLogIsFresh(1_000, 2_000), false)
assert.equal(sessionLogIsFresh(3_000, 2_000), true)
const stale = parseOptiScalerSessionLog('OptiScaler loaded\nffxProvider_FSR4Lite_Int8 hooked\nRender Resolution: 1280x720, Display Resolution 1920x1080')
assert.equal(stale.status, 'active')
assert.equal(stale.resolution?.includes('Rendering'), false)

// El recorrido no se salta Engine ni Content. Si el tope corta, no se da por seguro.
assert.equal(walkDirectoryDecision('Engine', 1), 'descend')
assert.equal(walkDirectoryDecision('Content', 1), 'descend')
assert.equal(walkDirectoryDecision('_CommonRedist', 1), 'skip')
assert.equal(walkDirectoryDecision('Support', 1), 'skip')
assert.ok(FSR4_WALK_MAX_DEPTH >= 7)
assert.equal(assessFsr4Target({
  provider: 'steam',
  installed: true,
  exeName: 'game.exe',
  files: ['Engine/Plugins/DLSS/nvngx_dlss.dll'],
  dirs: ['Engine', 'Engine/EasyAntiCheat']
}).block, 'anti-cheat')
assert.equal(assessFsr4Target({
  provider: 'steam',
  installed: true,
  exeName: 'game.exe',
  files: ['game.exe'],
  scanTruncated: true
}).block, 'scan-incomplete')
assert.equal(assessFsr4Target({
  provider: 'local',
  installed: true,
  exeName: 'game.exe',
  files: ['.mt3k-fsr/manifest.json', 'game.exe'],
  manifestState: 'pending'
}).kind, 'broken')
assert.equal(assessFsr4Target({
  provider: 'local',
  installed: true,
  exeName: 'game.exe',
  files: ['.mt3k-fsr/manifest.json', 'game.exe'],
  manifestState: 'committed'
}).kind, 'installed')

// El reintento fallido no consume el día. Las opciones solo tocan claves nuestras.
assert.equal(shouldRefreshOptiScaler({
  enabled: true, platform: 'win32', now: 5_000, lastCheckAt: null, backoffUntil: 9_000
}), false)
assert.equal(shouldRefreshOptiScaler({
  enabled: true, platform: 'win32', now: 10_000, lastCheckAt: null, backoffUntil: 9_000
}), true)
assert.equal(OPTI_FAIL_BACKOFF_MS, 60 * 60 * 1000)
const rewritten = setIniValues('[Custom]\nKeep=yes\n[Menu]\nShowFps=auto\n', [
  { section: 'Menu', key: 'ShowFps', value: 'true' }
])
assert.match(rewritten, /Keep=yes/)
assert.match(rewritten, /ShowFps=true/)
assert.equal(acceptDownloadSize({ received: 10, contentLength: 10, expectedSize: 10, maxBytes: 100 }), true)
assert.equal(acceptDownloadSize({ received: 10, contentLength: 11, expectedSize: 11, maxBytes: 100 }), false)
assert.equal(acceptDownloadSize({ received: 10, contentLength: 10, expectedSize: 9, maxBytes: 100 }), false)
assert.equal(acceptDownloadSize({ received: 1_000, contentLength: 1_000, maxBytes: 100 }), false)

console.log('verify:fsr4-lite passed')
