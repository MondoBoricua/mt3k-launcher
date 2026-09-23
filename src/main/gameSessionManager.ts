import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { win32 as path } from 'node:path'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { BrowserWindow } from 'electron'
import {
  GAME_LAUNCH_CANCEL_WINDOW_MS,
  type GameLaunchFailureReason,
  type GameLaunchStatus,
  type GameProvider,
  type GeForceNowLibraryMatch,
  type LibraryGame,
  type LocalGameBackupResult
} from '@shared/ipc'
import { launchGame } from './gameLauncher'
import {
  GAME_PROCESS_CANDIDATE_STABILITY_MS,
  LaunchStartupTracker,
  ancestryIncludesTrackedPid,
  providerSessionTimestamps,
  provisionalHandoffGraceMs,
  selectGameTrackingMethod,
  windowsExecutableInsideDirectory,
  windowsPackageIdentityMatches
} from './gameLaunchDetectionPolicy'
import { settingsStore } from './settingsStore'
import type { GameTrackingMethod } from '@shared/gameTracking'
import { SteamGameActivityReader } from './steam/steamGameActivity'
import {
  detectLibraryGamePresences,
  type GamePresenceProcess,
  type ProviderReportedGameActivity
} from './gamePresence'
import { livingProcessRecords, processIdStillExists } from './processLiveness'
import {
  GeForceNowGameActivityReader,
  detectGeForceNowGamePresences,
  isGeForceNowGameWindow
} from './geforceNow/geforceNowGameActivity'

const WINDOWS_POWERSHELL_PATH = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

interface WindowsProcess extends GamePresenceProcess {}

interface ProcessSnapshot {
  sequence: number
  capturedAt: number
  processes: WindowsProcess[]
}

interface ProcessStreamMessage {
  Kind?: 'snapshot' | 'delta'
  Processes?: WindowsProcess | WindowsProcess[]
  Started?: WindowsProcess | WindowsProcess[]
  Stopped?: number | number[]
  Updated?: WindowsProcess | WindowsProcess[]
}

interface ScoredProcess {
  process: WindowsProcess
  pid: number
  key: string
  score: number
  visible: boolean
  trackingMethod: GameTrackingMethod
  trackingFallbackIndex: number
}

interface PendingLaunchDelay {
  token: number
  timer: ReturnType<typeof setTimeout>
  resolve: (shouldLaunch: boolean) => void
}

export interface CompletedGameSession {
  detectedAt: number
  endedAt: number
  durationSeconds: number
}

export interface CompletedGameSessionResult {
  totalPlaytimeSeconds?: number
}

export interface GameSessionCallbacks {
  beforeLocalLaunch?: (game: LibraryGame) => Promise<boolean>
  restoreLaunchProfile?: () => void
  getLibraryGames?: () => readonly LibraryGame[]
  getGeForceNowMatches?: () => readonly GeForceNowLibraryMatch[]
  onGameConfirmed?: (game: LibraryGame, detectedAt: number, source?: 'local' | 'geforce-now') => void | Promise<void>
  onSessionCompleted?: (
    game: LibraryGame,
    session: CompletedGameSession
  ) => CompletedGameSessionResult | void | Promise<CompletedGameSessionResult | void>
  onGameEnded?: (game: LibraryGame) => Promise<LocalGameBackupResult>
}

const PROCESS_SAMPLE_INTERVAL_MS = 500
const SNAPSHOT_TIMEOUT_MS = 2_000
const PROCESS_STALL_TIMEOUT_MS = 6_000
const BASELINE_TIMEOUT_MS = 3_000
const GAME_CONFIRMATION_MS = 4_000
const EARLY_SESSION_WINDOW_MS = 45_000
const EARLY_HANDOFF_GRACE_MS = 6_000
const PROCESS_EXIT_GRACE_MS = 1_200
const LAUNCH_SHIELD_TIMEOUT_MS = 10_000
const RETURN_SPLASH_MS = 520
const BACKUP_RESULT_SPLASH_MS = 1_400
const RETURN_FOCUS_GUARD_MS = 1_800
const FOCUS_GUARD_POLL_MS = 250
const ERROR_SPLASH_MS = 5_000
const PROVIDER_PRESENCE_POLL_MS = 750
const PROVIDER_PRESENCE_EXIT_GRACE_MS = 1_500
const PROVIDER_PRESENCE_STALL_TIMEOUT_MS = 2_500
const PROVIDER_LIVENESS_POLL_MS = 500
type LauncherFamily =
  | 'steam'
  | 'epic'
  | 'ea'
  | 'ubisoft'
  | 'gog'
  | 'battlenet'
  | 'rockstar'
  | '2k'
  | 'xbox'

const EXPECTED_LAUNCHER_FAMILIES: Record<GameProvider, ReadonlySet<LauncherFamily>> = {
  local: new Set<LauncherFamily>(),
  steam: new Set(['steam', 'ea', 'ubisoft', 'rockstar', '2k']),
  epic: new Set(['epic', 'ea', 'ubisoft', 'rockstar', '2k']),
  gog: new Set(['gog']),
  xbox: new Set(['xbox', 'ea', 'ubisoft']),
  playstation: new Set<LauncherFamily>(),
  retro: new Set<LauncherFamily>(),
  ea: new Set(['ea']),
  ubisoft: new Set(['ubisoft'])
}

const LAUNCHER_PROCESS_FAMILIES = new Map<string, LauncherFamily>([
  ['steam.exe', 'steam'],
  ['steamwebhelper.exe', 'steam'],
  ['gameoverlayui.exe', 'steam'],
  ['epicgameslauncher.exe', 'epic'],
  ['epicwebhelper.exe', 'epic'],
  ['eadesktop.exe', 'ea'],
  ['ealauncher.exe', 'ea'],
  ['eabackgroundservice.exe', 'ea'],
  ['origin.exe', 'ea'],
  ['originwebhelperservice.exe', 'ea'],
  ['ubisoftconnect.exe', 'ubisoft'],
  ['upc.exe', 'ubisoft'],
  ['uplay.exe', 'ubisoft'],
  ['uplaywebcore.exe', 'ubisoft'],
  ['galaxyclient.exe', 'gog'],
  ['galaxyclientservice.exe', 'gog'],
  ['galaxycommunication.exe', 'gog'],
  ['battle.net.exe', 'battlenet'],
  ['agent.exe', 'battlenet'],
  ['rockstar-games-launcher.exe', 'rockstar'],
  ['launcherpatcher.exe', 'rockstar'],
  ['socialclubhelper.exe', 'rockstar'],
  ['2klauncher.exe', '2k'],
  ['xboxpcapp.exe', 'xbox'],
  ['gamingapp.exe', 'xbox']
])

const LAUNCHER_ROOT_PROCESSES = new Set([
  'steam.exe',
  'epicgameslauncher.exe',
  'eadesktop.exe',
  'ealauncher.exe',
  'origin.exe',
  'ubisoftconnect.exe',
  'upc.exe',
  'uplay.exe',
  'galaxyclient.exe',
  'battle.net.exe',
  'rockstar-games-launcher.exe',
  '2klauncher.exe',
  'xboxpcapp.exe',
  'gamingapp.exe'
])

const SYSTEM_PROCESSES = new Set([
  'applicationframehost.exe',
  'conhost.exe',
  'csrss.exe',
  'dwm.exe',
  'explorer.exe',
  'fontdrvhost.exe',
  'lsass.exe',
  'powershell.exe',
  'pwsh.exe',
  'registry',
  'runtimebroker.exe',
  'searchhost.exe',
  'services.exe',
  'shellexperiencehost.exe',
  'sihost.exe',
  'smss.exe',
  'spoolsv.exe',
  'startmenuexperiencehost.exe',
  'svchost.exe',
  'system',
  'systemsettings.exe',
  'taskhostw.exe',
  'textinputhost.exe',
  'userinit.exe',
  'wininit.exe',
  'winlogon.exe',
  'wmiprvse.exe'
])

const NON_GAME_PROCESS =
  /(activationui|anti.?cheat|battleye|bootstrap|browser|cef|crash|dedicated|dxsetup|gamelaunchhelper|helper|installer|launcher|link2ea|overlay|prereq|protectedgame|redist|report|server|service|setup|startprotectedgame|telemetry|tray|unins|updat|vc_redist|watchdog|webhelper)/i

const GAME_NAME_STOP_WORDS = new Set([
  'and',
  'complete',
  'definitive',
  'deluxe',
  'edition',
  'for',
  'game',
  'gold',
  'remastered',
  'the',
  'ultimate',
  'with'
])

const PROCESS_SNAPSHOT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$metadata = @{}
$windowState = @{}

function New-FallbackMetadata($entry) {
  $fallbackName = if ([string]$entry.ProcessName -match '\.exe$') { [string]$entry.ProcessName } else { "$($entry.ProcessName).exe" }
  [pscustomobject]@{
    ParentProcessId = 0
    Name = $fallbackName
    ExecutablePath = if ($entry.Path) { [string]$entry.Path } else { '' }
    CommandLine = ''
  }
}

