param([switch]$Launch)
$ErrorActionPreference = 'Stop'
$hudRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$latest = Get-Content -LiteralPath (Join-Path $hudRoot 'artifacts/latest-build.json') -Raw | ConvertFrom-Json
$packageDirectory = [IO.Path]::GetFullPath($latest.packageDirectory)
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $hudRoot 'artifacts')) + [IO.Path]::DirectorySeparatorChar
if (-not $packageDirectory.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'HUD package must be inside this project artifacts directory.' }
$manifestPath = Join-Path $packageDirectory 'AppxManifest.xml'
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
if ($manifest.Package.Identity.Name -ne 'OrbitHud.Preview' -or $manifest.Package.Identity.Publisher -ne 'CN=Orbit HUD Preview') { throw 'Unexpected preview package identity.' }
$dev = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' -ErrorAction SilentlyContinue
if (-not $dev -or $dev.AllowDevelopmentWithoutDevLicense -ne 1) { throw 'Developer Mode must already be enabled to register an unsigned preview. This script will not change it.' }
Add-AppxPackage -Register $manifestPath -ForceApplicationShutdown
$package = Get-AppxPackage -Name 'OrbitHud.Preview'
if (-not $package) { throw 'HUD preview registration could not be verified.' }
if ([IO.Path]::GetFullPath($package.InstallLocation) -ne $packageDirectory) { throw 'Windows retained an older HUD build. Build a new preview revision before registering again.' }
Write-Output "Registered separately: $($package.PackageFamilyName)"
Write-Output 'Open Game Bar (Win+G), then Widgets > ORBIT HUD.'
if ($Launch) { Start-Process -FilePath 'explorer.exe' -ArgumentList "shell:AppsFolder\$($package.PackageFamilyName)!App" -WindowStyle Hidden }
