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

# Run the exact NSIS probe with process/sleep mocks in child PowerShell hosts.
# No executable is launched by the probe; a framework assembly stands in for
# the managed stub, and this host's native executable for pre-rename Electron.
$installerText = Get-Content (Join-Path $root 'build/installer.nsh') -Raw
$probe = [regex]::Match($installerText, 'nsExec::ExecToStack.*?-Command "([^"\r\n]+)"').Groups[1].Value.Replace('$$', '$')
if (!$probe) { throw 'NSIS shutdown probe not found' }
$probeFile = Join-Path ([IO.Path]::GetTempPath()) ('mt3k-shutdown-' + [guid]::NewGuid().ToString('N') + '.ps1')
$previousExe = $env:MT3K_SHUTDOWN_EXE
$hostExe = (Get-Process -Id $PID).Path
try {
  foreach ($case in @(
    @{ Name = 'stub already stopped'; Exe = [object].Assembly.Location; Busy = 0; Exit = 10; Sleeps = 0 },
    @{ Name = 'stub child stops'; Exe = [object].Assembly.Location; Busy = 3; Exit = 10; Sleeps = 3 },
    @{ Name = 'stub child timeout'; Exe = [object].Assembly.Location; Busy = 101; Exit = 2; Sleeps = 100 },
    @{ Name = 'real native ORBIT'; Exe = $hostExe; Busy = 101; Exit = 0; Sleeps = 0 },
    @{ Name = 'unreadable executable'; Exe = $probeFile + '.missing'; Busy = 0; Exit = 2; Sleeps = 0 }
  )) {
    $env:MT3K_SHUTDOWN_EXE = $case.Exe
    $mock = @'
$script:calls = 0; $script:sleeps = 0
function Get-Process { param($Name, $ErrorAction) if ($Name -ne 'MT3KLauncher') { throw 'Wrong process' }; $script:calls++; if ($script:calls -le BUSY) { [pscustomobject]@{ Id = 123 } } }
function Start-Sleep { param($Milliseconds) if ($Milliseconds -ne 100) { throw 'Wrong interval' }; $script:sleeps++ }
'@
    $body = $mock.Replace('BUSY', [string]$case.Busy) + "`ntry {`n" + $probe + "`n} finally { Write-Output ('sleeps=' + `$script:sleeps) }"
    [IO.File]::WriteAllText($probeFile, $body)
    $output = & $hostExe -NoProfile -File $probeFile
    if ($LASTEXITCODE -ne $case.Exit -or $output -notcontains ('sleeps=' + $case.Sleeps)) { throw "Shutdown probe failed: $($case.Name), exit=$LASTEXITCODE output=$output" }
  }
} finally {
  $env:MT3K_SHUTDOWN_EXE = $previousExe
  Remove-Item $probeFile -Force -ErrorAction SilentlyContinue
}
Write-Host 'PASS: NSIS stub probe skips shutdown, waits at most 10 seconds, fails on timeout and preserves native ORBIT shutdown'

