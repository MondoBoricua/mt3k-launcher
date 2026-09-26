import { launchXboxManifestRefresh } from './xboxManifestRefreshPolicy'
import { app } from 'electron'
import { readFile, access, mkdir } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** The pre-rename helper launches the persistent AUMID through ORBIT.exe.
 * Repair in a detached WMI process, then restart through that same identity.
 * Never restage from inside the stage (that would delete the running build). */
export async function refreshLegacyXboxManifest(): Promise<boolean> {
  if (process.platform !== 'win32' || !app.isPackaged) return false
  const root = dirname(dirname(process.execPath))
  const manifestPath = join(root, 'AppxManifest.xml')
  try {
    try {
      await access(join(root, 'app', 'manifest-refresh.failed'))
      console.warn('[migration] Previous Xbox refresh failed; keeping stub until an install/update replaces this build')
      return false
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const manifest = await readFile(manifestPath, 'utf8')
    if (!/Name="MT3K\.OrbitGamingHome"/i.test(manifest)) return false
    const executable = /<Application\s[^>]*Executable="([^"]+)"/i.exec(manifest)?.[1]
    if (!executable || executable.replace(/\\/g, '/').split('/').pop()?.toLowerCase() === basename(process.execPath).toLowerCase()) return false
    const script = join(process.resourcesPath, 'xbox-mode', 'Register-Mt3kLauncherXboxMode.ps1')
    await access(script)
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const quote = (value: string): string => {
      if (/["\r\n\0]/u.test(value)) throw new Error('Unsafe helper path')
      return `"${value}"`
    }
    await mkdir(join(app.getPath('userData'), 'logs'), { recursive: true })
    const command = `${quote(powershell)} -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ${quote(script)} -OnlyIfRegistered -RefreshManifestOnly -Stage ${quote(root)} -WaitForProcessId ${process.pid} -Relaunch -LogPath ${quote(join(app.getPath('userData'), 'logs', 'xbox-manifest-refresh.log'))}`
    // Confirm the on-disk manifest belongs to the user's registered stage before
    // exiting. A copied or stale stage must not restart a different installation.
    const registeredRoot = root.replace(/'/g, "''")
    const escapedCommand = command.replace(/'/g, "''")
    // Pass the already verified AUMID so even a later AppX lookup failure can
    // recover the window after this process exits.
    const launchScript = `$ErrorActionPreference = 'Stop'; $packages = @(Get-AppxPackage -Name 'MT3K.OrbitGamingHome'); if ($packages.Count -ne 1 -or $packages[0].InstallLocation -ne '${registeredRoot}') { throw 'Stage is not registered' }; $family = $packages[0].PackageFamilyName; if ($family -notmatch '^MT3K\\.OrbitGamingHome_[a-z0-9]{13}$') { throw 'Unexpected package family' }; $command = '${escapedCommand}' + ' -RecoveryAumid ' + $family + '!ORBIT'; $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command }; if ($r.ReturnValue -ne 0) { exit (100 + [int]$r.ReturnValue) }; [Console]::Out.Write([string]$r.ProcessId); exit 0`
    await launchXboxManifestRefresh(
      () => promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', launchScript], { windowsHide: true, timeout: 15_000 }),
      () => {
        console.warn('[migration] Xbox manifest refresh scheduled; restarting through unchanged AUMID')
        app.quit()
      }
    )
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[migration] Xbox manifest refresh failed; stub remains usable', error)
    return false
  }
}
