import { win32 as path } from 'node:path'
import type { GameLaunchStatus, LibraryGame } from '@shared/ipc'
import {
  selectGameTrackingMethod,
  windowsExecutableInsideDirectory,
  windowsPackageIdentityMatches
} from './gameLaunchDetectionPolicy'

export interface GamePresenceProcess {
  ProcessId?: number
  ParentProcessId?: number
  Name?: string
  ExecutablePath?: string
  CommandLine?: string
  StartedAt?: number
  MainWindowHandle?: number
  MainWindowTitle?: string
}

export interface ProviderReportedGameActivity {
  processIds: ReadonlySet<number>
  startedAt?: number
}

export interface DetectedGamePresence {
  game: LibraryGame
  processIds: number[]
  startedAt?: number
  trackingMethod: NonNullable<GameLaunchStatus['trackingMethod']>
  trackingFallbackIndex: number
}

interface PresenceCandidate {
  game: LibraryGame
  pid: number
  startedAt?: number
  trackingMethod: DetectedGamePresence['trackingMethod']
  trackingFallbackIndex: number
  score: number
}

const LAUNCHER_PROCESSES = new Set([
  'steam.exe',
  'steamwebhelper.exe',
  'gameoverlayui.exe',
  'epicgameslauncher.exe',
  'epicwebhelper.exe',
  'eadesktop.exe',
  'ealauncher.exe',
  'eabackgroundservice.exe',
  'origin.exe',
  'originwebhelperservice.exe',
  'ubisoftconnect.exe',
  'upc.exe',
  'uplay.exe',
  'uplaywebcore.exe',
  'galaxyclient.exe',
  'galaxyclientservice.exe',
  'galaxycommunication.exe',
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
  'taskhostw.exe',
  'textinputhost.exe',
  'userinit.exe',
  'wininit.exe',
  'winlogon.exe',
  'wmiprvse.exe'
])

const AUXILIARY_PROCESS =
  /(activationui|anti.?cheat|battleye|bootstrap|browser|cef|crash|dedicated|dxsetup|gamelaunchhelper|helper|installer|launcher|link2ea|overlay|prereq|protectedgame|redist|report|server|service|setup|startprotectedgame|telemetry|tray|unins|updat|vc_redist|watchdog|webhelper)/i

