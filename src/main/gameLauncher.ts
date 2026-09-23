import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 as path } from 'node:path'
import { shell } from 'electron'
import type { LibraryGame } from '@shared/ipc'
import {
  canRequestGameInstall,
  canRequestGameUninstall
} from '@shared/gameInstallation'
import { retroLaunchArguments } from '@shared/retroSystems'
import { launcherDownloadMonitor } from './downloads/launcherDownloadMonitor'
import {
  isWindowsElevationRequiredError,
  windowsCommandLineArguments
} from './gameLaunchElevationPolicy'
import { prepareRetroFullscreen } from './retro/retroLaunchPreparation'
import { ensureRetroArchNetworkCommands } from './retro/retroArchNetworkConfig'
import { playStationRemotePlayService } from './playstation/remotePlay'
import { getSteamAppsDirectories, getSteamInstallPath } from './steam/steamInstall'
import {
  steamDirectInstallArguments,
  waitForSteamInstallStart
} from './steam/steamInstallRequest'
import {
  normalizeXboxProductId,
  requestXboxProductInstall
} from './xbox/xboxInstallRequest'
import { uninstallXboxPackage } from './xbox/xboxUninstall'

const WINDOWS_POWERSHELL_PATH = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)

export interface GameLaunchReceipt {
  /** Present only when ORBIT spawned the configured game executable itself. */
  spawnedGamePid?: number
  /** Config-driven emulators use this to verify fullscreen and fall back to Alt+Enter. */
  ensureFullscreenWithHotkey?: boolean
}

export type GameInstallRequestState = 'queued' | 'provider-opened'
export type GameUninstallRequestState = 'completed' | 'provider-opened'

function epicGameId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 512 || !/^[a-z0-9_.-]+$/i.test(id)) {
    throw new Error('Invalid Epic game identifier')
  }
  return id
}

function providerId(value: string, provider: string): string {
  const id = value.trim()
  if (!id || id.length > 512 || !/^[a-z0-9_.:-]+$/i.test(id)) {
    throw new Error(`Invalid ${provider} game identifier`)
  }
  return id
}

function xboxApplicationId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 512 || !/^[a-z0-9_.-]+![a-z0-9_.-]+$/i.test(id)) {
    throw new Error('Invalid Xbox application identifier')
  }
  return id
}

function installedXboxApplicationId(game: LibraryGame): string | undefined {
  const prefix = 'shell:AppsFolder\\'
  const launchUri = game.metadata.launchUri?.trim()
  if (launchUri?.startsWith(prefix)) return xboxApplicationId(launchUri.slice(prefix.length))
  if (game.providerGameId.includes('!')) return xboxApplicationId(game.providerGameId)
  return undefined
}

function launchWindowsApplication(applicationId: string): Promise<number> {
  return launchDetached('explorer.exe', [`shell:AppsFolder\\${applicationId}`], undefined, true)
}

function launchDetached(
  executable: string,
  args: readonly string[],
  cwd?: string,
  hideLauncherWindow = false
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      shell: false,
      stdio: 'ignore',
      // Direct game launches must remain visible. Only known helper/launcher
      // processes opt in to a hidden window at their call site.
      windowsHide: hideLauncherWindow
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve(child.pid ?? 0)
    })
  })
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function launchElevatedWithPowerShell(
  executable: string,
  args: readonly string[],
  cwd: string
): Promise<number> {
  const payload = Buffer.from(
    JSON.stringify({ executable, arguments: windowsCommandLineArguments(args), cwd }),
    'utf8'
  ).toString('base64')
  const script = `
$ErrorActionPreference = 'Stop'
$requestJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$request = $requestJson | ConvertFrom-Json
$parameters = @{
  FilePath = [string]$request.executable
  WorkingDirectory = [string]$request.cwd
  Verb = 'RunAs'
  PassThru = $true
  ErrorAction = 'Stop'
}
if ($request.arguments) { $parameters.ArgumentList = [string]$request.arguments }
$child = Start-Process @parameters
[Console]::Out.Write([string]$child.Id)
`

  return new Promise((resolve, reject) => {
    execFile(
      WINDOWS_POWERSHELL_PATH,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(script)],
      { encoding: 'utf8', timeout: 120_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || 'Administrator approval was cancelled or unavailable'))
          return
        }
        const processId = Number.parseInt(stdout.trim(), 10)
        resolve(Number.isInteger(processId) && processId > 0 ? processId : 0)
      }
    )
  })
}

/** Launches a game directly where possible, but delegates only this executable
 * to the Windows shell when its manifest requires administrator approval. ORBIT
 * itself stays unelevated, so other launchers do not inherit broad privileges. */
