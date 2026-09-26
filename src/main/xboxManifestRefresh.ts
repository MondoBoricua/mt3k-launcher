import { app } from 'electron'
import { readFile, access, unlink, mkdir } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { wmiCreateProcessScript } from '../shared/appUpdatePolicy'

/** The pre-rename helper launches the persistent AUMID through ORBIT.exe.
 * Repair in a detached WMI process, then restart through that same identity.
 * Never restage from inside the stage (that would delete the running build). */
export async function refreshLegacyXboxManifest(): Promise<boolean> {
  if (process.platform !== 'win32' || !app.isPackaged) return false
  const root = dirname(dirname(process.execPath))
  const manifestPath = join(root, 'AppxManifest.xml')
  try {
    try {
      await unlink(join(root, 'manifest-refresh.failed'))
      console.warn('[migration] Previous Xbox refresh failed; deferring retry until next launch')
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
    const command = `${quote(powershell)} -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ${quote(script)} -OnlyIfRegistered -RefreshManifestOnly -WaitForProcessId ${process.pid} -Relaunch -LogPath ${quote(join(app.getPath('userData'), 'logs', 'xbox-manifest-refresh.log'))}`
    // Confirm the on-disk manifest belongs to the user's registered stage before
    // exiting. A copied or stale stage must not restart a different installation.
    const registeredRoot = root.replace(/'/g, "''")
    const launchScript = `$ErrorActionPreference = 'Stop'; $package = Get-AppxPackage -Name 'MT3K.OrbitGamingHome'; if (!$package -or $package.InstallLocation -ne '${registeredRoot}') { throw 'Stage is not registered' }; ${wmiCreateProcessScript(command)}`
    const result = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', launchScript], { windowsHide: true, timeout: 15_000 })
    if (!/^[1-9]\d*$/.test(result.stdout.trim())) throw new Error('WMI returned no refresh process ID')
    console.warn('[migration] Xbox manifest refresh scheduled; restarting through unchanged AUMID')
    app.quit()
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[migration] Xbox manifest refresh failed; stub remains usable', error)
    return false
  }
}
