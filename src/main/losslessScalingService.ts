import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { win32 } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import Store from 'electron-store'
import { settingsStore } from './settingsStore'
import { getSteamLibraryPaths } from './steam/steamInstall'
import { parseSteamAppManifest } from './steam/steamManifest'
import { processIdStillExists } from './processLiveness'
import { t } from './i18n'
import type { LibraryGame } from '@shared/ipc'
import {
  LOSSLESS_SCALING_EXECUTABLE,
  LOSSLESS_SCALING_STEAM_APP_ID,
  decideLosslessScalingStart,
  decideLosslessScalingStop,
  isLosslessScalingEligibleGame,
  isLosslessScalingGameMode,
  losslessScalingSteamCandidates,
  losslessScalingWorkingDirectory,
  normalizeLosslessScalingPreferences,
  parseLosslessScalingTasklist,
  resolveLosslessScalingExecutable,
  resolveLosslessScalingForGame,
  validateLosslessScalingExecutable,
  type LosslessScalingEvent,
  type LosslessScalingGameMode,
  type LosslessScalingStatus
} from '@shared/losslessScalingPolicy'

const SYSTEM32 = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const TASKLIST_PATH = win32.join(SYSTEM32, 'tasklist.exe')
const TASKKILL_PATH = win32.join(SYSTEM32, 'taskkill.exe')
const POWERSHELL_PATH = win32.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const COMMAND_TIMEOUT_MS = 5_000
const SPAWN_TIMEOUT_MS = 5_000
const WINDOW_CLOSE_GRACE_MS = 2_500
const EXIT_POLL_MS = 250
const LOG = '[lossless-scaling]'

let gameModes: Store<Record<string, LosslessScalingGameMode>> | undefined
let notify: (event: LosslessScalingEvent) => void = () => undefined
/** PID of the instance this launcher started for the current session, if any. */
let startedPid: number | undefined
/** A close in progress; the next launch waits for it so it never mistakes a closing copy for a running one. */
let closing: Promise<void> = Promise.resolve()

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

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function steamLibraries(): { path: string; installDirName?: string }[] {
  let paths: string[]
  try {
    paths = getSteamLibraryPaths()
  } catch (error) {
    console.warn(`${LOG} Steam libraries unavailable:`, error)
    return []
  }
  return paths.map((path) => {
    const manifest = win32.join(path, 'steamapps', `appmanifest_${LOSSLESS_SCALING_STEAM_APP_ID}.acf`)
    if (!existsSync(manifest)) return { path }
    try {
      return { path, installDirName: parseSteamAppManifest(readFileSync(manifest, 'utf8')).installDirName }
    } catch {
      return { path }
    }
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

async function runningPids(filter: string): Promise<number[]> {
  return parseLosslessScalingTasklist(await run(TASKLIST_PATH, ['/FI', filter, '/FO', 'CSV', '/NH']))
}

async function isRunning(): Promise<boolean> {
  return (await runningPids(`IMAGENAME eq ${LOSSLESS_SCALING_EXECUTABLE}`)).length > 0
}

/** The PID still exists and still belongs to LosslessScaling.exe (PIDs can be reused). */
async function stillOurs(pid: number): Promise<boolean> {
  if (!processIdStillExists(pid)) return false
  try {
    return (await runningPids(`PID eq ${pid}`)).includes(pid)
  } catch (error) {
    console.warn(`${LOG} Could not confirm process ${pid}:`, error)
    return false
  }
}

function launch(executablePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      cwd: losslessScalingWorkingDirectory(executablePath),
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: false
    })
    const timer = setTimeout(() => reject(new Error('Lossless Scaling did not start in time')), SPAWN_TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('spawn', () => {
      clearTimeout(timer)
      child.unref()
      resolve(child.pid ?? 0)
    })
  })
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processIdStillExists(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, EXIT_POLL_MS))
  }
  return !processIdStillExists(pid)
}

async function close(pid: number): Promise<void> {
  // pid is a validated positive integer; nothing user-controlled reaches the script.
  const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -ne $p -and $p.MainWindowHandle -ne 0) { $null = $p.CloseMainWindow() }`
  try {
    await run(POWERSHELL_PATH, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')])
  } catch (error) {
    console.warn(`${LOG} Closing the main window failed:`, error)
  }
  if (await waitForExit(pid, WINDOW_CLOSE_GRACE_MS)) return
  // It may have gone to the tray instead of exiting. Re-check ownership before forcing it.
  if (!(await stillOurs(pid))) return
  try {
    await run(TASKKILL_PATH, ['/PID', String(pid), '/F'])
  } catch (error) {
    console.warn(`${LOG} taskkill failed for ${pid}:`, error)
  }
}

async function closeStarted(pid: number): Promise<void> {
  try {
    const decision = decideLosslessScalingStop({
      startedPid: pid,
      closeOnExit: preferences().closeOnExit,
      stillOurs: await stillOurs(pid)
    })
    if (decision !== 'close') return
    await close(pid)
    console.info(`${LOG} Closed the instance started for this session (pid ${pid}).`)
  } catch (error) {
    console.warn(`${LOG} Could not close Lossless Scaling:`, error)
  }
}

export const losslessScalingService = {
  initialize(send: (event: LosslessScalingEvent) => void): void {
    notify = send
  },

  status(): LosslessScalingStatus {
    const manualPath = settingsStore.store.losslessScalingPath
    if (process.platform !== 'win32') {
      return resolveLosslessScalingExecutable({ platform: process.platform, manualPath, steamCandidates: [], isFile })
    }
    return resolveLosslessScalingExecutable({
      platform: process.platform,
      manualPath,
      steamCandidates: losslessScalingSteamCandidates(steamLibraries()),
      isFile
    })
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
    const validation = validateLosslessScalingExecutable(resolved, { exists: existsSync, isFile })
    if (!validation.ok) throw new Error(t('Select the LosslessScaling.exe file from your Lossless Scaling folder.'))
    settingsStore.set('losslessScalingPath', validation.path)
    return this.status()
  },

  clearPath(): LosslessScalingStatus {
    settingsStore.delete('losslessScalingPath')
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

  /** Never blocks or fails a launch: every problem is logged and the game starts anyway. */
  async beforeLaunch(game: LibraryGame): Promise<void> {
    await closing
    try {
      const prefs = preferences()
      if (!prefs.enabled || !isLosslessScalingEligibleGame(game)) return
      const wanted = resolveLosslessScalingForGame(prefs, this.getGameMode(game.id), game)
      if (!wanted) return
      const running = await isRunning()
      const executablePath = running ? undefined : this.status().path
      const decision = decideLosslessScalingStart({ platform: process.platform, wanted, executablePath, running })
      if (decision === 'already-running') {
        console.info(`${LOG} Already running; leaving the user's instance alone.`)
        return
      }
      if (decision === 'missing') {
        console.warn(`${LOG} LosslessScaling.exe was not found; launching the game without it.`)
        notify({ kind: 'missing' })
        return
      }
      if (decision !== 'start' || !executablePath) return
      const pid = await launch(executablePath)
      startedPid = pid > 0 ? pid : undefined
      console.info(`${LOG} Started ${executablePath} (pid ${pid}) for ${game.id}.`)
    } catch (error) {
      console.warn(`${LOG} Could not start Lossless Scaling; launching the game without it:`, error)
      notify({ kind: 'start-failed' })
    }
  },

  /** Session ended (complete, error or cancelled). Idempotent. */
  sessionEnded(): Promise<void> {
    const pid = startedPid
    startedPid = undefined
    if (!pid) return closing
    closing = closeStarted(pid)
    return closing
  }
}
