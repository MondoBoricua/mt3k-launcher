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
  acceptDownloadDigest,
  applyUninstallPlan,
  assessFsr4Target,
  chooseFsr4Proxy,
  classifyFsr4Device,
  compatNoteForGame,
  compatRequiresReFramework,
  iniValue,
  isNewerOptiBuild,
  mergeOptiScalerIni,
  parseOptiScalerSessionLog,
  pickOptiScalerNightly,
  planFsr4Install,
  roundTripInstall,
  selectGameExecutable,
  shouldRefreshOptiScaler,
  validateFsrDriverFile,
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
const withRuntime = {
  ...trip.installed,
  'reframework/log.txt': 'runtime',
  're2_fw_log.txt': 'runtime-log'
}
const restored = applyUninstallPlan(withRuntime, trip.plan.manifest)
assert.deepEqual(restored, before)

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
assert.equal(active.resolution, 'Rendering 1280x720 → 1920x1080')

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

const measured = 85_684_104
assert.ok(measured > FSR4_MIN_DLL_BYTES)
assert.deepEqual(validateFsrDriverFile({
  fileName: 'amdxcffx64.dll',
  size: measured,
  header: [0x4d, 0x5a, 0x90],
  company: 'Advanced Micro Devices, Inc.'
}), { ok: true })
assert.equal(validateFsrDriverFile({
  fileName: 'amdvkffx64.dll',
  size: 72_497_568,
  header: new Uint8Array([0x4d, 0x5a]),
  company: 'AMD'
}).ok, true)
assert.equal(validateFsrDriverFile({
  fileName: 'amdxcffx64.dll',
  size: measured,
  header: [0x4d, 0x5a],
  company: 'Advanced Micro Devices, Inc.'
}).ok, true)
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

console.log('verify:fsr4-lite passed')
