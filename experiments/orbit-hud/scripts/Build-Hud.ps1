param(
    [switch]$NoRestore,
    [ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$BinarySigningThumbprint
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$hudRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$env:DOTNET_CLI_HOME = Join-Path $hudRoot '.tools/dotnet-home'
$env:NUGET_HTTP_CACHE_PATH = Join-Path $hudRoot '.tools/http-cache'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$project = Join-Path $hudRoot 'src/OrbitHud/OrbitHud.csproj'
$buildTools = Join-Path $hudRoot 'tools/HudBuildTools/HudBuildTools.csproj'
$config = Join-Path $hudRoot 'NuGet.Config'
if (-not $NoRestore) {
    & dotnet restore $project --configfile $config --locked-mode
    if ($LASTEXITCODE -ne 0) { throw 'HUD dependency restore failed.' }
    & dotnet restore $buildTools --configfile $config
    if ($LASTEXITCODE -ne 0) { throw 'HUD build-tools restore failed.' }
}
& dotnet build $buildTools -c Release --no-restore --verbosity minimal
if ($LASTEXITCODE -ne 0) { throw 'HUD build tools failed.' }
$tool = Join-Path $hudRoot 'tools/HudBuildTools/bin/Release/net10.0/HudBuildTools.dll'
& dotnet $tool test
if ($LASTEXITCODE -ne 0) { throw 'HUD timer verification failed.' }
# Each build has its own staging directory. Never overwrite a registered preview.
$buildId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$revision = 1
$latestPath = Join-Path $hudRoot 'artifacts/latest-build.json'
if (Test-Path -LiteralPath $latestPath) {
    $previous = Get-Content -LiteralPath $latestPath -Raw | ConvertFrom-Json
    $revision = ([version]$previous.version).Revision + 1
}
if ($revision -gt 65535) { throw 'Preview revision range exhausted. Increment the preview version.' }
$version = "0.1.0.$revision"
$staging = Join-Path $hudRoot "artifacts/$buildId/package"
& dotnet publish $project -c Release --no-restore -o $staging --verbosity minimal
if ($LASTEXITCODE -ne 0) { throw 'HUD native build failed.' }
$sdk = Join-Path $hudRoot '.tools/packages/microsoft.gaming.xboxgamebar/7.3.2607010'
& dotnet $tool manifest (Join-Path $hudRoot 'packaging/Package.appxmanifest') $sdk (Join-Path $staging 'AppxManifest.xml')
if ($LASTEXITCODE -ne 0) { throw 'HUD SDK registration generation failed.' }
$manifestPath = Join-Path $staging 'AppxManifest.xml'
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$manifest.Package.Identity.Version = $version
$manifest.Save($manifestPath)
& (Join-Path $PSScriptRoot 'New-HudAssets.ps1') -OutputDirectory (Join-Path $staging 'Assets')
$null = New-Item -ItemType Directory -Path (Join-Path $staging 'GameBar') -Force
Set-Content -LiteralPath (Join-Path $staging 'GameBar/README.txt') -Value 'ORBIT HUD Preview widget public folder.'
Copy-Item -LiteralPath (Join-Path $sdk 'license.txt') -Destination (Join-Path $staging 'GameBar-SDK-license.txt')
$kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
if ($BinarySigningThumbprint) {
    $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$BinarySigningThumbprint"
    if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -lt (Get-Date)) { throw 'An available, valid code-signing certificate is required.' }
    $signtool = Get-ChildItem -LiteralPath $kits -Directory | Where-Object Name -Match '^10\.' |
        Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $signtool) { throw 'Windows SDK x64 signtool.exe is required for binary signing.' }
    # Sign only code authored by this project. Keep vendor signatures and the separate
    # development package identity intact. No certificate or trust-store imports.
    foreach ($binary in @('OrbitHud.exe', 'OrbitHud.dll')) {
        $binaryPath = Join-Path $staging $binary
        & $signtool sign /sha1 $BinarySigningThumbprint /s My /fd SHA256 /tr 'http://time.certum.pl' /td SHA256 /d 'ORBIT HUD Preview' $binaryPath
        if ($LASTEXITCODE -ne 0) { throw "HUD binary signing failed: $binary" }
        $signature = Get-AuthenticodeSignature -LiteralPath $binaryPath
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $BinarySigningThumbprint -or -not $signature.TimeStamperCertificate) {
            throw "HUD binary signature verification failed: $binary"
        }
    }
}
$makeappx = Get-ChildItem -LiteralPath $kits -Directory | Where-Object Name -Match '^10\.' |
    Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'x64/makeappx.exe' } |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $makeappx) { throw 'Windows SDK x64 makeappx.exe is required to validate the HUD package.' }
$package = Join-Path $hudRoot "artifacts/$buildId/OrbitHud.Preview-$version-x64.msix"
$packLog = Join-Path $hudRoot "artifacts/$buildId/makeappx.log"
& $makeappx pack /d $staging /p $package /o *> $packLog
if ($LASTEXITCODE -ne 0) { throw 'HUD MSIX validation failed.' }
$result = @{ packageDirectory = $staging; unsignedPackage = $package; identity = 'OrbitHud.Preview'; version = $version; binariesSigned = [bool]$BinarySigningThumbprint }
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $hudRoot 'artifacts/latest-build.json') -Encoding UTF8
Write-Output "HUD preview ready: $package"
Write-Output 'Development MSIX; package itself is unsigned. The build does not install, publish or modify ORBIT.'
