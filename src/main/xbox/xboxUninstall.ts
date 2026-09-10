import { execFile } from 'node:child_process'
import { normalizeXboxPackageFamilyName } from './xboxPackageIdentity'

const XBOX_UNINSTALL_SCRIPT = String.raw`
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$packageFamilyName = ([string]$env:ORBIT_XBOX_PACKAGE_FAMILY).Trim()
if ($packageFamilyName -notmatch '^[A-Za-z0-9.-]+_[A-Za-z0-9]+$') {
  [Console]::Out.Write('failed')
  exit 0
}

try {
  $packages = @(Get-AppxPackage | Where-Object {
    ([string]$_.PackageFamilyName).Equals($packageFamilyName, [StringComparison]::OrdinalIgnoreCase)
  })
  if ($packages.Count -eq 0) {
    [Console]::Out.Write('missing')
    exit 0
  }
  foreach ($package in $packages) {
    Remove-AppxPackage -Package ([string]$package.PackageFullName) -ErrorAction Stop
  }
  [Console]::Out.Write('removed')
} catch {
  [Console]::Out.Write('failed')
}
`

export type XboxUninstallState = 'removed' | 'missing'

export function uninstallXboxPackage(packageFamilyNameValue: string): Promise<XboxUninstallState> {
  const packageFamilyName = normalizeXboxPackageFamilyName(packageFamilyNameValue)
  if (!packageFamilyName) throw new Error('Invalid Xbox package family')
  if (process.platform !== 'win32') throw new Error('Xbox uninstall is available on Windows only')

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', XBOX_UNINSTALL_SCRIPT],
      {
        windowsHide: true,
        timeout: 20 * 60_000,
        encoding: 'utf8',
        env: { ...process.env, ORBIT_XBOX_PACKAGE_FAMILY: packageFamilyName }
      },
      (error, stdout) => {
        const state = stdout.trim()
        if (!error && (state === 'removed' || state === 'missing')) resolve(state)
        else reject(new Error('Xbox could not uninstall this game'))
      }
    )
  })
}
