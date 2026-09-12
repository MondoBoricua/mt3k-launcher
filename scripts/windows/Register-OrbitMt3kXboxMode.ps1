# ORBIT MT3K Edition: register the installed build as an Xbox Mode home app.
#
# Windows only lists packaged apps that declare the Gaming Home extension.
# The official signed package belongs to the upstream author, so this script
# registers an unsigned copy under its own identity using Developer Mode.
#
# Requirements: Windows 11 24H2+, Developer Mode on, ORBIT MT3K installed.
# Run from a normal PowerShell window on the device (not over SSH).
#   powershell -ExecutionPolicy Bypass -File scripts\windows\Register-OrbitMt3kXboxMode.ps1
# Undo:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\Register-OrbitMt3kXboxMode.ps1 -Remove
[CmdletBinding()]
param(
  [string]$Source,
  [string]$Stage = (Join-Path $env:LOCALAPPDATA 'ORBIT-MT3K-XboxMode'),
  [string]$Version = '0.1.4.1',
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$packageName = 'MT3K.OrbitGamingHome'
$displayName = 'ORBIT MT3K'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

foreach ($pkg in @(Get-AppxPackage -Name $packageName)) {
  Write-Host "Removing previous registration $($pkg.PackageFullName)"
  Remove-AppxPackage -Package $pkg.PackageFullName
}
if ($Remove) {
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
  Write-Host 'ORBIT MT3K Xbox Mode registration removed.'
  return
}

$devMode = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
if (!$devMode -or $devMode.PSObject.Properties['AllowDevelopmentWithoutDevLicense'] -eq $null -or $devMode.AllowDevelopmentWithoutDevLicense -ne 1) {
  throw 'Developer Mode is off. Turn it on in Settings > System > For developers, then run this script again.'
}
if (!$Source) {
  $Source = @(
    (Join-Path $env:ProgramFiles 'ORBIT'),
    (Join-Path $env:LOCALAPPDATA 'Programs\ORBIT')
  ) | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'ORBIT.exe') } | Select-Object -First 1
}
if (!$Source -or !(Test-Path -LiteralPath (Join-Path $Source 'ORBIT.exe'))) {
  throw 'ORBIT MT3K is not installed. Install ORBIT-MT3K-Setup first, or pass -Source <folder with ORBIT.exe>.'
}
foreach ($required in 'build\xbox\AppxManifest.xml', 'build\xbox\CustomCapability.SCCD', 'build\appx\StoreLogo.png') {
  if (!(Test-Path -LiteralPath (Join-Path $repo $required))) { throw "Missing $required. Run this script from a copy of the repository." }
}

Write-Host "Staging $Source into $Stage"
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
foreach ($dir in 'app', 'assets', 'Public') { New-Item -ItemType Directory -Force -Path (Join-Path $Stage $dir) | Out-Null }
Copy-Item -Path (Join-Path $Source '*') -Destination (Join-Path $Stage 'app') -Recurse -Force
Copy-Item -Path (Join-Path $repo 'build\appx\*') -Destination (Join-Path $Stage 'assets') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repo 'build\xbox\CustomCapability.SCCD') -Destination (Join-Path $Stage 'CustomCapability.SCCD') -Force

[xml]$manifest = Get-Content -LiteralPath (Join-Path $repo 'build\xbox\AppxManifest.xml') -Raw -Encoding UTF8
$ns = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
$ns.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
$ns.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
$identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $ns)
$identity.SetAttribute('Name', $packageName)
$identity.SetAttribute('Publisher', 'CN=MT3K Edition')
$identity.SetAttribute('Version', $Version)
$manifest.SelectSingleNode('/f:Package/f:Properties/f:DisplayName', $ns).InnerText = $displayName
$manifest.SelectSingleNode('/f:Package/f:Properties/f:PublisherDisplayName', $ns).InnerText = 'MT3K Edition'
$manifest.SelectSingleNode('//uap:VisualElements', $ns).SetAttribute('DisplayName', $displayName)
$extension = $manifest.SelectSingleNode("//uap3:AppExtension[@Name='windows.gamingApp']", $ns)
$extension.SetAttribute('DisplayName', $displayName)
$extension.SetAttribute('Description', 'ORBIT MT3K Edition Gaming Home')
$manifest.Save((Join-Path $Stage 'AppxManifest.xml'))

$registration = [ordered]@{ schemaVersion = 1; product = 'ORBIT'; role = 'gaming-home'; applicationId = 'ORBIT'; version = $Version; channel = 'stable' }
$registration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Stage 'Public\registration.json') -Encoding UTF8

Write-Host "Registering $packageName"
Add-AppxPackage -Register (Join-Path $Stage 'AppxManifest.xml')
Get-AppxPackage -Name $packageName | Format-List Name, Version, IsDevelopmentMode, InstallLocation
Write-Host 'Done. Open Settings > Gaming > Xbox mode > Choose home app and pick ORBIT MT3K.'