async function launchDetachedGame(
  executable: string,
  args: readonly string[],
  cwd: string
): Promise<number> {
  try {
    return await launchDetached(executable, args, cwd)
  } catch (error) {
    if (process.platform !== 'win32' || !isWindowsElevationRequiredError(error)) throw error

    if (args.length === 0) {
      const shellError = await shell.openPath(executable)
      if (shellError) throw new Error(shellError)
      return 0
    }
    return launchElevatedWithPowerShell(executable, args, cwd)
  }
}

function providerLaunchArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw new Error('Invalid provider launch arguments')
  }
  let totalLength = 0
  const result: string[] = []
  for (const argument of value) {
    if (
      typeof argument !== 'string' ||
      argument.length > 2_048 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(argument)
    ) {
      throw new Error('Invalid provider launch arguments')
    }
    totalLength += argument.length + 1
    if (totalLength > 4_096) throw new Error('Invalid provider launch arguments')
    result.push(argument)
  }
  return result
}

function installedProviderExecutable(game: LibraryGame): { executable: string; cwd: string } {
  const installDir = game.installDir?.trim()
  const executable = game.metadata.launchExecutable?.trim()
  if (!installDir || !path.isAbsolute(installDir) || !existsSync(installDir)) {
    throw new Error('The game installation is no longer available')
  }
  if (!executable || !path.isAbsolute(executable) || !executable.toLowerCase().endsWith('.exe')) {
    throw new Error('The provider game executable is invalid')
  }
  const relativePath = path.relative(path.resolve(installDir), path.resolve(executable))
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    !existsSync(executable)
  ) {
    throw new Error('The provider game executable is no longer available')
  }
  return { executable, cwd: path.dirname(executable) }
}