function New-ProcessRow($entry, $details) {
  $fallbackName = if ([string]$entry.ProcessName -match '\.exe$') { [string]$entry.ProcessName } else { "$($entry.ProcessName).exe" }
  $startedAt = 0
  try { $startedAt = [DateTimeOffset]::new([datetime]$entry.StartTime).ToUnixTimeMilliseconds() } catch {}
  [pscustomobject]@{
    ProcessId = [int]$entry.Id
    ParentProcessId = if ($null -ne $details) { [int]$details.ParentProcessId } else { 0 }
    Name = if ($null -ne $details -and $details.Name) { [string]$details.Name } else { $fallbackName }
    ExecutablePath = if ($entry.Path) { [string]$entry.Path } elseif ($null -ne $details) { [string]$details.ExecutablePath } else { '' }
    CommandLine = if ($null -ne $details) { [string]$details.CommandLine } else { '' }
    StartedAt = [int64]$startedAt
    MainWindowHandle = [int64]$entry.MainWindowHandle
    MainWindowTitle = [string]$entry.MainWindowTitle
  }
}

$live = @(Get-Process)
foreach ($entry in $live) {
  $metadata[[int]$entry.Id] = New-FallbackMetadata $entry
}
$initialRows = @($live | ForEach-Object {
  $windowState[[int]$_.Id] = "$( [int64]$_.MainWindowHandle ):$([string]$_.MainWindowTitle)"
  New-ProcessRow $_ $metadata[[int]$_.Id]
})
[Console]::Out.WriteLine((ConvertTo-Json -InputObject ([pscustomobject]@{
  Kind = 'snapshot'
  Processes = [object[]]$initialRows
}) -Compress -Depth 3))
[Console]::Out.Flush()

# A slow or damaged WMI provider must never delay launch dispatch or lifetime
# monitoring. New processes receive targeted CIM metadata in the loop; the
# baseline already has PID, executable path and window state from Get-Process.

