# ORBIT MT3K Edition: register the installed build as an Xbox Mode home app.
#
# Windows only lists packaged apps that declare the Gaming Home extension.
# The official signed package belongs to the upstream author, so this script
# registers an unsigned copy under its own identity using Developer Mode.
#
# Requirements: Windows 11 24H2+, Developer Mode on, ORBIT MT3K installed.
# The MT3K installer ships this script in resources\xbox-mode and runs it when
# setup finishes. To run it by hand, from a normal PowerShell window on the
# device (not over SSH):
#   powershell -ExecutionPolicy Bypass -File scripts\windows\Register-OrbitMt3kXboxMode.ps1
# Undo:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\Register-OrbitMt3kXboxMode.ps1 -Remove
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
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$packageName = 'MT3K.OrbitGamingHome'
$displayName = 'ORBIT MT3K'

function Write-Step([string]$Message) {
  Write-Host $Message
  if ($LogPath) { Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format s) $Message" -Encoding UTF8 }
}

function Stop-StagedOrbit {
  if (!(Test-Path -LiteralPath $Stage)) { return }
  $prefix = [System.IO.Path]::GetFullPath($Stage).TrimEnd('\') + '\'
  Get-CimInstance Win32_Process -Filter "Name = 'ORBIT.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Resolve-OrbitSource {
  if ($Source) { $candidates = @($Source) }
  else {
    # Installed copy: <install>\resources\xbox-mode\this.ps1. Repository copy: scripts\windows\this.ps1.
    $candidates = @(
      (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
      (Join-Path $env:LOCALAPPDATA 'Programs\ORBIT'),
      (Join-Path $env:ProgramFiles 'ORBIT')
    )
  }
  $found = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'ORBIT.exe')) } | Select-Object -First 1
  if (!$found) { throw 'ORBIT MT3K is not installed. Install ORBIT-MT3K-Setup first, or pass -Source <folder with ORBIT.exe>.' }
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

try {
  $existing = @(Get-AppxPackage -Name $packageName)
  if ($OnlyIfRegistered -and !$Remove -and $existing.Count -eq 0) {
    Write-Step 'ORBIT MT3K is not registered for Xbox Mode; nothing to refresh.'
    exit 3
  }

  if (!$Remove) {
    # Validate everything before touching an existing registration.
    $devMode = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
    if (!$devMode -or $devMode.PSObject.Properties['AllowDevelopmentWithoutDevLicense'] -eq $null -or $devMode.AllowDevelopmentWithoutDevLicense -ne 1) {
      throw 'Developer Mode is off. Turn it on in Settings > System > For developers, then run this script again.'
    }
    $Source = Resolve-OrbitSource
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
    Write-Step 'ORBIT MT3K Xbox Mode registration removed.'
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
  $identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $ns)
  $identity.SetAttribute('Name', $packageName)
  $identity.SetAttribute('Publisher', 'CN=MT3K Edition')
  $identity.SetAttribute('Version', $packageVersion)
  $manifest.SelectSingleNode('/f:Package/f:Properties/f:DisplayName', $ns).InnerText = $displayName
  $manifest.SelectSingleNode('/f:Package/f:Properties/f:PublisherDisplayName', $ns).InnerText = 'MT3K Edition'
  $manifest.SelectSingleNode('//uap:VisualElements', $ns).SetAttribute('DisplayName', $displayName)
  $extension = $manifest.SelectSingleNode("//uap3:AppExtension[@Name='windows.gamingApp']", $ns)
  $extension.SetAttribute('DisplayName', $displayName)
  $extension.SetAttribute('Description', 'ORBIT MT3K Edition Gaming Home')
  $manifest.Save((Join-Path $Stage 'AppxManifest.xml'))

  $registration = [ordered]@{ schemaVersion = 1; product = 'ORBIT'; role = 'gaming-home'; applicationId = 'ORBIT'; version = $packageVersion; channel = 'stable' }
  $registration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Stage 'Public\registration.json') -Encoding UTF8

  Write-Step "Registering $packageName $packageVersion"
  Add-AppxPackage -Register (Join-Path $Stage 'AppxManifest.xml')
  $registered = Get-AppxPackage -Name $packageName
  if (!$registered) { throw 'Windows did not report the registration.' }
  Write-Step "Registered $($registered.PackageFullName) at $($registered.InstallLocation)"
  Write-Step 'Done. Open Settings > Gaming > Xbox mode > Choose home app and pick ORBIT MT3K.'
  exit 0
} catch {
  Write-Step "Failed: $($_.Exception.Message)"
  exit 1
}
