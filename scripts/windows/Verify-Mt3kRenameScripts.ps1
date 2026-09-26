# Cross-platform parser and pure-helper checks. Does not register packages or
# touch the registry. Run with pwsh on macOS or powershell on Windows.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$files = @('Register-Mt3kLauncherXboxMode.ps1', 'Register-OrbitMt3kXboxMode.ps1',
  'Build-OrbitXboxPackage.ps1', 'Install-OrbitXboxMode.ps1',
  'Verify-OrbitRelease.ps1', 'Verify-OrbitXboxPackage.ps1')
foreach ($file in $files) {
  $parseErrors = $null; $tokens = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "$file : $($parseErrors[0].Message)" }
}
$text = Get-Content (Join-Path $root 'src/main/appUpdateService.ts') -Raw
$script = [regex]::Match($text, '(?s)const COMMUNITY_PACKAGE_UPDATE_SCRIPT = String.raw`(.*?)`').Groups[1].Value
if (!$script) { throw 'Updater script not found' }
$parseErrors = $null; $tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($script, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Updater: $($parseErrors[0].Message)" }
$helper = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Resolve-LauncherExe' }, $true)
. ([scriptblock]::Create($helper.Extent.Text))
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('mt3k-exe-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory $temp | Out-Null
  if ($null -ne (Resolve-LauncherExe $temp)) { throw 'Empty archive accepted' }
  New-Item -ItemType File (Join-Path $temp 'ORBIT.exe') | Out-Null
  if ((Resolve-LauncherExe $temp) -ne 'ORBIT.exe') { throw 'Old-only archive rejected' }
  New-Item -ItemType File (Join-Path $temp 'MT3KLauncher.exe') | Out-Null
  if ((Resolve-LauncherExe $temp) -ne 'MT3KLauncher.exe') { throw 'New exe not preferred' }
  Remove-Item (Join-Path $temp 'ORBIT.exe')
  if ((Resolve-LauncherExe $temp) -ne 'MT3KLauncher.exe') { throw 'New-only archive rejected' }
} finally { Remove-Item $temp -Recurse -Force }
Write-Host 'PASS: six Windows scripts and embedded updater parse; actual archive helper accepts either executable and prefers MT3KLauncher.exe'

# Compile the C# source in memory on this host; Windows CI produces the winexe.
Add-Type -Path (Join-Path $root 'scripts/mt3k/LegacyLauncher.cs')
$type = [AppDomain]::CurrentDomain.GetAssemblies() | ForEach-Object { $_.GetType('LegacyLauncher', $false) } | Where-Object { $_ } | Select-Object -First 1
$quote = $type.GetMethod('Quote', [System.Reflection.BindingFlags]'NonPublic,Static')
foreach ($case in @(
  @('', '""'),
  @('plain', '"plain"'),
  @('a b', '"a b"'),
  @('a"b', '"a\"b"'),
  @('C:\trailing\', '"C:\trailing\\"')
)) {
  $actual = $quote.Invoke($null, @($case[0]))
  if ($actual -cne $case[1]) { throw "Stub quoting failed for $($case[0]): $actual" }
}
Write-Host 'PASS: C# source compiles; stub quoting preserves empty arguments, spaces, quotes and trailing backslashes'

# Exercise the actual in-place refresh with AppX cmdlets mocked. This verifies
# filesystem/XML behavior, not Windows deployment, package identity or WMI.
$stageFixture = Join-Path ([System.IO.Path]::GetTempPath()) ('mt3k-manifest-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory (Join-Path $stageFixture 'app') -Force | Out-Null
  New-Item -ItemType File (Join-Path $stageFixture 'app/MT3KLauncher.exe') | Out-Null
  New-Item -ItemType File (Join-Path $stageFixture 'app/ORBIT.exe') | Out-Null
  $manifestPath = Join-Path $stageFixture 'AppxManifest.xml'
  $original = (Get-Content (Join-Path $root 'build/xbox/AppxManifest.xml') -Raw).Replace('ORBIT.GamingHome', 'MT3K.OrbitGamingHome')
  [System.IO.File]::WriteAllText($manifestPath, $original)
  function Get-AppxPackage { param($Name) [pscustomobject]@{ InstallLocation = $stageFixture; PackageFamilyName = 'MT3K.OrbitGamingHome_123456789abcd' } }
  function Add-AppxPackage { param($Register) if ($global:mt3kTestFailDeployment) { throw 'Simulated deployment error' }; $global:mt3kTestRegisteredManifest = $Register }
  function Remove-AppxPackage { throw 'Refresh must not remove the package' }
  function Get-CimInstance { throw 'Refresh must not stop/copy the staged app' }
  $global:mt3kTestFailDeployment = $false
  & (Join-Path $PSScriptRoot 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -OnlyIfRegistered -RefreshManifestOnly
  if ($LASTEXITCODE -ne 0) { throw 'Refresh failed' }
  [xml]$updated = Get-Content $manifestPath -Raw
  if (@($updated.Package.Applications.Application)[0].Executable -ne 'app\MT3KLauncher.exe') { throw 'Manifest executable did not change' }
  if (@($updated.Package.Applications.Application)[0].Id -ne 'ORBIT' -or $updated.Package.Identity.Name -ne 'MT3K.OrbitGamingHome') { throw 'Identity changed' }
  if ($global:mt3kTestRegisteredManifest -ne $manifestPath) { throw 'Wrong manifest registered' }
  [System.IO.File]::WriteAllText($manifestPath, $original)
  $global:mt3kTestFailDeployment = $true
  & (Join-Path $PSScriptRoot 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -OnlyIfRegistered -RefreshManifestOnly
  if ($LASTEXITCODE -ne 1) { throw 'Deployment failure was not propagated' }
  if ((Get-Content $manifestPath -Raw) -cne $original) { throw 'Original manifest was not restored' }
} finally {
  Remove-Item $stageFixture -Recurse -Force
  Remove-Variable mt3kTestFailDeployment, mt3kTestRegisteredManifest -Scope Global -ErrorAction SilentlyContinue
  Remove-Item Function:Get-AppxPackage, Function:Add-AppxPackage, Function:Remove-AppxPackage, Function:Get-CimInstance
}
Write-Host 'PASS: actual manifest refresh preserves identity, avoids restaging and restores the manifest on simulated deployment failure'
exit 0