function normalizedPath(value: string | undefined): string {
  return (value ?? '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function expectedExecutablePath(game: LibraryGame): string {
  const importedExecutable = game.local?.executablePath ?? game.retro?.emulatorPath
  if (importedExecutable && path.isAbsolute(importedExecutable)) {
    return normalizedPath(importedExecutable)
  }
  const providerExecutable = game.metadata.launchExecutable?.trim()
  if (!providerExecutable) return ''
  if (path.isAbsolute(providerExecutable)) return normalizedPath(providerExecutable)
  return game.installDir
    ? normalizedPath(path.resolve(game.installDir, providerExecutable))
    : ''
}

export function windowsCommandLineContainsPath(
  commandLine: string,
  target: string | undefined
): boolean {
  const normalizedTarget = normalizedPath(target)
  if (!normalizedTarget) return false
  const escapedTarget = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[\\s"=])${escapedTarget}(?=$|[\\s"])`, 'i').test(
    normalizedPath(commandLine)
  )
}

function processId(process: GamePresenceProcess): number {
  return Number.isInteger(process.ProcessId) && (process.ProcessId ?? 0) > 0
    ? (process.ProcessId as number)
    : 0
}

function processName(process: GamePresenceProcess): string {
  return (process.Name ?? path.basename(process.ExecutablePath ?? '')).trim().toLowerCase()
}

function addIndexedGame(
  index: Map<string, LibraryGame[]>,
  key: string,
  game: LibraryGame
): void {
  if (!key) return
  const games = index.get(key)
  if (games) games.push(game)
  else index.set(key, [game])
}

function addIndexedPid(
  index: Map<number, LibraryGame[]>,
  pid: number,
  game: LibraryGame
): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  const games = index.get(pid)
  if (games) games.push(game)
  else index.set(pid, [game])
}

function packageFamily(game: LibraryGame): string {
  const launchFamily = /^shell:appsfolder\\([^!\\]+)!/i.exec(
    game.metadata.launchUri?.trim() ?? ''
  )?.[1]
  return (launchFamily ?? game.metadata.providerPackageFamilyName ?? '').trim().toLowerCase()
}

function processDirectoryAncestors(executablePath: string): string[] {
  const ancestors: string[] = []
  let current = normalizedPath(path.dirname(executablePath))
  while (current) {
    ancestors.push(current)
    const parent = normalizedPath(path.dirname(current))
    if (!parent || parent === current) break
    current = parent
  }
  return ancestors
}

function matchPresenceCandidate(
  process: GamePresenceProcess,
  game: LibraryGame,
  providerActivity: ProviderReportedGameActivity | undefined
): PresenceCandidate | undefined {
  const pid = processId(process)
  const name = processName(process)
  const executable = normalizedPath(process.ExecutablePath)
  const commandLine = process.CommandLine ?? ''
  const providerReportedGame = Boolean(providerActivity?.processIds.has(pid))
  if (
    pid <= 0 ||
    !name.endsWith('.exe') ||
    SYSTEM_PROCESSES.has(name) ||
    LAUNCHER_PROCESSES.has(name)
  ) {
    return undefined
  }
  if (!game.installed && !providerReportedGame) return undefined

  const packageFamilyMatches = windowsPackageIdentityMatches(
    game.metadata.launchUri,
    process.ExecutablePath,
    commandLine,
    game.metadata.providerPackageFamilyName
  )
  const insideInstallDir =
    game.provider !== 'retro' &&
    windowsExecutableInsideDirectory(process.ExecutablePath, game.installDir)
  const expectedExecutable = expectedExecutablePath(game)
  const exactExecutable = Boolean(
    executable && expectedExecutable && executable === expectedExecutable
  )
  const retroRomMatches =
    game.provider === 'retro' && windowsCommandLineContainsPath(commandLine, game.retro?.romPath)

  // One Remote Play process does not reveal which console title is active.
  // It is safe only inside ORBIT's own launch flow, where the selected title is
  // already known and process ancestry supplies the missing identity.
  if (game.provider === 'playstation' && !providerReportedGame) return undefined

  // Emulator executables are shared by many ROMs. Outside ORBIT's own launch
  // flow the exact ROM argument is therefore mandatory.
  const safeExactExecutable =
    game.provider === 'retro' ? exactExecutable && retroRomMatches : exactExecutable
  const selected = selectGameTrackingMethod(game.provider, {
    providerReportedGame,
    directlySpawnedGame: false,
    exactExecutable: safeExactExecutable,
    insideInstallDir,
    packageFamilyMatches,
    idMatches: false,
    executableHintMatches: false,
    fromTrackedGame: false,
    fromLauncher: false,
    visible: Boolean(process.MainWindowHandle || process.MainWindowTitle?.trim()),
    nameMatches: false,
    windowsAppsProcess: executable.includes('\\windowsapps\\')
  })
  if (!selected || selected.method === 'process-tree' || selected.method === 'provider-handoff') {
    return undefined
  }
  if (
    AUXILIARY_PROCESS.test(name) &&
    !providerReportedGame &&
    !safeExactExecutable &&
    !packageFamilyMatches
  ) {
    return undefined
  }

  let score = providerReportedGame
    ? 100_000
    : packageFamilyMatches
      ? 90_000
      : retroRomMatches
        ? 85_000
        : safeExactExecutable
          ? 80_000
          : 70_000
  if (insideInstallDir) score += normalizedPath(game.installDir).length

  return {
    game,
    pid,
    startedAt: providerActivity?.startedAt ?? process.StartedAt,
    trackingMethod: selected.method,
    trackingFallbackIndex: selected.fallbackIndex,
    score
  }
}

/**
 * Maps the live Windows process table back to durable ORBIT library identities.
 * Only provider-native PIDs, package identity, an exact executable or a
 * segment-safe install directory are accepted. Ambiguous matches are dropped
 * instead of assigning a running indicator to the wrong title.
 */
export function detectLibraryGamePresences(
  processes: readonly GamePresenceProcess[],
  games: readonly LibraryGame[],
  providerActivities: ReadonlyMap<string, ProviderReportedGameActivity> = new Map()
): DetectedGamePresence[] {
  const installedOrReported = games.filter(
    (game) => game.installed || providerActivities.has(game.id)
  )
  const gamesByProviderPid = new Map<number, LibraryGame[]>()
  const gamesByExecutable = new Map<string, LibraryGame[]>()
  const gamesByInstallDirectory = new Map<string, LibraryGame[]>()
  const gamesByPackageFamily = new Map<string, LibraryGame[]>()
  for (const game of installedOrReported) {
    const providerActivity = providerActivities.get(game.id)
    for (const pid of providerActivity?.processIds ?? []) {
      addIndexedPid(gamesByProviderPid, pid, game)
    }
    if (!game.installed) continue
    addIndexedGame(gamesByExecutable, expectedExecutablePath(game), game)
    if (game.provider !== 'retro') {
      addIndexedGame(gamesByInstallDirectory, normalizedPath(game.installDir), game)
    }
    addIndexedGame(gamesByPackageFamily, packageFamily(game), game)
  }

  const accepted: PresenceCandidate[] = []

  for (const process of processes) {
    const pid = processId(process)
    const executable = normalizedPath(process.ExecutablePath)
    const candidateGames = new Set<LibraryGame>(gamesByProviderPid.get(pid) ?? [])
    for (const game of gamesByExecutable.get(executable) ?? []) candidateGames.add(game)
    if (executable) {
      for (const directory of processDirectoryAncestors(executable)) {
        for (const game of gamesByInstallDirectory.get(directory) ?? []) candidateGames.add(game)
      }
    }
    for (const [family, familyGames] of gamesByPackageFamily) {
      if (
        !windowsPackageIdentityMatches(
          undefined,
          process.ExecutablePath,
          process.CommandLine,
          family
        )
      ) {
        continue
      }
      for (const game of familyGames) candidateGames.add(game)
    }

    const candidates = [...candidateGames]
      .map((game) => matchPresenceCandidate(process, game, providerActivities.get(game.id)))
      .filter((candidate): candidate is PresenceCandidate => Boolean(candidate))
      .sort((left, right) => right.score - left.score)
    const strongest = candidates[0]
    if (!strongest || strongest.score === candidates[1]?.score) continue
    accepted.push(strongest)
  }

  const byGameId = new Map<string, DetectedGamePresence & { score: number }>()
  for (const candidate of accepted) {
    const current = byGameId.get(candidate.game.id)
    if (!current) {
      byGameId.set(candidate.game.id, {
        game: candidate.game,
        processIds: [candidate.pid],
        startedAt: candidate.startedAt,
        trackingMethod: candidate.trackingMethod,
        trackingFallbackIndex: candidate.trackingFallbackIndex,
        score: candidate.score
      })
      continue
    }
    current.processIds.push(candidate.pid)
    if (
      candidate.startedAt !== undefined &&
      (current.startedAt === undefined || candidate.startedAt < current.startedAt)
    ) {
      current.startedAt = candidate.startedAt
    }
    if (candidate.score > current.score) {
      current.score = candidate.score
      current.trackingMethod = candidate.trackingMethod
      current.trackingFallbackIndex = candidate.trackingFallbackIndex
    }
  }

  return [...byGameId.values()].map(({ score: _score, ...presence }) => presence)
}