function steamExecutable(game: LibraryGame): string | undefined {
  const candidates: string[] = []
  const installDir = game.installDir?.trim()
  if (installDir) {
    const normalized = installDir.replace(/\//g, '\\')
    const marker = '\\steamapps\\common\\'
    const markerIndex = normalized.toLowerCase().indexOf(marker)
    if (markerIndex > 0) candidates.push(path.join(normalized.slice(0, markerIndex), 'steam.exe'))
  }

  const steamPath = getSteamInstallPath()
  if (steamPath) candidates.push(path.join(steamPath, 'steam.exe'))

  const programFilesX86 = process.env['ProgramFiles(x86)']
  const programFiles = process.env.ProgramFiles
  if (programFilesX86) candidates.push(path.join(programFilesX86, 'Steam', 'steam.exe'))
  if (programFiles) candidates.push(path.join(programFiles, 'Steam', 'steam.exe'))
  candidates.push('C:\\Program Files (x86)\\Steam\\steam.exe')

  return candidates.find((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate))
}

async function installSteamGame(game: LibraryGame): Promise<GameInstallRequestState> {
  const appId = game.appId
  if (!appId) throw new Error('Invalid Steam app identifier')

  const fallbackUrl = `steam://install/${appId}`
  const executable = steamExecutable(game)
  if (!executable) {
    await shell.openExternal(fallbackUrl)
    return 'provider-opened'
  }

  try {
    const steamAppsDirectories = getSteamAppsDirectories()
    await launchDetached(
      executable,
      steamDirectInstallArguments(appId),
      path.dirname(executable),
      true
    )
    if (await waitForSteamInstallStart(appId, steamAppsDirectories)) return 'queued'
  } catch {
    // Steam's direct console command is intentionally best-effort. The public
    // protocol remains the reliable fallback when the client rejects it.
  }

  await shell.openExternal(fallbackUrl)
  return 'provider-opened'
}

export async function requestGameInstall(
  game: LibraryGame
): Promise<GameInstallRequestState> {
  if (!canRequestGameInstall(game)) throw new Error('Game cannot be installed through MT3K Launcher')

  if (game.provider === 'steam') return installSteamGame(game)

  if (game.provider === 'epic') {
    const id = epicGameId(game.providerGameId)
    await shell.openExternal(`com.epicgames.launcher://apps/${id}?action=install`)
    return 'provider-opened'
  }

  if (game.provider === 'xbox') {
    const productId = normalizeXboxProductId(
      game.metadata.providerStoreId ?? game.providerGameId
    )
    if ((await requestXboxProductInstall(productId)) === 'queued') {
      launcherDownloadMonitor.announceXboxInstallRequest(game, productId)
      return 'queued'
    }
    await shell.openExternal(`msxbox://game/?productId=${productId}`)
    return 'provider-opened'
  }

  const id = providerId(game.providerGameId, 'Ubisoft')
  await shell.openExternal(`uplay://install/${encodeURIComponent(id)}`)
  return 'provider-opened'
}

export async function requestGameUninstall(
  game: LibraryGame
): Promise<GameUninstallRequestState> {
  if (!canRequestGameUninstall(game)) {
    throw new Error('Game cannot be uninstalled through MT3K Launcher')
  }

  if (game.provider === 'steam') {
    await shell.openExternal(`steam://uninstall/${game.appId}`)
    return 'provider-opened'
  }

  await uninstallXboxPackage(game.metadata.providerPackageFamilyName as string)
  return 'completed'
}

/** Delegates launch/install actions to the owning local store client. */
export async function launchGame(game: LibraryGame): Promise<GameLaunchReceipt> {
  if (game.provider === 'local' && game.installed) {
    const executable = game.local?.executablePath?.trim()
    if (!executable || !executable.toLocaleLowerCase('en-US').endsWith('.exe') || !existsSync(executable)) {
      throw new Error('The custom game executable is no longer available')
    }
    const installDir = game.installDir?.trim()
    const cwd = installDir && existsSync(installDir) ? installDir : path.dirname(executable)
    const spawnedGamePid = await launchDetachedGame(
      executable,
      game.local?.launchArguments ?? [],
      cwd
    )
    return spawnedGamePid > 0 ? { spawnedGamePid } : {}
  }

  if (game.provider === 'steam' && game.appId) {
    if (game.installed) {
      const executable = steamExecutable(game)
      if (executable) {
        await launchDetached(executable, ['-silent', '-applaunch', String(game.appId)], undefined, true)
        return {}
      }
    } else {
      await installSteamGame(game)
      return {}
    }
    await shell.openExternal(`steam://rungameid/${game.appId}`)
    return {}
  }

  if (game.provider === 'epic') {
    const id = epicGameId(game.providerGameId)
    const action = game.installed ? 'launch&silent=true' : 'install'
    await shell.openExternal(`com.epicgames.launcher://apps/${id}?action=${action}`)
    return {}
  }

  if (game.provider === 'xbox') {
    if (game.installed) {
      const applicationId = installedXboxApplicationId(game)
      if (applicationId) {
        await launchWindowsApplication(applicationId)
        return {}
      }
    }

    const productId = normalizeXboxProductId(game.providerGameId)
    if ((await requestXboxProductInstall(productId)) === 'queued') {
      launcherDownloadMonitor.announceXboxInstallRequest(game, productId)
      return {}
    }

    // The Xbox app remains the supported fallback when Windows cannot queue
    // the product directly (for example because a license or drive choice is
    // required, or ORBIT is running without packaged app capabilities).
    await shell.openExternal(`msxbox://game/?productId=${productId}`)
    return {}
  }

  if (game.provider === 'gog' && game.installed) {
    const { executable, cwd } = installedProviderExecutable(game)
    const spawnedGamePid = await launchDetachedGame(
      executable,
      providerLaunchArguments(game.metadata.launchArguments ?? []),
      cwd
    )
    return spawnedGamePid > 0 ? { spawnedGamePid } : {}
  }

  if (game.provider === 'retro' && game.installed) {
    const retro = game.retro
    const executable = retro?.emulatorPath?.trim()
    const romPath = retro?.romPath?.trim()
    if (!retro || !executable || !executable.toLocaleLowerCase('en-US').endsWith('.exe')) {
      throw new Error('No compatible emulator is available for this ROM')
    }
    if (!existsSync(executable)) throw new Error('The assigned emulator is no longer available')
    if (!romPath || !existsSync(romPath)) throw new Error('The ROM file is no longer available')
    if (retro.corePath && !existsSync(retro.corePath)) {
      throw new Error('The assigned RetroArch core is no longer available')
    }
    // Solo RetroArch, y solo si el usuario prendió el menú. El helper
    // sale al instante cuando el toggle está apagado.
    if (retro.emulatorId === 'retroarch') {
      await ensureRetroArchNetworkCommands(executable)
    }
    const ensureFullscreenWithHotkey = await prepareRetroFullscreen(retro)
    const spawnedGamePid = await launchDetachedGame(
      executable,
      retroLaunchArguments(retro),
      path.dirname(executable)
    )
    return spawnedGamePid > 0 ? { spawnedGamePid, ensureFullscreenWithHotkey } : {}
  }

  if (game.provider === 'playstation') {
    const spawnedGamePid = await playStationRemotePlayService.launch()
    return spawnedGamePid && spawnedGamePid > 0 ? { spawnedGamePid } : {}
  }

  if (game.provider === 'ea' && game.installed) {
    const id = providerId(game.providerGameId, 'EA')
    await shell.openExternal(`origin2://game/launch?offerIds=${encodeURIComponent(id)}`)
    return {}
  }

  if (game.provider === 'ubisoft') {
    const id = providerId(game.providerGameId, 'Ubisoft')
    const action = game.installed ? `launch/${encodeURIComponent(id)}/0` : `install/${encodeURIComponent(id)}`
    await shell.openExternal(`uplay://${action}`)
    return {}
  }

  throw new Error('Game provider is not launchable')
}