while ($true) {
  Start-Sleep -Milliseconds ${PROCESS_SAMPLE_INTERVAL_MS}
  $live = @(Get-Process)
  $liveIds = @{}
  foreach ($entry in $live) { $liveIds[[int]$entry.Id] = $true }

  $stopped = @($metadata.Keys | Where-Object { -not $liveIds.ContainsKey([int]$_) } | ForEach-Object { [int]$_ })
  foreach ($stoppedId in $stopped) {
    $metadata.Remove($stoppedId)
    $windowState.Remove($stoppedId)
  }

  $newEntries = @($live | Where-Object { -not $metadata.ContainsKey([int]$_.Id) })
  $newIds = @($newEntries | ForEach-Object { [int]$_.Id })
  if ($newIds.Count -gt 0) {
    $filter = ($newIds | ForEach-Object { "ProcessId = $_" }) -join ' OR '
    foreach ($cim in @(Get-CimInstance Win32_Process -Filter $filter)) {
      $metadata[[int]$cim.ProcessId] = [pscustomobject]@{
        ParentProcessId = [int]$cim.ParentProcessId
        Name = [string]$cim.Name
        ExecutablePath = [string]$cim.ExecutablePath
        CommandLine = [string]$cim.CommandLine
      }
    }
    foreach ($entry in $newEntries) {
      if (-not $metadata.ContainsKey([int]$entry.Id)) {
        $metadata[[int]$entry.Id] = New-FallbackMetadata $entry
      }
    }
  }

  $newLookup = @{}
  $started = @($newEntries | ForEach-Object {
    $newLookup[[int]$_.Id] = $true
    $windowState[[int]$_.Id] = "$( [int64]$_.MainWindowHandle ):$([string]$_.MainWindowTitle)"
    New-ProcessRow $_ $metadata[[int]$_.Id]
  })

  $updated = @($live | Where-Object { -not $newLookup.ContainsKey([int]$_.Id) } | ForEach-Object {
    $windowIdentity = "$( [int64]$_.MainWindowHandle ):$([string]$_.MainWindowTitle)"
    $details = $metadata[[int]$_.Id]
    $metadataChanged = $false
    if ($null -ne $details -and -not $details.ExecutablePath -and $_.Path) {
      $details.ExecutablePath = [string]$_.Path
      $metadataChanged = $true
    }
    if ($windowState[[int]$_.Id] -ne $windowIdentity -or $metadataChanged) {
      $windowState[[int]$_.Id] = $windowIdentity
      [pscustomobject]@{
        ProcessId = [int]$_.Id
        Name = if ($null -ne $details) { [string]$details.Name } else { '' }
        ExecutablePath = if ($null -ne $details) { [string]$details.ExecutablePath } else { '' }
        MainWindowHandle = [int64]$_.MainWindowHandle
        MainWindowTitle = [string]$_.MainWindowTitle
      }
    }
  })

  [Console]::Out.WriteLine((ConvertTo-Json -InputObject ([pscustomobject]@{
    Kind = 'delta'
    Started = [object[]]$started
    Stopped = [int[]]$stopped
    Updated = [object[]]$updated
  }) -Compress -Depth 3))
  [Console]::Out.Flush()
}`

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function processId(candidate: WindowsProcess): number {
  return candidate.ProcessId ?? 0
}

function processName(candidate: WindowsProcess): string {
  return (candidate.Name ?? '').trim().toLowerCase()
}

function normalizedPath(value?: string): string {
  return (value ?? '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function processKey(candidate: WindowsProcess): string {
  return normalizedPath(candidate.ExecutablePath) || processName(candidate)
}

function executableHintName(value?: string): string {
  const name = normalizedPath(value).split('\\').pop() ?? ''
  return name.length <= 260 && /^[a-z0-9_.+() -]+\.exe$/i.test(name) ? name : ''
}

function expectedExecutablePath(game: LibraryGame): string {
  const importedExecutable = game.local?.executablePath ?? game.retro?.emulatorPath
  if (importedExecutable) return normalizedPath(importedExecutable)

  const providerExecutable = game.metadata.launchExecutable?.trim()
  if (!providerExecutable) return ''
  if (path.isAbsolute(providerExecutable)) return normalizedPath(providerExecutable)
  return game.installDir
    ? normalizedPath(path.resolve(game.installDir, providerExecutable))
    : ''
}

function hasVisibleWindow(candidate: WindowsProcess): boolean {
  return Boolean(candidate.MainWindowHandle)
}

function launcherFamily(candidate: WindowsProcess): LauncherFamily | undefined {
  const knownFamily = LAUNCHER_PROCESS_FAMILIES.get(processName(candidate))
  if (knownFamily) return knownFamily
  const executable = normalizedPath(candidate.ExecutablePath)
  if (executable.includes('\\rockstar games\\launcher\\')) return 'rockstar'
  if (executable.includes('\\2klauncher\\') || executable.includes('\\2k launcher\\')) return '2k'
  return undefined
}

function isLauncherRootProcess(candidate: WindowsProcess): boolean {
  const name = processName(candidate)
  if (LAUNCHER_ROOT_PROCESSES.has(name)) return true
  const family = launcherFamily(candidate)
  return Boolean(family && (name === 'launcher.exe' || name === 'launcherpatcher.exe'))
}

function baselineInstance(
  candidate: WindowsProcess,
  baselineByPid: ReadonlyMap<number, WindowsProcess>
): boolean {
  const baseline = baselineByPid.get(processId(candidate))
  if (!baseline) return false
  const baselineStartedAt = baseline.StartedAt ?? 0
  const candidateStartedAt = candidate.StartedAt ?? 0
  const sameInstance =
    baselineStartedAt <= 0 || candidateStartedAt <= 0 || baselineStartedAt === candidateStartedAt
  return (
    sameInstance &&
    processName(baseline) === processName(candidate) &&
    processKey(baseline) === processKey(candidate)
  )
}

function ancestorMatches(
  candidate: WindowsProcess,
  processesByPid: ReadonlyMap<number, WindowsProcess>,
  predicate: (ancestor: WindowsProcess) => boolean
): boolean {
  let parentId = candidate.ParentProcessId ?? 0
  const visited = new Set<number>()
  for (let depth = 0; depth < 14 && parentId > 0 && !visited.has(parentId); depth += 1) {
    visited.add(parentId)
    const parent = processesByPid.get(parentId)
    if (!parent) return false
    if (predicate(parent)) return true
    parentId = parent.ParentProcessId ?? 0
  }
  return false
}

function ancestorPidMatches(
  candidate: WindowsProcess,
  processesByPid: ReadonlyMap<number, WindowsProcess>,
  processIds: ReadonlySet<number>
): boolean {
  return ancestryIncludesTrackedPid(
    candidate.ParentProcessId,
    processIds,
    (pid) => processesByPid.get(pid)?.ParentProcessId
  )
}

function hasExpectedLauncherAncestor(
  candidate: WindowsProcess,
  provider: GameProvider,
  processesByPid: ReadonlyMap<number, WindowsProcess>
): boolean {
  const expectedFamilies = EXPECTED_LAUNCHER_FAMILIES[provider]
  if (expectedFamilies.size === 0) return false
  return ancestorMatches(candidate, processesByPid, (ancestor) => {
    const family = launcherFamily(ancestor)
    return Boolean(family && expectedFamilies.has(family))
  })
}

function gameNameTokens(game: LibraryGame): string[] {
  return game.name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GAME_NAME_STOP_WORDS.has(token))
}

function scoreGameProcess(
  candidate: WindowsProcess,
  game: LibraryGame,
  baselineByPid: ReadonlyMap<number, WindowsProcess>,
  processesByPid: ReadonlyMap<number, WindowsProcess>,
  trackedPids: ReadonlySet<number>,
  directlySpawnedGamePids: ReadonlySet<number>,
  providerReportedGamePids: ReadonlySet<number>
): ScoredProcess | null {
  const pid = processId(candidate)
  const name = processName(candidate)
  const executable = normalizedPath(candidate.ExecutablePath)
  const importedExecutable = game.local?.executablePath ?? game.retro?.emulatorPath
  const expectedExecutable = expectedExecutablePath(game)
  const visible = hasVisibleWindow(candidate)
  const providerExecutableHint = executableHintName(game.metadata.launchExecutable)
  const importedExecutableHint = executableHintName(importedExecutable)
  const executableHintMatches =
    (Boolean(providerExecutableHint) && name === providerExecutableHint) ||
    (Boolean(importedExecutableHint) && name === importedExecutableHint)
  const directlySpawnedGame = directlySpawnedGamePids.has(pid)
  const providerReportedGame = providerReportedGamePids.has(pid)
  const exactExecutable = Boolean(executable && expectedExecutable && executable === expectedExecutable)
  const insideInstallDir = windowsExecutableInsideDirectory(
    candidate.ExecutablePath,
    game.installDir
  )
  const commandLine = (candidate.CommandLine ?? '').toLowerCase()
  const packageFamilyMatches = windowsPackageIdentityMatches(
    game.metadata.launchUri,
    executable,
    commandLine,
    game.metadata.providerPackageFamilyName
  )
  const reusableRemotePlayProcess =
    game.provider === 'playstation' && executableHintMatches && visible
  const reusableBaselineProcess =
    exactExecutable ||
    packageFamilyMatches ||
    (executableHintMatches && insideInstallDir) ||
    reusableRemotePlayProcess
  if (
    pid <= 0 ||
    !name.endsWith('.exe') ||
    (baselineInstance(candidate, baselineByPid) && !reusableBaselineProcess) ||
    launcherFamily(candidate) ||
    SYSTEM_PROCESSES.has(name) ||
    (NON_GAME_PROCESS.test(name) &&
      !directlySpawnedGame &&
      !providerReportedGame &&
      !exactExecutable &&
      !executableHintMatches)
  ) {
    return null
  }

  const fromLauncher = hasExpectedLauncherAncestor(candidate, game.provider, processesByPid)
  const fromTrackedGame = ancestorPidMatches(candidate, processesByPid, trackedPids)
  const nameMatches = gameNameTokens(game).some((token) => name.includes(token))
  const providerIds = [game.providerGameId, game.appId ? String(game.appId) : '']
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length >= 4)
  const idMatches = providerIds.some(
    (value) => commandLine.includes(value) || executable.includes(value)
  )
  const windowsAppsProcess = executable.includes('\\windowsapps\\')

  const selectedTracking = selectGameTrackingMethod(game.provider, {
    providerReportedGame,
    directlySpawnedGame,
    exactExecutable,
    insideInstallDir,
    packageFamilyMatches,
    idMatches,
    executableHintMatches,
    fromTrackedGame,
    fromLauncher,
    visible,
    nameMatches,
    windowsAppsProcess
  })
  if (!selectedTracking) return null

  // Provider order dominates presentation hints. A Steam process inside the
  // game's install folder must beat a coincidentally similar visible process.
  let score = 10_000 - selectedTracking.fallbackIndex * 1_000
  if (providerReportedGame) score += 500
  if (directlySpawnedGame) score += 400
  if (exactExecutable) score += 320
  if (insideInstallDir) score += 140
  if (packageFamilyMatches) score += 260
  if (visible) score += 85
  if (fromLauncher) score += 70
  if (fromTrackedGame) score += 130
  if (nameMatches) score += 35
  if (idMatches) score += 110
  if (executableHintMatches) score += 220
  if (game.provider === 'xbox' && visible) score += 25
  if (windowsAppsProcess) score += 20

  return {
    process: candidate,
    pid,
    key: processKey(candidate),
    score,
    visible,
    trackingMethod: selectedTracking.method,
    trackingFallbackIndex: selectedTracking.fallbackIndex
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

class WindowsProcessSampler extends EventEmitter {
  private child: ChildProcess | null = null
  private reader: ReadlineInterface | null = null
  private processesByPid = new Map<number, WindowsProcess>()
  private latest: ProcessSnapshot = { sequence: 0, capturedAt: 0, processes: [] }
  private failure: Error | null = null
  private stopping = false

  start(): void {
    if (process.platform !== 'win32' || this.child) return
    this.failure = null
    this.stopping = false
    const child = spawn(
      WINDOWS_POWERSHELL_PATH,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodedPowerShell(PROCESS_SNAPSHOT_SCRIPT)
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    this.child = child
    const fail = (error: Error): void => {
      if (this.stopping || this.failure) return
      this.failure = error
      this.reader?.close()
      this.reader = null
      this.child = null
      this.emit('failed', error)
    }
    child.once('error', (error) => fail(new Error(`Process monitor failed: ${error.message}`)))
    child.once('exit', (code, signal) => {
      if (!this.stopping) {
        fail(new Error(`Process monitor stopped (${code ?? signal ?? 'unknown'})`))
      }
    })
    if (!child.stdout) {
      fail(new Error('Process monitor has no output stream'))
      child.kill()
      return
    }
    const reader = createInterface({ input: child.stdout })
    this.reader = reader
    reader.on('line', (line) => {
      if (!line.trim()) return
      try {
        const message = JSON.parse(line) as ProcessStreamMessage
        if (message.Kind === 'snapshot') {
          this.processesByPid = new Map(
            asArray(message.Processes)
              .filter((candidate) => processId(candidate) > 0)
              .map((candidate) => [processId(candidate), candidate] as const)
          )
        } else if (message.Kind === 'delta') {
          for (const pid of asArray(message.Stopped)) this.processesByPid.delete(pid)
          for (const candidate of asArray(message.Started)) {
            if (processId(candidate) > 0) this.processesByPid.set(processId(candidate), candidate)
          }
          for (const update of asArray(message.Updated)) {
            const pid = processId(update)
            const current = this.processesByPid.get(pid)
            if (current) this.processesByPid.set(pid, { ...current, ...update })
          }
        } else {
          return
        }
        this.latest = {
          sequence: this.latest.sequence + 1,
          capturedAt: Date.now(),
          processes: [...this.processesByPid.values()]
        }
        this.emit('snapshot', this.latest)
      } catch {
        // A single malformed snapshot is ignored; the persistent sampler keeps running.
      }
    })
  }

  getLatest(): ProcessSnapshot {
    return this.latest
  }

  waitForNext(afterSequence: number, timeoutMs: number): Promise<ProcessSnapshot> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.latest.sequence > afterSequence) return Promise.resolve(this.latest)
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        this.removeListener('snapshot', onSnapshot)
        this.removeListener('failed', onFailure)
      }
      const finish = (snapshot: ProcessSnapshot): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(snapshot)
      }
      const onSnapshot = (snapshot: ProcessSnapshot): void => {
        if (snapshot.sequence > afterSequence) finish(snapshot)
      }
      const onFailure = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => finish(this.latest), timeoutMs)
      this.on('snapshot', onSnapshot)
      this.once('failed', onFailure)
    })
  }

  stop(): void {
    this.stopping = true
    this.emit('failed', new Error('Process monitor stopped'))
    this.reader?.close()
    this.reader = null
    this.child?.kill()
    this.child = null
    this.failure = null
    this.removeAllListeners()
  }
}

function closeLauncherProcesses(
  processes: WindowsProcess[],
  ownedFamilies: ReadonlySet<LauncherFamily>
): Promise<void> {
  if (process.platform !== 'win32' || ownedFamilies.size === 0) return Promise.resolve()
  const processIds = processes
    .filter(
      (candidate) =>
        isLauncherRootProcess(candidate) &&
        ownedFamilies.has(launcherFamily(candidate) as LauncherFamily)
    )
    .map(processId)
    .filter((pid) => pid > 0 && pid !== process.pid)
  if (processIds.length === 0) return Promise.resolve()

  const ids = processIds.join(',')
  const script = `
