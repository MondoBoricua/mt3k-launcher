/**
 * Lossless Scaling companion: pure decisions only. The launcher never drives
 * Lossless Scaling itself (profiles, hotkeys, scaling); it only makes sure the
 * app is running when a game starts and, optionally, closes the instance it
 * started once the session ends.
 */

/** Steam app id of Lossless Scaling (paid, by THS). */
export const LOSSLESS_SCALING_STEAM_APP_ID = 993090
export const LOSSLESS_SCALING_EXECUTABLE = 'LosslessScaling.exe'
export const LOSSLESS_SCALING_STEAM_FOLDER = 'Lossless Scaling'
const MAX_WINDOWS_PATH_LENGTH = 32_767

export const LOSSLESS_SCALING_GAME_MODES = ['default', 'always', 'never'] as const
/** Per-game choice. `default` follows the launcher-wide preference. */
export type LosslessScalingGameMode = (typeof LOSSLESS_SCALING_GAME_MODES)[number]

export interface LosslessScalingPreferences {
  enabled: boolean
  /** Newly launched local games use Lossless Scaling unless they say otherwise. */
  defaultForGames: boolean
  /** Close the instance the launcher started when the session ends. */
  closeOnExit: boolean
}

export const LOSSLESS_SCALING_DEFAULTS: LosslessScalingPreferences = {
  enabled: false,
  defaultForGames: false,
  closeOnExit: true
}

export type LosslessScalingPathSource = 'manual' | 'steam' | 'none'

export interface LosslessScalingStatus {
  /** False on every platform except Windows: the feature is hidden entirely. */
  supported: boolean
  state: 'found' | 'missing'
  source: LosslessScalingPathSource
  /** Effective executable used at launch time. */
  path?: string
  /** Manual override as stored, even when it no longer exists on disk. */
  manualPath?: string
}

export type LosslessScalingEvent = { kind: 'missing' } | { kind: 'start-failed' }

/** Games whose process runs on this PC. PlayStation entries are Remote Play
 * streams and GeForce NOW sessions never go through the local launch path. */
const LOCAL_LAUNCH_PROVIDERS = new Set([
  'steam',
  'epic',
  'gog',
  'xbox',
  'retro',
  'ea',
  'ubisoft',
  'local'
])

export function isLosslessScalingGameMode(value: unknown): value is LosslessScalingGameMode {
  return typeof value === 'string' && (LOSSLESS_SCALING_GAME_MODES as readonly string[]).includes(value)
}

export function normalizeLosslessScalingPreferences(value: {
  losslessScalingEnabled?: unknown
  losslessScalingDefaultForGames?: unknown
  losslessScalingCloseOnExit?: unknown
}): LosslessScalingPreferences {
  return {
    enabled: value.losslessScalingEnabled === true,
    defaultForGames: value.losslessScalingDefaultForGames === true,
    closeOnExit: value.losslessScalingCloseOnExit !== false
  }
}

export function isLosslessScalingEligibleGame(game: { provider: string; installed?: boolean }): boolean {
  return game.installed === true && LOCAL_LAUNCH_PROVIDERS.has(game.provider)
}

/** Effective per-game setting: the explicit choice wins, otherwise the launcher default. */
export function resolveLosslessScalingForGame(
  preferences: LosslessScalingPreferences,
  mode: LosslessScalingGameMode | undefined,
  game: { provider: string; installed?: boolean }
): boolean {
  if (!preferences.enabled || !isLosslessScalingEligibleGame(game)) return false
  if (mode === 'always') return true
  if (mode === 'never') return false
  return preferences.defaultForGames
}

export type LosslessScalingStartDecision = 'skip' | 'already-running' | 'missing' | 'start'

export function decideLosslessScalingStart(input: {
  platform: string
  wanted: boolean
  executablePath: string | undefined
  running: boolean
}): LosslessScalingStartDecision {
  if (input.platform !== 'win32' || !input.wanted) return 'skip'
  // An instance the user opened stays theirs; the launcher neither restarts nor owns it.
  if (input.running) return 'already-running'
  if (!input.executablePath) return 'missing'
  return 'start'
}

