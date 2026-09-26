# MT3K Launcher: register the installed build as an Xbox Mode home app.
#
# Windows only lists packaged apps that declare the Gaming Home extension.
# ORBIT's signed package belongs to its author, so this script registers an
# unsigned copy under MT3K Launcher's own identity using Developer Mode.
#
# Requirements: Windows 11 24H2+, Developer Mode on, MT3K Launcher installed.
# The installer ships this script in resources\xbox-mode and runs it when
# setup finishes. To run it by hand, from a normal PowerShell window on the
# device (not over SSH):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\Register-Mt3kLauncherXboxMode.ps1
# Undo:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\Register-Mt3kLauncherXboxMode.ps1 -Remove
#
# Exit codes: 0 done, 1 failed, 3 skipped (-OnlyIfRegistered and nothing registered).
[CmdletBinding()]
param(
  [string]$Source,
  [string]$AssetsRoot,
  [string]$Stage = (Join-Path $env:LOCALAPPDATA 'ORBIT-MT3K-XboxMode'),
  [string]$Version,
  [string]$LogPath,
  [switch]$OnlyIfRegistered,
  [switch]$RefreshManifestOnly,
  [int]$WaitForProcessId,
  [switch]$Relaunch,
  [string]$RecoveryAumid,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$packageName = 'MT3K.OrbitGamingHome'
$displayName = 'MT3K Launcher'

function Write-Step([string]$Message) {
  Write-Host $Message
  if ($LogPath) { Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format s) $Message" -Encoding UTF8 }
}

function Stop-StagedOrbit {
  if (!(Test-Path -LiteralPath $Stage)) { return }
  $prefix = [System.IO.Path]::GetFullPath($Stage).TrimEnd('\') + '\'
  Get-CimInstance Win32_Process -Filter "Name = 'ORBIT.exe' OR Name = 'MT3KLauncher.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Resolve-OrbitSource {
  if ($Source) { $candidates = @($Source) }
  else {
    # Installed copy: <install>\resources\xbox-mode\this.ps1. Repository copy: scripts\windows\this.ps1.
    $candidates = @(
      (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
      (Join-Path $env:LOCALAPPDATA 'Programs\MT3K Launcher'),
      (Join-Path $env:ProgramFiles 'MT3K Launcher'),
      (Join-Path $env:LOCALAPPDATA 'Programs\ORBIT'),
      (Join-Path $env:ProgramFiles 'ORBIT')
    )
  }
  $found = $candidates | Where-Object { $_ -and ((Test-Path -LiteralPath (Join-Path $_ 'MT3KLauncher.exe')) -or (Test-Path -LiteralPath (Join-Path $_ 'ORBIT.exe'))) } | Select-Object -First 1
  if (!$found) { throw 'MT3K Launcher is not installed. Install MT3K-Launcher-Setup first, or pass -Source <folder with MT3KLauncher.exe or ORBIT.exe>.' }
  return [System.IO.Path]::GetFullPath($found)
}

function Resolve-PackageVersion([string]$OrbitRoot) {
  if ($Version) { return $Version }
  $releaseManifest = Join-Path $OrbitRoot 'resources\release-manifest.json'
  if (Test-Path -LiteralPath $releaseManifest) {
    $json = Get-Content -LiteralPath $releaseManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $property = $json.PSObject.Properties['windowsFileVersion']
    if ($property -and "$($property.Value)" -match '^\d+\.\d+\.\d+\.\d+$') { return "$($property.Value)" }
  }
  return '0.1.4.1'
}

$refreshHandled = $false
try {
  $existing = @(Get-AppxPackage -Name $packageName)
  if (($OnlyIfRegistered -or $RefreshManifestOnly) -and !$Remove -and $existing.Count -eq 0) {
    Write-Step 'MT3K Launcher is not registered for Xbox Mode; nothing to refresh.'
    if ($RefreshManifestOnly) { exit 0 }
    exit 3
  }

  # Once the caller exits every refresh outcome must bring back the same AUMID.
  # Failures retain the stub manifest and a build-scoped marker; no automatic loop.
  if ($RefreshManifestOnly) {
    $originalManifest = $null
    $manifestPath = $null
    $refreshSucceeded = $false
    try {
      if ($existing.Count -ne 1) { throw 'Expected one existing Xbox Mode registration.' }
      $Stage = $existing[0].InstallLocation
      if ($WaitForProcessId -gt 0) { Wait-Process -Id $WaitForProcessId -ErrorAction SilentlyContinue }
      $manifestPath = Join-Path $Stage 'AppxManifest.xml'
      $originalManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
      [xml]$manifest = $originalManifest
      $application = @($manifest.Package.Applications.Application)[0]
      $exe = @('MT3KLauncher.exe', 'ORBIT.exe') | Where-Object { Test-Path -LiteralPath (Join-Path $Stage "app\$_") } | Select-Object -First 1
      if (!$exe) { throw 'No launcher executable in registered package.' }
      $application.SetAttribute('Executable', "app\$exe")
      $manifest.Save($manifestPath)
      Add-AppxPackage -Register $manifestPath
      $refreshSucceeded = $true
      Remove-Item -LiteralPath (Join-Path $Stage 'app/manifest-refresh.failed') -Force -ErrorAction SilentlyContinue
      Write-Step "Xbox Mode manifest refreshed: app\$exe"
    } catch {
      $refreshError = $_
      try {
        if ($originalManifest -and $manifestPath) {
          [System.IO.File]::WriteAllText($manifestPath, $originalManifest, [System.Text.UTF8Encoding]::new($false))
        }
      } catch { Write-Step "Manifest restore failed: $($_.Exception.Message)" }
      try {
        Set-Content -LiteralPath (Join-Path $Stage 'app/manifest-refresh.failed') -Value $refreshError.Exception.Message -Encoding UTF8
      } catch { Write-Step "Failure marker could not be written: $($_.Exception.Message)" }
      Write-Step "Manifest refresh failed; retaining stub: $($refreshError.Exception.Message)"
    } finally {
      # Success launches the new exe; failure launches the restored stub. Wait even
      # on preflight failure so activation cannot be swallowed by the exiting app.
      $refreshHandled = $true
      if ($Relaunch) {
        if ($WaitForProcessId -gt 0) { Wait-Process -Id $WaitForProcessId -ErrorAction SilentlyContinue }
        $aumid = if ($RecoveryAumid -match '^MT3K\.OrbitGamingHome_[a-z0-9]{13}!ORBIT$') { $RecoveryAumid } else { $existing[0].PackageFamilyName + '!ORBIT' }
        Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$aumid"
      }
    }
    if ($refreshSucceeded) { exit 0 }
    exit 1
  }

  if (!$Remove) {
    # Validate everything before touching an existing registration.
    $devMode = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
    if (!$devMode -or $devMode.PSObject.Properties['AllowDevelopmentWithoutDevLicense'] -eq $null -or $devMode.AllowDevelopmentWithoutDevLicense -ne 1) {
      throw 'Developer Mode is off. Turn it on in Settings > System > For developers, then run this script again.'
    }
    $Source = Resolve-OrbitSource
    $launcherExe = if (Test-Path -LiteralPath (Join-Path $Source 'MT3KLauncher.exe')) { 'MT3KLauncher.exe' } else { 'ORBIT.exe' }
    if ([System.IO.Path]::GetFullPath($Source).StartsWith([System.IO.Path]::GetFullPath($Stage).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Use -RefreshManifestOnly for a staged source.' }
    if (!$AssetsRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'AppxManifest.xml'))) { $AssetsRoot = $PSScriptRoot }
    if ($AssetsRoot) {
      $manifestTemplate = Join-Path $AssetsRoot 'AppxManifest.xml'
      $capability = Join-Path $AssetsRoot 'CustomCapability.SCCD'
      $logos = Join-Path $AssetsRoot 'appx'
    } else {
      $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
      $manifestTemplate = Join-Path $repo 'build\xbox\AppxManifest.xml'
      $capability = Join-Path $repo 'build\xbox\CustomCapability.SCCD'
      $logos = Join-Path $repo 'build\appx'
    }
    foreach ($required in $manifestTemplate, $capability, (Join-Path $logos 'StoreLogo.png')) {
      if (!(Test-Path -LiteralPath $required)) { throw "Missing $required. Run this script from the installed ORBIT or a copy of the repository." }
    }
    $packageVersion = Resolve-PackageVersion $Source
  }

  Stop-StagedOrbit
  foreach ($pkg in $existing) {
    Write-Step "Removing previous registration $($pkg.PackageFullName)"
    Remove-AppxPackage -Package $pkg.PackageFullName
  }
  if ($Remove) {
    if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
    Write-Step 'MT3K Launcher Xbox Mode registration removed.'
    exit 0
  }

  Write-Step "Staging $Source into $Stage"
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
  foreach ($dir in 'app', 'assets', 'Public') { New-Item -ItemType Directory -Force -Path (Join-Path $Stage $dir) | Out-Null }
  Copy-Item -Path (Join-Path $Source '*') -Destination (Join-Path $Stage 'app') -Recurse -Force
  Copy-Item -Path (Join-Path $logos '*') -Destination (Join-Path $Stage 'assets') -Recurse -Force
  Copy-Item -LiteralPath $capability -Destination (Join-Path $Stage 'CustomCapability.SCCD') -Force

  [xml]$manifest = Get-Content -LiteralPath $manifestTemplate -Raw -Encoding UTF8
  $ns = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
  $ns.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
  $ns.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
  $manifest.SelectSingleNode('/f:Package/f:Applications/f:Application', $ns).SetAttribute('Executable', "app\$launcherExe")
  $identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $ns)
  $identity.SetAttribute('Name', $packageName)
  $identity.SetAttribute('Publisher', 'CN=MT3K Edition')
  $identity.SetAttribute('Version', $packageVersion)
  $manifest.SelectSingleNode('/f:Package/f:Properties/f:DisplayName', $ns).InnerText = $displayName
  $manifest.SelectSingleNode('/f:Package/f:Properties/f:PublisherDisplayName', $ns).InnerText = 'MT3K'
  $manifest.SelectSingleNode('/f:Package/f:Properties/f:Description', $ns).InnerText = 'MT3K Launcher, a controller-first gaming launcher based on ORBIT'
  $manifest.SelectSingleNode('//uap:VisualElements', $ns).SetAttribute('DisplayName', $displayName)
  $manifest.SelectSingleNode('//uap:VisualElements', $ns).SetAttribute('Description', 'MT3K Launcher, a controller-first gaming launcher based on ORBIT')
  $extension = $manifest.SelectSingleNode("//uap3:AppExtension[@Name='windows.gamingApp']", $ns)
  $extension.SetAttribute('DisplayName', $displayName)
  $extension.SetAttribute('Description', 'MT3K Launcher Gaming Home')
  $manifest.Save((Join-Path $Stage 'AppxManifest.xml'))

  # product is a protocol discriminator checked by Install/Verify-OrbitXboxPackage;
  # applicationId is the persistent AUMID. Neither is display copy.
  $registration = [ordered]@{ schemaVersion = 1; product = 'ORBIT'; role = 'gaming-home'; applicationId = 'ORBIT'; version = $packageVersion; channel = 'stable' }
  $registration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Stage 'Public\registration.json') -Encoding UTF8

  Write-Step "Registering $packageName $packageVersion"
  Add-AppxPackage -Register (Join-Path $Stage 'AppxManifest.xml')
  $registered = Get-AppxPackage -Name $packageName
  if (!$registered) { throw 'Windows did not report the registration.' }
  Write-Step "Registered $($registered.PackageFullName) at $($registered.InstallLocation)"
  Write-Step 'Done. Open Settings > Gaming > Xbox mode > Choose home app and pick MT3K Launcher.'
  exit 0
} catch {
  # Get-AppxPackage itself can fail before the refresh block. The parent passes
  # its verified stage/AUMID so that failure also gets a sticky marker/recovery.
  if ($RefreshManifestOnly -and !$refreshHandled) {
    try { Set-Content -LiteralPath (Join-Path $Stage 'app/manifest-refresh.failed') -Value $_.Exception.Message -Encoding UTF8 }
    catch { Write-Warning "Failure marker could not be written: $($_.Exception.Message)" }
    if ($Relaunch -and $RecoveryAumid -match '^MT3K\.OrbitGamingHome_[a-z0-9]{13}!ORBIT$') {
      if ($WaitForProcessId -gt 0) { Wait-Process -Id $WaitForProcessId -ErrorAction SilentlyContinue }
      Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$RecoveryAumid"
    }
  }
  Write-Step "Failed: $($_.Exception.Message)"
  exit 1
}