$ids = @(${ids})
foreach ($id in $ids) {
  $client = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -ne $client -and $client.MainWindowHandle -ne 0) {
    $null = $client.CloseMainWindow()
  }
}
Start-Sleep -Milliseconds 1200
foreach ($id in $ids) {
  if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}`

  return new Promise((resolve) => {
    execFile(
      WINDOWS_POWERSHELL_PATH,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
      { windowsHide: true, encoding: 'utf8' },
      () => resolve()
    )
  })
}

function focusExternalProcess(pid: number, ensureFullscreenWithHotkey = false): void {
  if (process.platform !== 'win32' || pid <= 0) return
  const fullscreenFallback = ensureFullscreenWithHotkey
    ? `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OrbitExternalFullscreen {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {
    public int Left; public int Top; public int Right; public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO {
    public int Size; public RECT Monitor; public RECT Work; public int Flags;
  }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, int flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

  public static bool IsFullscreen(IntPtr window) {
    RECT rect;
    if (window == IntPtr.Zero || !GetWindowRect(window, out rect)) return false;
    IntPtr monitor = MonitorFromWindow(window, 2);
    MONITORINFO info = new MONITORINFO();
    info.Size = Marshal.SizeOf(info);
    if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return false;
    return Math.Abs(rect.Left - info.Monitor.Left) <= 2 &&
      Math.Abs(rect.Top - info.Monitor.Top) <= 2 &&
      Math.Abs(rect.Right - info.Monitor.Right) <= 2 &&
      Math.Abs(rect.Bottom - info.Monitor.Bottom) <= 2;
  }
}
'@
Start-Sleep -Milliseconds 250
$target.Refresh()
if ($target.MainWindowHandle -ne 0 -and -not [OrbitExternalFullscreen]::IsFullscreen($target.MainWindowHandle)) {
  $shell.SendKeys('%{ENTER}')
}`
    : ''
  const script = `
$target = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($null -ne $target) {
  $shell = New-Object -ComObject WScript.Shell
  $null = $shell.AppActivate($target.Id)
  ${fullscreenFallback}
}`
  execFile(
    WINDOWS_POWERSHELL_PATH,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
    { windowsHide: true, encoding: 'utf8' },
    () => undefined
  )
}

function nativeWindowHandle(window: BrowserWindow): bigint | null {
  if (process.platform !== 'win32' || window.isDestroyed()) return null
  const handle = window.getNativeWindowHandle()
  if (handle.length >= 8) return handle.readBigUInt64LE(0)
  if (handle.length >= 4) return BigInt(handle.readUInt32LE(0))
  return null
}

export function activateOrbitWindow(window: BrowserWindow): Promise<void> {
  const handle = nativeWindowHandle(window)
  if (handle === null || handle <= 0n) return Promise.resolve()

  // BrowserWindow.focus() alone is best-effort on Windows. In particular,
  // Steam can remain the foreground owner after its game child exits. Attach
  // this helper's input queue to both windows before activating ORBIT so the
  // focus hand-off is accepted instead of merely flashing the taskbar entry.
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OrbitWindowActivation {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hWnd);

  public static bool Activate(IntPtr target) {
    IntPtr foreground = GetForegroundWindow();
    uint currentThread = GetCurrentThreadId();
    uint foregroundThread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
    bool foregroundAttached = foregroundThread != 0 && foregroundThread != currentThread &&
      AttachThreadInput(currentThread, foregroundThread, true);
    bool targetAttached = targetThread != 0 && targetThread != currentThread &&
      AttachThreadInput(currentThread, targetThread, true);

    try {
      ShowWindowAsync(target, 9);
      BringWindowToTop(target);
      SetForegroundWindow(target);
      SetFocus(target);
      return GetForegroundWindow() == target;
    } finally {
      if (targetAttached) AttachThreadInput(currentThread, targetThread, false);
      if (foregroundAttached) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }
}
'@

$target = [IntPtr]::new([Int64]${handle.toString()})
for ($attempt = 0; $attempt -lt 3; $attempt++) {
  if ([OrbitWindowActivation]::Activate($target)) { break }
  Start-Sleep -Milliseconds 120
}
`

  return new Promise((resolve) => {
    execFile(
      WINDOWS_POWERSHELL_PATH,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
      { windowsHide: true, encoding: 'utf8', timeout: 2_000 },
      () => resolve()
    )
  })
}

/**
 * Provider-neutral session detection for store and third-party hand-offs.
 * A snapshot taken before launch prevents existing clients from being mistaken
 * for the game. The monitor then combines install paths, process ancestry,
 * provider IDs and visible top-level windows, while launcher/helper processes
 * are explicitly excluded from the game lifetime.
 */