export type LosslessScalingStopDecision = 'nothing' | 'forget' | 'close'

export function decideLosslessScalingStop(input: {
  startedPid: number | undefined
  closeOnExit: boolean
  /** The PID still belongs to a LosslessScaling.exe process. */
  stillOurs: boolean
}): LosslessScalingStopDecision {
  if (!input.startedPid) return 'nothing'
  if (!input.closeOnExit || !input.stillOurs) return 'forget'
  return 'close'
}

function windowsBaseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

function windowsDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return index > 0 ? path.slice(0, index) : ''
}

/** Shape check for a Windows path to LosslessScaling.exe. Existence is checked separately. */
export function isLosslessScalingExecutablePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const path = value.trim()
  if (!path || path !== value || path.length > MAX_WINDOWS_PATH_LENGTH) return false
  if (/[\u0000-\u001f\u007f"<>|?*]/u.test(path)) return false
  // Absolute drive path (C:\...) or UNC share (\\server\share\...).
  if (!/^[a-z]:[\\/]/i.test(path) && !/^\\\\[^\\/]+[\\/][^\\/]+/.test(path)) return false
  if (path.split(/[\\/]/).some((segment) => segment === '..')) return false
  return windowsBaseName(path).toLowerCase() === LOSSLESS_SCALING_EXECUTABLE.toLowerCase()
}

export type LosslessScalingPathValidation =
  | { ok: true; path: string }
  | { ok: false; reason: 'invalid-path' | 'not-found' | 'not-a-file' }

export function validateLosslessScalingExecutable(
  value: unknown,
  fileSystem: { exists: (path: string) => boolean; isFile: (path: string) => boolean }
): LosslessScalingPathValidation {
  if (!isLosslessScalingExecutablePath(value)) return { ok: false, reason: 'invalid-path' }
  if (!fileSystem.exists(value)) return { ok: false, reason: 'not-found' }
  if (!fileSystem.isFile(value)) return { ok: false, reason: 'not-a-file' }
  return { ok: true, path: value }
}

/** Candidate executables inside each Steam library, preferring the manifest's install folder. */
export function losslessScalingSteamCandidates(
  libraries: readonly { path: string; installDirName?: string }[]
): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const library of libraries) {
    const base = library.path.replace(/[\\/]+$/, '')
    if (!base) continue
    const folders = [library.installDirName, LOSSLESS_SCALING_STEAM_FOLDER]
      .filter((folder): folder is string => Boolean(folder && !/[\\/]|^\.\.?$/.test(folder)))
    for (const folder of folders) {
      const candidate = `${base}\\steamapps\\common\\${folder}\\${LOSSLESS_SCALING_EXECUTABLE}`
      const key = candidate.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(candidate)
    }
  }
  return candidates
}

/** Manual override first (only while it is still valid), then the Steam install. */
export function resolveLosslessScalingExecutable(input: {
  platform: string
  manualPath: string | undefined
  steamCandidates: readonly string[]
  isFile: (path: string) => boolean
}): LosslessScalingStatus {
  const supported = input.platform === 'win32'
  const manualPath = input.manualPath?.trim() || undefined
  if (!supported) return { supported, state: 'missing', source: 'none', manualPath }
  if (manualPath && isLosslessScalingExecutablePath(manualPath) && input.isFile(manualPath)) {
    return { supported, state: 'found', source: 'manual', path: manualPath, manualPath }
  }
  const steamPath = input.steamCandidates.find((candidate) => input.isFile(candidate))
  if (steamPath) return { supported, state: 'found', source: 'steam', path: steamPath, manualPath }
  return { supported, state: 'missing', source: 'none', manualPath }
}

export function losslessScalingWorkingDirectory(executablePath: string): string {
  return windowsDirectory(executablePath)
}

/** Parses `tasklist /FO CSV /NH` output and returns the PIDs of LosslessScaling.exe. */
export function parseLosslessScalingTasklist(output: string): number[] {
  const pids: number[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^"([^"]+)","(\d+)"/.exec(line.trim())
    if (!match) continue
    if (match[1].toLowerCase() !== LOSSLESS_SCALING_EXECUTABLE.toLowerCase()) continue
    const pid = Number(match[2])
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}