# Exercise the actual in-place refresh with AppX cmdlets mocked. This verifies
# filesystem/XML behavior, not Windows deployment, package identity or WMI.
$stageFixture = Join-Path ([System.IO.Path]::GetTempPath()) ('mt3k-manifest-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory (Join-Path $stageFixture 'app') -Force | Out-Null
  New-Item -ItemType File (Join-Path $stageFixture 'app/MT3KLauncher.exe') | Out-Null
  New-Item -ItemType File (Join-Path $stageFixture 'app/ORBIT.exe') | Out-Null
  $shippedAssets = Join-Path $stageFixture 'app/resources/xbox-mode'
  New-Item -ItemType Directory $shippedAssets -Force | Out-Null
  Copy-Item (Join-Path $root 'build/xbox/AppxManifest.xml') $shippedAssets
  Copy-Item (Join-Path $PSScriptRoot 'Register-Mt3kLauncherXboxMode.ps1') $shippedAssets
  $manifestPath = Join-Path $stageFixture 'AppxManifest.xml'
  $original = (Get-Content (Join-Path $root 'build/xbox/AppxManifest.xml') -Raw).Replace('ORBIT.GamingHome', 'MT3K.OrbitGamingHome')
  $original = $original -replace '<desktop6:(Registry|FileSystem)WriteVirtualization>disabled</desktop6:(Registry|FileSystem)WriteVirtualization>', ''
  $original = $original.Replace('<rescap:Capability Name="unvirtualizedResources" />', '').Replace('Version="0.1.4.0"', 'Version="0.1.4.16"').Replace('Publisher="CN=Open Source Developer Luis Antonio Garcia Roque, O=Open Source Developer, L=Alfdorf, S=Baden-Württemberg, C=DE"', 'Publisher="CN=MT3K Edition"')
  [System.IO.File]::WriteAllText($manifestPath, $original)
  function Get-AppxPackage { param($Name) if ($global:mt3kNoPackage) { return }; [pscustomobject]@{ InstallLocation = $stageFixture; PackageFamilyName = 'MT3K.OrbitGamingHome_123456789abcd' } }
  function Add-AppxPackage { param($Register) if ($global:mt3kTestFailDeployment) { throw 'Simulated deployment error' }; $global:mt3kTestRegisteredManifest = $Register }
  function Start-Process { param($FilePath, $ArgumentList) $global:mt3kLaunches += $ArgumentList }
  $global:mt3kLaunches = @()
  $global:mt3kNoPackage = $false
  function Remove-AppxPackage { throw 'Refresh must not remove the package' }
  function Get-CimInstance { throw 'Refresh must not stop/copy the staged app' }
  $global:mt3kTestFailDeployment = $false
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -OnlyIfRegistered -RefreshManifestOnly -Relaunch
  if ($LASTEXITCODE -ne 0) { throw 'Refresh failed' }
  if ($global:mt3kLaunches.Count -ne 1) { throw 'Successful refresh did not relaunch exactly once' }
  [xml]$updated = Get-Content $manifestPath -Raw
  if (@($updated.Package.Applications.Application)[0].Executable -ne 'app\MT3KLauncher.exe') { throw 'Manifest executable did not change' }
  if (@($updated.Package.Applications.Application)[0].Id -ne 'ORBIT' -or $updated.Package.Identity.Name -ne 'MT3K.OrbitGamingHome') { throw 'Identity changed' }
  if ($updated.Package.Identity.Version -ne '0.1.4.16' -or $updated.Package.Identity.Publisher -ne 'CN=MT3K Edition') { throw 'Refresh changed version/publisher' }
  $ns = [Xml.XmlNamespaceManager]::new($updated.NameTable)
  $ns.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $ns.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')
  $ns.AddNamespace('desktop6', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10/6')
  if (!$updated.SelectSingleNode("/f:Package/f:Capabilities/rescap:Capability[@Name='unvirtualizedResources']", $ns)) { throw 'Refresh failed to add opt-out' }
  foreach ($property in 'RegistryWriteVirtualization', 'FileSystemWriteVirtualization') {
    if ($updated.SelectSingleNode("/f:Package/f:Properties/desktop6:$property", $ns).InnerText -ne 'disabled') { throw 'Virtualization remains enabled' }
  }
  foreach ($prefix in 'desktop6', 'rescap') {
    if ($updated.Package.IgnorableNamespaces.Split(' ') -notcontains $prefix) { throw "Missing ignorable namespace: $prefix" }
  }
  $rank = -1
  foreach ($cap in $updated.Package.Capabilities.ChildNodes | Where-Object { $_ -is [Xml.XmlElement] }) {
    $nextRank = if ($cap.NamespaceURI -eq $ns.LookupNamespace('f')) { 0 } elseif ($cap.NamespaceURI -eq $ns.LookupNamespace('rescap')) { 1 } else { 2 }
    if ($nextRank -lt $rank) { throw 'Capabilities out of schema order' }; $rank = $nextRank
  }
  foreach ($family in $updated.Package.Dependencies.TargetDeviceFamily) {
    if ([version]$family.MinVersion -lt [version]'10.0.18362.0') { throw 'Minimum OS too old for opt-out' }
  }
  Write-Host 'PASS: old manifest regenerated with AppData/HKCU opt-out, capability order, namespaces and preserved identity/version'
  if ($global:mt3kTestRegisteredManifest -ne $manifestPath) { throw 'Wrong manifest registered' }
  [System.IO.File]::WriteAllText($manifestPath, $original)
  # The already-renamed executable must also receive the opt-out, using the
  # same explicit shipped AssetsRoot as the in-app updater.
  [IO.File]::WriteAllText($manifestPath, $original.Replace('app\ORBIT.exe', 'app\MT3KLauncher.exe'))
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -RefreshManifestOnly -AssetsRoot $shippedAssets
  if ($LASTEXITCODE -ne 0 -or (Get-Content $manifestPath -Raw) -notmatch 'Name="unvirtualizedResources"') { throw 'Matching-executable refresh missed opt-out' }
  [IO.File]::WriteAllText($manifestPath, $original)
  $global:mt3kTestFailDeployment = $true
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -OnlyIfRegistered -RefreshManifestOnly -Relaunch
  if ($LASTEXITCODE -ne 1) { throw 'Deployment failure was not propagated' }
  if ((Get-Content $manifestPath -Raw) -cne $original) { throw 'Original manifest was not restored' }
  $failureMarker = Join-Path $stageFixture 'app/manifest-refresh.failed'
  if (!(Test-Path $failureMarker)) { throw 'Failure marker missing from build directory' }
  if ($global:mt3kLaunches.Count -ne 2) { throw 'Failed refresh did not recover via AUMID' }
  # Preflight errors are inside recovery too, before XML mutation / registration.
  Remove-Item (Join-Path $stageFixture 'app/MT3KLauncher.exe'), (Join-Path $stageFixture 'app/ORBIT.exe')
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -RefreshManifestOnly -Relaunch
  if ($LASTEXITCODE -ne 1 -or $global:mt3kLaunches.Count -ne 3) { throw 'Preflight failure lost launcher activation' }
  if (!(Test-Path $failureMarker)) { throw 'Preflight failure did not retain marker' }
  New-Item -ItemType File (Join-Path $stageFixture 'app/MT3KLauncher.exe') | Out-Null
  $global:mt3kTestFailDeployment = $false
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -RefreshManifestOnly -Relaunch
  if ($LASTEXITCODE -ne 0 -or (Test-Path $failureMarker)) { throw 'Successful registration did not clear marker' }
  $global:mt3kNoPackage = $true
  $before = Get-Content $manifestPath -Raw
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -OnlyIfRegistered -RefreshManifestOnly -Relaunch
  if ($LASTEXITCODE -ne 0 -or $global:mt3kLaunches.Count -ne 4) { throw 'No registration must be a successful no-op' }
  if ((Get-Content $manifestPath -Raw) -cne $before) { throw 'No-package refresh mutated manifest' }
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -OnlyIfRegistered
  if ($LASTEXITCODE -ne 3) { throw 'Installer registration prompt contract changed' }
  function Get-AppxPackage { param($Name) throw 'Simulated AppX lookup error' }
  & (Join-Path $shippedAssets 'Register-Mt3kLauncherXboxMode.ps1') -Stage $stageFixture -RefreshManifestOnly -Relaunch -RecoveryAumid 'MT3K.OrbitGamingHome_123456789abcd!ORBIT'
  if ($LASTEXITCODE -ne 1 -or $global:mt3kLaunches.Count -ne 5 -or !(Test-Path $failureMarker)) { throw 'AppX lookup failure lost recovery or marker' }
} finally {
  Remove-Item $stageFixture -Recurse -Force
  Remove-Variable mt3kTestFailDeployment, mt3kTestRegisteredManifest -Scope Global -ErrorAction SilentlyContinue
  Remove-Item Function:Get-AppxPackage, Function:Add-AppxPackage, Function:Remove-AppxPackage, Function:Get-CimInstance, Function:Start-Process
}
Write-Host 'PASS: actual manifest refresh preserves identity, avoids restaging and restores the manifest on simulated deployment failure'
# Exercise the actual updater rollback functions with filesystem sharing failures.
foreach ($name in @('Move-AppDirectoryWithRetry', 'Restore-PreviousApp')) {
  $helper = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (!$helper) { throw "Missing updater helper $name" }
  . ([scriptblock]::Create($helper.Extent.Text))
}
$rollbackFixture = Join-Path ([System.IO.Path]::GetTempPath()) ('mt3k-rollback-' + [guid]::NewGuid().ToString('N'))
try {
  $PackageRoot = $rollbackFixture
  $AppDir = Join-Path $PackageRoot 'app'
  $previous = Join-Path $PackageRoot 'app.previous'
  New-Item -ItemType Directory $AppDir, $previous -Force | Out-Null
  Set-Content (Join-Path $AppDir 'new.txt') 'new'
  Set-Content (Join-Path $previous 'old.txt') 'old'
  $swapped = $true
  $originalManifest = $original.Replace('MT3K Launcher', 'MT3K Launcher José Игры')
  $script:moveAttempts = 0
  $script:rollbackLogs = @()
  function Write-UpdateLog { param($Message) $script:rollbackLogs += $Message }
  function Start-Sleep { param($Milliseconds) }
  function Get-AppxPackage { param($Name) return }
  function Add-AppxPackage { throw 'No registration should not attempt AppX deployment' }
  function Move-Item {
    param($LiteralPath, $Destination, $ErrorAction)
    if ($LiteralPath -eq $AppDir) {
      $script:moveAttempts++
      if ($script:moveAttempts -le 2) { throw 'Simulated sharing violation' }
    }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination -ErrorAction Stop
  }
  Restore-PreviousApp
  if ($script:moveAttempts -ne 3) { throw 'Sharing violation was not retried' }
  if (!(Test-Path (Join-Path $AppDir 'old.txt'))) { throw 'Previous app was not restored' }
  if ((Get-Content (Join-Path $PackageRoot 'AppxManifest.xml') -Raw -Encoding UTF8) -cne $originalManifest) { throw 'Rollback lost UTF-8 manifest' }
  if ($script:rollbackLogs.Count -lt 3) { throw 'Rollback did not log retries' }
  # Exhausted retries preserve both trees, including the live new build.
  Microsoft.PowerShell.Management\Move-Item -LiteralPath $AppDir -Destination $previous
  New-Item -ItemType Directory $AppDir | Out-Null
  Set-Content (Join-Path $AppDir 'new.txt') 'new'
  function Move-Item { param($LiteralPath, $Destination, $ErrorAction) throw 'Still locked' }
  $failed = $false
  try { Restore-PreviousApp } catch { $failed = $true }
  if (!$failed -or !(Test-Path (Join-Path $AppDir 'new.txt')) -or !(Test-Path (Join-Path $previous 'old.txt'))) { throw 'Exhausted rollback damaged a build' }
  if ($script -notmatch 'try \{ Restore-PreviousApp \}' -or $script -notmatch 'rollback failed; retained app.previous') { throw 'Rollback errors are not caught/logged by updater' }
  if ($script -notmatch '\$originalManifest = Get-Content[^\r\n]+-Encoding UTF8') { throw 'Manifest snapshot encoding missing' }
} finally {
  Remove-Item Function:Move-Item, Function:Start-Sleep, Function:Get-AppxPackage, Function:Add-AppxPackage, Function:Write-UpdateLog
  Remove-Item $rollbackFixture -Recurse -Force
}
Write-Host 'PASS: refresh success/failure/preflight/no-registration recovery; build-scoped marker; rollback retries, UTF-8 and retained builds'
exit 0
