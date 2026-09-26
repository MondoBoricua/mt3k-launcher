import { execFile, spawn } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import Store from 'electron-store'
import { settingsStore } from './settingsStore'
import { getSteamLibraryPaths } from './steam/steamInstall'
import { parseSteamAppManifest } from './steam/steamManifest'
import { t } from './i18n'
import type { LibraryGame } from '@shared/ipc'
import { createLosslessScalingController } from '@shared/losslessScalingController'
import {
  LOSSLESS_SCALING_EXECUTABLE,
  LOSSLESS_SCALING_STEAM_APP_ID,
  OwnedCompanionProcess,
  decideLosslessScalingCloseMethod,
  isLosslessScalingGameMode,
  losslessScalingCloseWindowScript,
  losslessScalingStartTimeScript,
  losslessScalingSteamCandidates,
  losslessScalingWorkingDirectory,
  needsLosslessScalingSteamScan,
  normalizeLosslessScalingPreferences,
  parseLosslessScalingStartTicks,
  parseLosslessScalingTasklist,
  resolveLosslessScalingExecutable,
  validateLosslessScalingExecutable,
  type LosslessScalingEvent,
  type LosslessScalingGameMode,
  type LosslessScalingStatus
} from '@shared/losslessScalingPolicy'

const SYSTEM32 = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const TASKLIST_PATH = win32.join(SYSTEM32, 'tasklist.exe')
const POWERSHELL_PATH = win32.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const COMMAND_TIMEOUT_MS = 5_000
/** The whole companion startup may delay a game launch by at most this long. */
const STARTUP_BUDGET_MS = 3_000
const WINDOW_CLOSE_GRACE_MS = 2_500
const KILL_GRACE_MS = 1_000
const LOG = '[lossless-scaling]'

let gameModes: Store<Record<string, LosslessScalingGameMode>> | undefined
let notify: (event: LosslessScalingEvent) => void = () => undefined
let discovery: Promise<LosslessScalingStatus> | undefined

function modes(): Store<Record<string, LosslessScalingGameMode>> {
  return gameModes ??= new Store<Record<string, LosslessScalingGameMode>>({
    name: 'lossless-scaling-games',
    accessPropertiesByDotNotation: false
  })
}

function preferences(): ReturnType<typeof normalizeLosslessScalingPreferences> {
  const stored = normalizeLosslessScalingPreferences(settingsStore.store)
  return process.platform === 'win32' ? stored : { ...stored, enabled: false }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function steamLibraries(): Promise<{ path: string; installDirName?: string }[]> {
  let paths: string[]
  try {
    // Existing helper (registry + libraryfolders.vdf); only reached when no usable manual path exists.
    paths = getSteamLibraryPaths()
  } catch (error) {
    console.warn(`${LOG} Steam libraries unavailable:`, error)
    return []
  }
  return Promise.all(paths.map(async (path) => {
    const manifest = win32.join(path, 'steamapps', `appmanifest_${LOSSLESS_SCALING_STEAM_APP_ID}.acf`)
    try {
      return { path, installDirName: parseSteamAppManifest(await readFile(manifest, 'utf8')).installDirName }
    } catch {
      return { path }
    }
  }))
}

async function discover(): Promise<LosslessScalingStatus> {
  const manualPath = settingsStore.store.losslessScalingPath
  if (process.platform !== 'win32') {
    return resolveLosslessScalingExecutable({ platform: process.platform, manualPath, manualIsFile: false, steamPath: undefined })
  }
  const manualIsFile = manualPath ? await isFile(manualPath) : false
  let steamPath: string | undefined
  if (needsLosslessScalingSteamScan(manualPath, manualIsFile)) {
    for (const candidate of losslessScalingSteamCandidates(await steamLibraries())) {
      if (await isFile(candidate)) {
        steamPath = candidate
        break
      }
    }
  }
  return resolveLosslessScalingExecutable({ platform: process.platform, manualPath, manualIsFile, steamPath })
}

function cachedDiscovery(): Promise<LosslessScalingStatus> {
  return discovery ??= discover().catch((error) => {
    discovery = undefined
    throw error
  })
}

function run(executable: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

function powershell(script: string): Promise<string> {
  return run(POWERSHELL_PATH, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
  ])
}

async function isRunning(): Promise<boolean> {
  const output = await run(TASKLIST_PATH, ['/FI', `IMAGENAME eq ${LOSSLESS_SCALING_EXECUTABLE}`, '/FO', 'CSV', '/NH'])
  return parseLosslessScalingTasklist(output).length > 0
}

/** Records the start time while the handle is still alive, for the guarded WM_CLOSE later. */
async function recordStartTime(companion: OwnedCompanionProcess): Promise<void> {
  const pid = companion.pid
  if (!pid) return
  try {
    companion.startTicks = parseLosslessScalingStartTicks(await powershell(losslessScalingStartTimeScript(pid)))
  } catch (error) {
    console.warn(`${LOG} Could not read the start time; closing will use the process handle only:`, error)
  }
}

function spawnOwned(executablePath: string, session: number): Promise<OwnedCompanionProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      cwd: losslessScalingWorkingDirectory(executablePath),
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: false
    })
    const companion = new OwnedCompanionProcess(child, session)
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve(companion)
    })
  })
}