export class GameSessionManager extends EventEmitter {
  private status: GameLaunchStatus = { phase: 'idle' }
  private activeToken = 0
  private sampler: WindowsProcessSampler | null = null
  private launchTargetRevealed = false
  private pendingLaunchDelay: PendingLaunchDelay | null = null
  private activeGame: LibraryGame | null = null
  private readonly steamActivityReader = new SteamGameActivityReader()
  private readonly geForceNowActivityReader = new GeForceNowGameActivityReader()
  private geForceNowLaunchIntent: {
    game: LibraryGame
    match: GeForceNowLibraryMatch
    expiresAt: number
  } | undefined
  private geForceNowSessionIdentity: {
    game: LibraryGame
    match: GeForceNowLibraryMatch
  } | undefined
  private providerPresenceTimer: ReturnType<typeof setTimeout> | null = null
  private providerLivenessTimer: ReturnType<typeof setInterval> | null = null
  private providerPresenceSampler: WindowsProcessSampler | null = null
  private providerPresenceDisposed = false
  private providerAttachedGameId: string | undefined
  private providerPresenceMissingSince: number | undefined
  private providerPresenceCandidateKey: string | undefined
  private providerPresenceCandidateSince: number | undefined
  private readonly providerAttachedProcessIds = new Set<number>()
  private providerReturnInFlight = false
  private readonly suppressedProviderGameIds = new Set<string>()

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly callbacks: GameSessionCallbacks = {}
  ) {
    super()
    if (callbacks.getLibraryGames) {
      this.ensureProviderPresenceSampler()
      this.scheduleProviderPresencePoll()
      this.providerLivenessTimer = setInterval(
        () => this.checkProviderAttachedProcessLiveness(),
        PROVIDER_LIVENESS_POLL_MS
      )
      this.providerLivenessTimer.unref()
    }
  }

  getStatus(): GameLaunchStatus {
    return { ...this.status }
  }

  expectGeForceNowGame(game: LibraryGame, match: GeForceNowLibraryMatch): () => void {
    if (this.providerPresenceDisposed) throw new Error('Game session manager is closed')
    const cloudHandoff = this.status.phase === 'launching' &&
      this.status.trackingMethod === 'geforce-now-window' &&
      this.status.gameId === game.id && !this.status.cancelableUntil
    if (this.status.phase !== 'idle' && !cloudHandoff) {
      throw new Error('A game session is already active')
    }
    const intent = { game, match, expiresAt: Date.now() + 30 * 60_000 }
    this.geForceNowLaunchIntent = intent
    return () => {
      if (this.geForceNowLaunchIntent === intent) this.geForceNowLaunchIntent = undefined
    }
  }

  async startGeForceNow(game: LibraryGame, launch: () => Promise<void>): Promise<void> {
    if (this.status.phase !== 'idle') throw new Error('A game session is already active')
    const token = ++this.activeToken
    const requestedAt = Date.now()
    const cancelableUntil = requestedAt + GAME_LAUNCH_CANCEL_WINDOW_MS
    this.activeGame = game
    this.launchTargetRevealed = false
    this.update({
      phase: 'launching', gameId: game.id, gameName: game.name, provider: game.provider,
      trackingMethod: 'geforce-now-window', requestedAt, cancelableUntil
    })
    this.maintainLaunchShield(token)
    const shouldLaunch = await this.waitForLaunchWindow(token, cancelableUntil)
    if (!shouldLaunch || token !== this.activeToken) return
    this.update({ ...this.status, startedAt: Date.now(), cancelableUntil: undefined })
    try {
      await launch()
    } catch (error) {
      await this.fail(token, error instanceof Error ? error.message : 'Launch failed', 'launch-rejected')
      return
    }
    if (token !== this.activeToken) return
    this.releaseLaunchShield(false)
    // NVIDIA handles its login/queue. Only a confirmed stream becomes a played
    // session; the existing provider monitor owns running, return and history.
    this.update({ phase: 'idle' })
    this.scheduleProviderPresencePoll(0)
  }

  revealLauncher(): void {
    if (
      (this.status.phase !== 'launching' && this.status.phase !== 'running') ||
      this.status.cancelableUntil
    ) {
      return
    }
    this.launchTargetRevealed = true
    this.releaseLaunchShield(true)
  }

  cancelPendingLaunch(): boolean {
    const pending = this.pendingLaunchDelay
    const cancelableUntil = this.status.cancelableUntil
    if (
      !pending ||
      pending.token !== this.activeToken ||
      this.status.phase !== 'launching' ||
      !cancelableUntil ||
      Date.now() >= cancelableUntil
    ) {
      return false
    }

    const token = pending.token
    this.activeToken++
    this.settlePendingLaunchDelay(token, false)
    this.sampler?.stop()
    this.sampler = null
    this.releaseLaunchShield(false)
    this.update({ phase: 'idle' })
    return true
  }

  async stopTracking(): Promise<boolean> {
    const status = this.getStatus()
    const game = this.activeGame
    if (
      status.phase !== 'running' ||
      !game ||
      !status.startedAt ||
      !status.detectedAt
    ) {
      return false
    }

    // Invalidate the monitor before its next process snapshot. This stops only
    // ORBIT's bookkeeping; the game and its launcher remain untouched.
    const token = ++this.activeToken
    this.suppressedProviderGameIds.add(game.id)
    this.sampler?.stop()
    this.sampler = null
    this.releaseLaunchShield(false)

    const endedAt = Date.now()
    const completedSession = {
      detectedAt: status.detectedAt,
      endedAt,
      durationSeconds: Math.max(1, Math.round((endedAt - status.detectedAt) / 1_000))
    }
    this.update({
      phase: 'returning',
      gameId: game.id,
      gameName: game.name,
      provider: game.provider,
      startedAt: status.startedAt,
      detectedAt: status.detectedAt,
      endedAt,
      sessionDurationSeconds: completedSession.durationSeconds,
      trackingMethod: status.trackingMethod,
      trackingFallbackIndex: status.trackingFallbackIndex,
      returnTask: 'tracking-stopped'
    })
    await this.focusOrbit(token)
    try {
      const result = await this.callbacks.onSessionCompleted?.(game, completedSession)
      if (token === this.activeToken) {
        this.update({
          ...this.status,
          sessionDurationSeconds: completedSession.durationSeconds,
          totalPlaytimeSeconds: result?.totalPlaytimeSeconds
        })
      }
    } catch {
      // The manual escape hatch must still release the UI if persistence fails.
    }

    await wait(RETURN_SPLASH_MS)
    if (token === this.activeToken) {
      this.update({ phase: 'idle' })
      void this.finishReturnFocus(token)
    }
    return true
  }

  async start(game: LibraryGame): Promise<void> {
    if (this.status.phase !== 'idle') throw new Error('A game session is already active')

    const token = ++this.activeToken
    this.activeGame = game
    const requestedAt = Date.now()
    const cancelableUntil = requestedAt + GAME_LAUNCH_CANCEL_WINDOW_MS
    this.launchTargetRevealed = false
    this.update({
      phase: 'launching',
      gameId: game.id,
      gameName: game.name,
      provider: game.provider,
      requestedAt,
      cancelableUntil
    })
    this.maintainLaunchShield(token)

    const sampler = this.takeProviderPresenceSampler() ?? new WindowsProcessSampler()
    this.sampler = sampler
    let baseline: ProcessSnapshot | undefined
    let monitorFailureMessage = 'Game process monitor did not provide an initial snapshot'
    let baselineAttempt: Promise<{ snapshot?: ProcessSnapshot; error?: unknown }>
    try {
      sampler.start()
      baselineAttempt = sampler
        .waitForNext(0, BASELINE_TIMEOUT_MS)
        .then((snapshot) => ({ snapshot }), (error: unknown) => ({ error }))
    } catch (error) {
      baselineAttempt = Promise.resolve({ error })
    }

    const [baselineResult, shouldLaunch] = await Promise.all([
      baselineAttempt,
      this.waitForLaunchWindow(token, cancelableUntil)
    ])
    if (!shouldLaunch || token !== this.activeToken) return
    if (baselineResult.snapshot) {
      const latestBaseline = sampler.getLatest()
      const candidateBaseline =
        latestBaseline.sequence > baselineResult.snapshot.sequence
          ? latestBaseline
          : baselineResult.snapshot
      if (candidateBaseline.sequence > 0) baseline = candidateBaseline
    }
    if (!baseline) {
      if (baselineResult.error instanceof Error) {
        monitorFailureMessage = baselineResult.error.message
      }
      // Process tracking improves automatic focus return and playtime, but it
      // must never be a prerequisite for dispatching a game. This also keeps
      // launches working when PowerShell/WMI is restricted by local policy.
      sampler.stop()
      if (this.sampler === sampler) this.sampler = null
    }

    if (token !== this.activeToken) return
    const startedAt = Date.now()
    this.update({
      phase: 'launching',
      gameId: game.id,
      gameName: game.name,
      provider: game.provider,
      requestedAt,
      startedAt
    })

    const directlySpawnedGamePids = new Set<number>()
    let ensureFullscreenWithHotkey = false
    try {
      if (token !== this.activeToken) return
      const profileReady = (await this.callbacks.beforeLocalLaunch?.(game)) ?? true
      if (token !== this.activeToken) return
      if (!profileReady) {
        sampler.stop()
        if (this.sampler === sampler) this.sampler = null
        this.releaseLaunchShield(false)
        this.update({ phase: 'idle' })
        return
      }
      const receipt = await launchGame(game)
      if (receipt.spawnedGamePid) directlySpawnedGamePids.add(receipt.spawnedGamePid)
      ensureFullscreenWithHotkey = receipt.ensureFullscreenWithHotkey === true
    } catch (error) {
      sampler.stop()
      if (this.sampler === sampler) this.sampler = null
      await this.fail(
        token,
        error instanceof Error ? error.message : 'Launch failed',
        'launch-rejected'
      )
      return
    }

    if (!baseline) {
      void this.fail(token, monitorFailureMessage, 'monitor-unavailable')
      return
    }

    // The provider-neutral launch shield keeps this in-app splash in front while
    // Steam/Epic/Xbox/EA/Ubisoft hand off. The monitor releases it only for the
    // detected game's own visible process (or the explicit timeout/Y fallback).
    void this.monitor(
      token,
      game,
      startedAt,
      sampler,
      baseline,
      directlySpawnedGamePids,
      ensureFullscreenWithHotkey
    )
  }

  private async monitor(
    token: number,
    game: LibraryGame,
    startedAt: number,
    sampler: WindowsProcessSampler,
    baseline: ProcessSnapshot,
    directlySpawnedGamePids: Set<number>,
    ensureFullscreenWithHotkey: boolean
  ): Promise<void> {
    const baselineByPid = new Map(
      baseline.processes.map((candidate) => [processId(candidate), candidate] as const)
    )
    const baselineLauncherFamilies = new Set<LauncherFamily>(
      baseline.processes
        .filter(isLauncherRootProcess)
        .map(launcherFamily)
        .filter((family): family is LauncherFamily => Boolean(family))
    )
    const ownedLauncherFamilies = new Set<LauncherFamily>()
    const trackedPids = new Set<number>()
    const providerReportedGamePids = new Set<number>()
    const trackedProcessKeysByPid = new Map<number, string>()
    const primaryProcessKeys = new Set<string>()
    const candidateSeenAt = new Map<string, number>()
    const startupTracker = new LaunchStartupTracker(startedAt, game.provider)
    if (directlySpawnedGamePids.size > 0) startupTracker.noteCandidateSeen()
    const observedDirectGamePids = new Set<number>()
    let sequence = baseline.sequence
    let lastFreshSnapshotAt = Date.now()
    let detectedAt: number | undefined
    let primaryStableSince: number | undefined
    let activeTrackingMethod: GameTrackingMethod | undefined
    let activeTrackingFallbackIndex: number | undefined
    let sessionConfirmed = false
    let gameFocusHandedOff = false
    let missingSince: number | undefined
    let lastProcesses = baseline.processes

    try {
      while (token === this.activeToken) {
        const snapshot = await sampler.waitForNext(sequence, SNAPSHOT_TIMEOUT_MS)
        const now = Date.now()

        if (!gameFocusHandedOff && !this.launchTargetRevealed) {
          if (now - startedAt < LAUNCH_SHIELD_TIMEOUT_MS) this.maintainLaunchShield(token)
          else this.revealLauncher()
        }
        if (snapshot.sequence <= sequence) {
          if (now - lastFreshSnapshotAt >= PROCESS_STALL_TIMEOUT_MS) {
            await this.fail(
              token,
              'Game process monitor stopped responding',
              'monitor-unavailable'
            )
            return
          }
          continue
        }
        sequence = snapshot.sequence
        lastFreshSnapshotAt = now
        const previousProcesses = lastProcesses
        lastProcesses = snapshot.processes
        const processesByPid = new Map(
          lastProcesses.map((candidate) => [processId(candidate), candidate] as const)
        )
        const ancestryProcessesByPid = new Map(
          previousProcesses.map((candidate) => [processId(candidate), candidate] as const)
        )
        for (const [pid, process] of processesByPid) ancestryProcessesByPid.set(pid, process)
        providerReportedGamePids.clear()
        if (game.provider === 'steam' && game.appId) {
          const activeSteamPids = await this.steamActivityReader.getActiveProcessIds(game.appId)
          for (const pid of activeSteamPids) {
            if (processesByPid.has(pid)) providerReportedGamePids.add(pid)
          }
        }
        for (const pid of directlySpawnedGamePids) {
          if (processesByPid.has(pid)) observedDirectGamePids.add(pid)
          else if (observedDirectGamePids.has(pid)) directlySpawnedGamePids.delete(pid)
        }

        for (const candidate of lastProcesses) {
          if (!isLauncherRootProcess(candidate)) continue
          const family = launcherFamily(candidate)
          if (family && !baselineLauncherFamilies.has(family)) ownedLauncherFamilies.add(family)
        }

        const candidates = lastProcesses
          .map((candidate) =>
            scoreGameProcess(
              candidate,
              game,
              baselineByPid,
              ancestryProcessesByPid,
              trackedPids,
              directlySpawnedGamePids,
              providerReportedGamePids
            )
          )
          .filter((candidate): candidate is ScoredProcess => Boolean(candidate))
          .sort((left, right) => right.score - left.score)

        if (!detectedAt) {
          const currentCandidateKeys = new Set(candidates.map((candidate) => candidate.key))
          for (const key of candidateSeenAt.keys()) {
            if (!currentCandidateKeys.has(key)) candidateSeenAt.delete(key)
          }

          const best = candidates[0]
          if (best) {
            startupTracker.noteCandidateSeen()
            const seenAt = candidateSeenAt.get(best.key) ?? now
            candidateSeenAt.set(best.key, seenAt)
            if (now - seenAt >= GAME_PROCESS_CANDIDATE_STABILITY_MS) {
              startupTracker.noteCandidateStabilized()
              detectedAt = seenAt
              primaryStableSince = now
              activeTrackingMethod = best.trackingMethod
              activeTrackingFallbackIndex = best.trackingFallbackIndex
              sessionConfirmed = false
              trackedPids.add(best.pid)
              trackedProcessKeysByPid.set(best.pid, best.key)
              primaryProcessKeys.add(best.key)
              missingSince = undefined
              if (best.visible) {
                this.handoffToGame(token, best.pid, ensureFullscreenWithHotkey)
                gameFocusHandedOff = true
              }
              continue
            }

            const failureReason = startupTracker.failureReason(now, seenAt)
            if (failureReason) {
              await this.fail(
                token,
                failureReason === 'startup-ended'
                  ? 'Game process exited before startup completed'
                  : 'No game process was detected',
                failureReason
              )
              return
            }
          } else {
            candidateSeenAt.clear()
            startupTracker.noteCandidateMissing(now)
            const failureReason = startupTracker.failureReason(now)
            if (failureReason) {
              await this.fail(
                token,
                failureReason === 'startup-ended'
                  ? 'Game process exited before startup completed'
                  : 'No game process was detected',
                failureReason
              )
              return
            }
          }

          continue
        }

        // Once a process is identified, PID + executable identity is the life
        // signal. Re-scoring it on every snapshot could falsely end a running
        // game after its launcher parent or window disappears.
        const activePrimaryByPid = new Map<number, ScoredProcess>()
        for (const process of lastProcesses) {
          const pid = processId(process)
          const key = processKey(process)
          const expectedKey = trackedProcessKeysByPid.get(pid)
          const pinnedProcess = Boolean(expectedKey && key === expectedKey)
          const sameExecutableSuccessor = Boolean(
            !expectedKey &&
              key.includes('\\') &&
              primaryProcessKeys.has(key) &&
              !baselineInstance(process, baselineByPid) &&
              processName(process).endsWith('.exe') &&
              !launcherFamily(process) &&
              !SYSTEM_PROCESSES.has(processName(process)) &&
              !NON_GAME_PROCESS.test(processName(process))
          )
          if (!pinnedProcess && !sameExecutableSuccessor) continue
          activePrimaryByPid.set(pid, {
            process,
            pid,
            key,
            score: Number.MAX_SAFE_INTEGER,
            visible: hasVisibleWindow(process),
            trackingMethod: activeTrackingMethod ?? 'executable',
            trackingFallbackIndex: activeTrackingFallbackIndex ?? 0
          })
        }

        for (const candidate of candidates) {
          if (activePrimaryByPid.has(candidate.pid)) continue
          if (primaryProcessKeys.has(candidate.key)) {
            activePrimaryByPid.set(candidate.pid, candidate)
            continue
          }
          const inherited = ancestorPidMatches(
            candidate.process,
            ancestryProcessesByPid,
            trackedPids
          )
          if (inherited) {
            primaryProcessKeys.add(candidate.key)
            activePrimaryByPid.set(candidate.pid, candidate)
            continue
          }
          if (missingSince) {
            primaryProcessKeys.add(candidate.key)
            activePrimaryByPid.set(candidate.pid, candidate)
          }
        }
        const activePrimary = [...activePrimaryByPid.values()]

        trackedPids.clear()
        trackedProcessKeysByPid.clear()
        for (const candidate of activePrimary) {
          trackedPids.add(candidate.pid)
          trackedProcessKeysByPid.set(candidate.pid, candidate.key)
        }

        if (activePrimary.length > 0) {
          if (!gameFocusHandedOff) {
            const visibleGame = activePrimary.find((candidate) => candidate.visible)
            if (visibleGame) {
              this.handoffToGame(token, visibleGame.pid, ensureFullscreenWithHotkey)
              gameFocusHandedOff = true
            }
          }
          primaryStableSince ??= now
          const confirmationMs =
            activeTrackingMethod === 'provider-handoff' ? GAME_CONFIRMATION_MS : 0
          if (now - primaryStableSince >= confirmationMs && !sessionConfirmed) {
            sessionConfirmed = true
            directlySpawnedGamePids.clear()
            this.update({
              phase: 'running',
              gameId: game.id,
              gameName: game.name,
              provider: game.provider,
              requestedAt: this.status.requestedAt,
              startedAt,
              detectedAt,
              trackingMethod: activeTrackingMethod,
              trackingFallbackIndex: activeTrackingFallbackIndex
            })
            try {
              await this.callbacks.onGameConfirmed?.(game, detectedAt)
            } catch {
              // Recency persistence must never break session monitoring.
            }
          }
          missingSince = undefined
        } else {
          if (!sessionConfirmed) {
            // Short-lived launch shims (EA/Ubisoft/Xbox bootstrap processes,
            // anti-cheat hand-offs, etc.) are provisional. Losing one returns
            // to launch detection, but the startup tracker keeps a bounded
            // hand-off grace instead of restarting the full wait.
            startupTracker.noteCandidateMissing(now)
            detectedAt = undefined
            primaryStableSince = undefined
            activeTrackingMethod = undefined
            activeTrackingFallbackIndex = undefined
            gameFocusHandedOff = false
            missingSince = undefined
            trackedPids.clear()
            trackedProcessKeysByPid.clear()
            primaryProcessKeys.clear()
            candidateSeenAt.clear()
            this.update({
              phase: 'launching',
              gameId: game.id,
              gameName: game.name,
              provider: game.provider,
              requestedAt: this.status.requestedAt,
              startedAt
            })
            if (!this.launchTargetRevealed && now - startedAt < LAUNCH_SHIELD_TIMEOUT_MS) {
              this.maintainLaunchShield(token)
            }
            continue
          }
          missingSince ??= now
          const exitGrace =
            now - detectedAt < EARLY_SESSION_WINDOW_MS
              ? Math.max(EARLY_HANDOFF_GRACE_MS, provisionalHandoffGraceMs(game.provider))
              : PROCESS_EXIT_GRACE_MS
          if (now - missingSince >= exitGrace) {
            await this.returnToOrbit(
              token,
              game,
              startedAt,
              detectedAt,
              missingSince,
              lastProcesses,
              ownedLauncherFamilies
            )
            return
          }
        }
      }
    } catch (error) {
      if (token === this.activeToken) {
        await this.fail(
          token,
          error instanceof Error ? error.message : 'Game process monitor unavailable',
          'monitor-unavailable'
        )
      }
    } finally {
      sampler.stop()
      if (this.sampler === sampler) this.sampler = null
    }
  }

  finalizeForShutdown(): { gameId: string; durationSeconds: number; endedAt: number } | null {
    const status = this.getStatus()
    const endedAt = status.endedAt ?? Date.now()
    const durationSeconds =
      status.sessionDurationSeconds ??
      (status.detectedAt ? Math.max(1, Math.round((endedAt - status.detectedAt) / 1_000)) : 0)
    const completed =
      Boolean(status.gameId && status.detectedAt) &&
      (status.phase === 'running' || status.phase === 'returning') &&
      durationSeconds * 1_000 >= GAME_CONFIRMATION_MS
        ? { gameId: status.gameId as string, durationSeconds, endedAt }
        : null

    const token = this.activeToken
    this.activeToken++
    this.providerPresenceDisposed = true
    if (this.providerPresenceTimer) clearTimeout(this.providerPresenceTimer)
    this.providerPresenceTimer = null
    if (this.providerLivenessTimer) clearInterval(this.providerLivenessTimer)
    this.providerLivenessTimer = null
    this.providerPresenceSampler?.stop()
    this.providerPresenceSampler = null
    this.settlePendingLaunchDelay(token, false)
    this.sampler?.stop()
    this.sampler = null
    this.releaseLaunchShield(false)
    this.activeGame = null
    this.geForceNowLaunchIntent = undefined
    this.geForceNowSessionIdentity = undefined
    this.callbacks.restoreLaunchProfile?.()
    this.status = { phase: 'idle' }
    this.removeAllListeners()
    return completed
  }

  private async returnToOrbit(
    token: number,
    game: LibraryGame,
    startedAt: number,
    detectedAt: number,
    endedAt: number,
    processes: WindowsProcess[],
    ownedLauncherFamilies: ReadonlySet<LauncherFamily>
  ): Promise<void> {
    if (token !== this.activeToken) return
    const completedSession = {
      detectedAt,
      endedAt,
      durationSeconds: Math.max(1, Math.round((endedAt - detectedAt) / 1_000))
    }
    const shouldBackup = Boolean(
      this.status.trackingMethod !== 'geforce-now-window' &&
      game.local?.backupEnabled && game.local.savePath && this.callbacks.onGameEnded
    )
    this.update({
      phase: 'returning',
      gameId: game.id,
      gameName: game.name,
      provider: game.provider,
      startedAt,
      detectedAt,
      endedAt,
      sessionDurationSeconds: completedSession.durationSeconds,
      trackingMethod: this.status.trackingMethod,
      trackingFallbackIndex: this.status.trackingFallbackIndex,
      returnTask: shouldBackup ? 'backing-up' : undefined
    })
    await this.focusOrbit(token)
    try {
      const result = await this.callbacks.onSessionCompleted?.(game, completedSession)
      if (token === this.activeToken) {
        this.update({
          ...this.status,
          sessionDurationSeconds: completedSession.durationSeconds,
          totalPlaytimeSeconds: result?.totalPlaytimeSeconds
        })
      }
    } catch {
      // Playtime persistence failure must not trap the user outside ORBIT.
    }
    if (this.status.trackingMethod !== 'geforce-now-window' && settingsStore.store.closeLaunchersAfterGame) {
      void closeLauncherProcesses(processes, ownedLauncherFamilies)
    }
    if (shouldBackup && this.callbacks.onGameEnded) {
      let result: LocalGameBackupResult
      try {
        result = await this.callbacks.onGameEnded(game)
      } catch {
        result = { state: 'failed', completedAt: Date.now() }
      }
      if (token !== this.activeToken) return
      this.update({
        ...this.status,
        returnTask: result.state === 'success' ? 'backup-complete' : 'backup-failed'
      })
    }
    await wait(shouldBackup ? BACKUP_RESULT_SPLASH_MS : RETURN_SPLASH_MS)
    if (token === this.activeToken) {
      this.update({ phase: 'idle' })
      void this.finishReturnFocus(token)
    }
  }

  private async fail(
    token: number,
    message: string,
    failureReason: GameLaunchFailureReason
  ): Promise<void> {
    if (token !== this.activeToken) return
    this.update({
      ...this.status,
      phase: 'error',
      cancelableUntil: undefined,
      failureReason,
      message,
      endedAt: Date.now()
    })
    // A rejected dispatch is definitive. Process-based negative evidence is
    // not: protected or unusually structured games may still be running. Do
    // not steal focus back from a game after ORBIT already handed it off.
    const launchWasAcceptedWithoutMonitoring =
      failureReason === 'monitor-unavailable' && Boolean(this.status.startedAt)
    const shouldRestoreOrbit =
      failureReason === 'launch-rejected' ||
      (!launchWasAcceptedWithoutMonitoring && !this.mainWindow.isMinimized())
    // A monitoring failure happens after the OS accepted the launch request.
    // Yield to that game instead of covering it with an error screen.
    this.releaseLaunchShield(launchWasAcceptedWithoutMonitoring)
    if (shouldRestoreOrbit) await this.focusOrbit(token)
    await wait(ERROR_SPLASH_MS)
    if (token === this.activeToken) {
      this.releaseLaunchShield(false)
      this.update({ phase: 'idle' })
    }
  }

  private scheduleProviderPresencePoll(delay = PROVIDER_PRESENCE_POLL_MS): void {
    if (this.providerPresenceDisposed || this.providerPresenceTimer) return
    this.providerPresenceTimer = setTimeout(() => {
      this.providerPresenceTimer = null
      void this.pollProviderPresence().finally(() => this.scheduleProviderPresencePoll())
    }, delay)
  }

  private ensureProviderPresenceSampler(): WindowsProcessSampler | null {
    if (this.providerPresenceDisposed || process.platform !== 'win32') return null
    if (this.providerPresenceSampler) return this.providerPresenceSampler
    const sampler = new WindowsProcessSampler()
    try {
      sampler.start()
      this.providerPresenceSampler = sampler
      return sampler
    } catch {
      sampler.stop()
      return null
    }
  }

  private takeProviderPresenceSampler(): WindowsProcessSampler | null {
    const sampler = this.providerPresenceSampler
    this.providerPresenceSampler = null
    return sampler
  }

  private async getProviderPresenceSnapshot(): Promise<ProcessSnapshot | undefined> {
    let sampler = this.ensureProviderPresenceSampler()
    if (!sampler) return undefined
    let current = sampler.getLatest()
    if (
      current.sequence > 0 &&
      Date.now() - current.capturedAt <= PROVIDER_PRESENCE_STALL_TIMEOUT_MS
    ) {
      return current
    }
    if (current.sequence > 0) {
      sampler.stop()
      if (this.providerPresenceSampler === sampler) this.providerPresenceSampler = null
      sampler = this.ensureProviderPresenceSampler()
      if (!sampler) return undefined
      current = sampler.getLatest()
    }
    try {
      const snapshot = await sampler.waitForNext(0, SNAPSHOT_TIMEOUT_MS)
      return snapshot.sequence > 0 &&
        Date.now() - snapshot.capturedAt <= PROVIDER_PRESENCE_STALL_TIMEOUT_MS
        ? snapshot
        : undefined
    } catch {
      if (this.providerPresenceSampler === sampler) {
        sampler.stop()
        this.providerPresenceSampler = null
      }
      return undefined
    }
  }

  private checkProviderAttachedProcessLiveness(): void {
    if (
      this.providerPresenceDisposed ||
      !this.providerAttachedGameId ||
      this.status.phase !== 'running' ||
      !this.activeGame ||
      this.providerReturnInFlight
    ) {
      return
    }
    if ([...this.providerAttachedProcessIds].some(processIdStillExists)) {
      // The NVIDIA streamer can remain alive on the post-session screen.
      if (this.status.trackingMethod !== 'geforce-now-window') {
        this.providerPresenceMissingSince = undefined
      }
      return
    }
    const now = Date.now()
    this.providerPresenceMissingSince ??= now
    if (now - this.providerPresenceMissingSince < PROVIDER_PRESENCE_EXIT_GRACE_MS) return
    void this.finishProviderAttachedSession(this.providerPresenceMissingSince)
  }

  private async finishProviderAttachedSession(endedAt: number): Promise<void> {
    if (
      this.providerReturnInFlight ||
      !this.providerAttachedGameId ||
      this.status.phase !== 'running' ||
      !this.activeGame
    ) {
      return
    }
    this.providerReturnInFlight = true
    try {
      await this.returnToOrbit(
        this.activeToken,
        this.activeGame,
        this.status.startedAt ?? endedAt,
        this.status.detectedAt ?? endedAt,
        endedAt,
        [],
        new Set<LauncherFamily>()
      )
    } finally {
      this.providerReturnInFlight = false
    }
  }

  /**
   * Provider-native activity is preferred, then the live process table is
   * reconciled with every installed library identity. This lets externally
   * started games use the same authoritative session as ORBIT-launched games.
   */
  private async pollProviderPresence(): Promise<void> {
    if (
      this.providerPresenceDisposed ||
      (!this.providerAttachedGameId && this.status.phase !== 'idle')
    ) {
      return
    }

    const pollToken = this.activeToken
    const libraryGames = this.callbacks.getLibraryGames?.() ?? []
    const [activeSteamGames, processSnapshot] = await Promise.all([
      this.steamActivityReader.getActiveGames(),
      this.getProviderPresenceSnapshot()
    ])
    if (this.providerPresenceDisposed || pollToken !== this.activeToken) return
    const providerActivities = new Map<string, ProviderReportedGameActivity>()
    const processes = livingProcessRecords(processSnapshot?.processes ?? [])
    const knownProcessIds = new Set(processes.map((candidate) => processId(candidate)))
    for (const activity of activeSteamGames) {
      const game = libraryGames.find(
        (candidate) =>
          candidate.provider === 'steam' &&
          (candidate.appId === activity.appId ||
            candidate.providerGameId === String(activity.appId))
      )
      if (!game) continue
      providerActivities.set(game.id, {
        processIds: new Set(activity.processIds),
        startedAt: activity.startedAt
      })
      // Steam's native registry remains useful if WMI cannot inspect a
      // protected process. A synthetic row carries only the already validated
      // PID and cannot make a heuristic match for another provider.
      for (const pid of activity.processIds) {
        if (knownProcessIds.has(pid)) continue
        processes.push({
          ProcessId: pid,
          Name: 'provider-game.exe',
          StartedAt: activity.startedAt
        })
        knownProcessIds.add(pid)
      }
    }
    const activeLibraryGames = detectLibraryGamePresences(
      processes,
      libraryGames,
      providerActivities
    )

    const cloudSession = this.status.trackingMethod === 'geforce-now-window'
    const cloudIdentities = new Map<string, { game: LibraryGame; match: GeForceNowLibraryMatch }>()
    let cloudEndedAt: number | undefined
    if (processes.some(isGeForceNowGameWindow) || cloudSession) {
      const stream = await this.geForceNowActivityReader.getStreamState()
      if (this.providerPresenceDisposed || pollToken !== this.activeToken) return
      cloudEndedAt = stream.endedAt
      // Rotation or a temporary file lock must not end an already confirmed stream.
      if (cloudSession && !stream.startedAt && !stream.endedAt) {
        stream.startedAt = this.status.startedAt
      }
      if (this.geForceNowLaunchIntent && Date.now() > this.geForceNowLaunchIntent.expiresAt) {
        this.geForceNowLaunchIntent = undefined
      }
      const identity = this.geForceNowSessionIdentity ?? this.geForceNowLaunchIntent
      const cloudGames = identity
        ? [identity.game, ...libraryGames.filter((game) => game.id !== identity.game.id)]
        : libraryGames
      const matches = this.callbacks.getGeForceNowMatches?.() ?? []
      const cloudMatches = identity
        ? [identity.match, ...matches.filter((match) => match.gameId !== identity.game.id)]
        : matches
      const cloudPresences = detectGeForceNowGamePresences(
        processes, cloudGames, cloudMatches, stream,
        this.geForceNowLaunchIntent?.game.id ?? identity?.game.id
      )
      activeLibraryGames.push(...cloudPresences)
      if (cloudPresences.length === 0 && !cloudSession) this.geForceNowSessionIdentity = undefined
      for (const presence of cloudPresences) {
        const match = cloudMatches.find((candidate) => candidate.gameId === presence.game.id)
        if (match) cloudIdentities.set(presence.game.id, { game: presence.game, match })
      }
    }

    const activeGameIds = new Set(activeLibraryGames.map(({ game }) => game.id))
    for (const gameId of this.suppressedProviderGameIds) {
      if (!activeGameIds.has(gameId)) this.suppressedProviderGameIds.delete(gameId)
    }

    if (this.providerAttachedGameId) {
      if (
        this.status.phase !== 'running' ||
        this.status.gameId !== this.providerAttachedGameId ||
        !this.activeGame
      ) {
        return
      }
      const activePresence = activeLibraryGames.find(
        ({ game, trackingMethod }) => game.id === this.providerAttachedGameId &&
          (trackingMethod === 'geforce-now-window') === cloudSession
      )
      if (activePresence) {
        this.providerAttachedProcessIds.clear()
        for (const pid of activePresence?.processIds ?? []) {
          this.providerAttachedProcessIds.add(pid)
        }
        this.providerPresenceMissingSince = undefined
        return
      }
      const trackedPidStillAlive = [...this.providerAttachedProcessIds].some(
        processIdStillExists
      )
      // Once confirmed, PID lifetime remains authoritative even when a protected
      // process temporarily loses its path/package metadata in the next sample.
      if (trackedPidStillAlive && (!cloudSession || (!processSnapshot && !cloudEndedAt))) {
        this.providerPresenceMissingSince = undefined
        return
      }
      const now = Date.now()
      this.providerPresenceMissingSince ??= cloudSession && cloudEndedAt
        ? Math.max(this.status.detectedAt ?? now, Math.min(now, cloudEndedAt)) : now
      if (now - this.providerPresenceMissingSince < PROVIDER_PRESENCE_EXIT_GRACE_MS) return
      await this.finishProviderAttachedSession(this.providerPresenceMissingSince)
      return
    }

    if (this.status.phase !== 'idle') {
      this.providerPresenceCandidateKey = undefined
      this.providerPresenceCandidateSince = undefined
      return
    }
    const latest = activeLibraryGames
      .filter(({ game }) => !this.suppressedProviderGameIds.has(game.id))
      .sort(
        (left, right) =>
          (right.startedAt ?? 0) - (left.startedAt ?? 0)
      )[0]
    if (!latest || this.status.phase !== 'idle') {
      this.providerPresenceCandidateKey = undefined
      this.providerPresenceCandidateSince = undefined
      return
    }

    const now = Date.now()
    const candidateKey = `${latest.game.id}:${latest.trackingMethod}:${latest.processIds
      .slice()
      .sort((left, right) => left - right)
      .join(',')}`
    if (latest.trackingMethod !== 'provider-process') {
      if (this.providerPresenceCandidateKey !== candidateKey) {
        this.providerPresenceCandidateKey = candidateKey
        this.providerPresenceCandidateSince = now
        return
      }
      if (
        !this.providerPresenceCandidateSince ||
        now - this.providerPresenceCandidateSince < GAME_PROCESS_CANDIDATE_STABILITY_MS
      ) {
        return
      }
    }
    this.providerPresenceCandidateKey = undefined
    this.providerPresenceCandidateSince = undefined
    const { startedAt: providerStartedAt, detectedAt } = providerSessionTimestamps(
      now,
      latest.startedAt
    )
    const token = ++this.activeToken
    this.activeGame = latest.game
    this.providerAttachedGameId = latest.game.id
    this.providerAttachedProcessIds.clear()
    for (const pid of latest.processIds) this.providerAttachedProcessIds.add(pid)
    this.providerPresenceMissingSince = undefined
    this.update({
      phase: 'running',
      gameId: latest.game.id,
      gameName: latest.game.name,
      provider: latest.game.provider,
      requestedAt: providerStartedAt,
      startedAt: providerStartedAt,
      detectedAt,
      trackingMethod: latest.trackingMethod,
      trackingFallbackIndex: latest.trackingFallbackIndex
    })
    if (latest.trackingMethod === 'geforce-now-window') {
      this.geForceNowSessionIdentity = cloudIdentities.get(latest.game.id)
      this.geForceNowLaunchIntent = undefined
    }
    try {
      await this.callbacks.onGameConfirmed?.(
        latest.game, detectedAt, latest.trackingMethod === 'geforce-now-window' ? 'geforce-now' : 'local'
      )
    } catch {
      // Provider presence remains authoritative even when recency persistence fails.
    }
    if (token !== this.activeToken) return
  }

  private async focusOrbit(token: number): Promise<void> {
    if (token !== this.activeToken || this.mainWindow.isDestroyed()) return
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    // Keep ORBIT above a launcher until the OS-level activation has completed.
    // Dropping this flag first creates a race in which Steam wins the z-order.
    this.mainWindow.setAlwaysOnTop(true, 'screen-saver')
    this.mainWindow.show()
    this.mainWindow.setFullScreen(true)
    this.mainWindow.moveTop()
    this.mainWindow.focus()
    await activateOrbitWindow(this.mainWindow)
    if (token !== this.activeToken || this.mainWindow.isDestroyed()) return
    this.mainWindow.show()
    this.mainWindow.moveTop()
    this.mainWindow.focus()
  }

  private async finishReturnFocus(token: number): Promise<void> {
    const deadline = Date.now() + RETURN_FOCUS_GUARD_MS
    while (Date.now() < deadline) {
      await wait(Math.min(FOCUS_GUARD_POLL_MS, deadline - Date.now()))
      if (
        token !== this.activeToken ||
        this.status.phase !== 'idle' ||
        this.mainWindow.isDestroyed()
      ) {
        return
      }
      if (!this.mainWindow.isFocused()) await this.focusOrbit(token)
    }
    if (token === this.activeToken && this.status.phase === 'idle') {
      this.releaseLaunchShield(false)
    }
  }

  private waitForLaunchWindow(token: number, cancelableUntil: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.settlePendingLaunchDelay(token, true),
        Math.max(0, cancelableUntil - Date.now())
      )
      this.pendingLaunchDelay = { token, timer, resolve }
    })
  }

  private settlePendingLaunchDelay(token: number, shouldLaunch: boolean): void {
    const pending = this.pendingLaunchDelay
    if (!pending || pending.token !== token) return
    clearTimeout(pending.timer)
    this.pendingLaunchDelay = null
    pending.resolve(shouldLaunch)
  }

  private maintainLaunchShield(token: number): void {
    if (token !== this.activeToken || this.launchTargetRevealed || this.mainWindow.isDestroyed()) {
      return
    }
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.setFullScreen(true)
    this.mainWindow.setAlwaysOnTop(true, 'screen-saver')
    this.mainWindow.show()
    this.mainWindow.moveTop()
    this.mainWindow.focus()
  }

  private handoffToGame(token: number, pid: number, ensureFullscreenWithHotkey = false): void {
    if (token !== this.activeToken) return
    this.releaseLaunchShield(true)
    focusExternalProcess(pid, ensureFullscreenWithHotkey)
  }

  private releaseLaunchShield(minimize: boolean): void {
    if (this.mainWindow.isDestroyed()) return
    this.mainWindow.setAlwaysOnTop(false)
    if (minimize && !this.mainWindow.isMinimized()) this.mainWindow.minimize()
  }

  private update(status: GameLaunchStatus): void {
    const previous = this.status
    if (status.phase === 'idle') {
      this.callbacks.restoreLaunchProfile?.()
      this.activeGame = null
      this.providerAttachedGameId = undefined
      this.providerPresenceMissingSince = undefined
      this.providerAttachedProcessIds.clear()
      this.providerReturnInFlight = false
      this.providerPresenceCandidateKey = undefined
      this.providerPresenceCandidateSince = undefined
    }
    this.status = status
    if (
      previous.phase !== status.phase ||
      previous.gameId !== status.gameId ||
      previous.trackingMethod !== status.trackingMethod
    ) {
      console.info(
        `[game-session] phase=${status.phase} game=${status.gameId ?? 'none'} tracking=${status.trackingMethod ?? 'pending'}`
      )
    }
    this.emit('updated', this.getStatus())
  }
}
