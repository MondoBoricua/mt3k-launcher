# Moved: this script is now Register-Mt3kLauncherXboxMode.ps1 (ORBIT MT3K Edition
# became MT3K Launcher). This shim keeps older one-line commands and release notes working.
& (Join-Path $PSScriptRoot 'Register-Mt3kLauncherXboxMode.ps1') @args
exit $LASTEXITCODE