async function closeOwned(companion: OwnedCompanionProcess): Promise<void> {
  await companion.startTicksReady
  const method = decideLosslessScalingCloseMethod({ exited: companion.exited, startTicks: companion.startTicks })
  if (method === 'none') return
  const pid = companion.pid
  if (method === 'window-then-handle' && pid && companion.startTicks) {
    try {
      // The script re-checks name and start time, so a reused PID is refused even in the residual window.
      await powershell(losslessScalingCloseWindowScript(pid, companion.startTicks))
    } catch (error) {
      console.warn(`${LOG} Closing the main window failed:`, error)
    }
    if (await companion.whenExited(WINDOW_CLOSE_GRACE_MS)) return
  }
  // Tray or no window: terminate through our own child handle, immune to PID reuse.
  if (companion.kill()) await companion.whenExited(KILL_GRACE_MS)
}

const controller = createLosslessScalingController({
  platform: process.platform,
  preferences,
  gameMode: (gameId) => losslessScalingService.getGameMode(gameId),
  isRunning,
  executablePath: async () => (await cachedDiscovery()).path,
  invalidateDiscovery: () => { discovery = undefined },
  spawn: spawnOwned,
  onOwned: (companion) => { companion.startTicksReady = recordStartTime(companion) },
  close: closeOwned,
  notify: (event) => notify(event),
  log: (level, message, error) => {
    if (level === 'warn') console.warn(`${LOG} ${message}`, ...(error === undefined ? [] : [error]))
    else console.info(`${LOG} ${message}`)
  },
  startupBudgetMs: STARTUP_BUDGET_MS,
  killGraceMs: KILL_GRACE_MS
})

export const losslessScalingService = {
  initialize(send: (event: LosslessScalingEvent) => void): void {
    notify = send
  },

  /** Forget cached detection (settings changed, path chosen, or a start failed). */
  invalidateDiscovery(): void {
    discovery = undefined
  },

  /** While the feature is off only `supported` matters; no scan happens. */
  async status(): Promise<LosslessScalingStatus> {
    if (process.platform !== 'win32' || !preferences().enabled) {
      return resolveLosslessScalingExecutable({
        platform: process.platform,
        manualPath: settingsStore.store.losslessScalingPath,
        manualIsFile: false,
        steamPath: undefined
      })
    }
    return cachedDiscovery()
  },

  async choosePath(mainWindow: BrowserWindow): Promise<LosslessScalingStatus | null> {
    if (process.platform !== 'win32') throw new Error('Lossless Scaling is only available on Windows')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('MT3K Launcher · Select LosslessScaling.exe'),
      buttonLabel: t('Use Lossless Scaling'),
      properties: ['openFile'],
      filters: [{ name: 'Lossless Scaling', extensions: ['exe'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const resolved = await realpath(result.filePaths[0]).catch(() => result.filePaths[0])
    const info = await stat(resolved).catch(() => null)
    const validation = validateLosslessScalingExecutable(resolved, {
      exists: () => info !== null,
      isFile: () => info?.isFile() === true
    })
    if (!validation.ok) throw new Error(t('Select the LosslessScaling.exe file from your Lossless Scaling folder.'))
    settingsStore.set('losslessScalingPath', validation.path)
    discovery = undefined
    return this.status()
  },

  clearPath(): Promise<LosslessScalingStatus> {
    settingsStore.delete('losslessScalingPath')
    discovery = undefined
    return this.status()
  },

  getGameMode(gameId: string): LosslessScalingGameMode {
    const value: unknown = modes().get(gameId)
    return isLosslessScalingGameMode(value) ? value : 'default'
  },

  setGameMode(gameId: string, mode: unknown): LosslessScalingGameMode {
    if (!isLosslessScalingGameMode(mode)) throw new Error('Invalid Lossless Scaling mode')
    if (mode === 'default') modes().delete(gameId)
    else modes().set(gameId, mode)
    return mode
  },

  /** Returns the launch session id; never rejects, never delays the game beyond the budget. */
  beforeLaunch(game: LibraryGame): Promise<number | undefined> {
    return controller.beforeLaunch(game)
  },

  /** Session ended (complete, error or cancelled). Without an id, ends the active launch. */
  sessionEnded(session?: number): Promise<void> {
    return controller.sessionEnded(session)
  },

  hasPendingWork(): boolean {
    return controller.hasPendingWork()
  },

  /** Normal quit: bounded, awaited cleanup of pending startups and owned copies. */
  shutdown(budgetMs: number): Promise<void> {
    return controller.shutdown(budgetMs)
  }
}
