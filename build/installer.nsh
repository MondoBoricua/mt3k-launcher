!macro customHeader
  BrandingText "${PRODUCT_NAME} ${VERSION} - Console-first gaming"
  !define MUI_ABORTWARNING
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro orbitStopBackgroundService
  Push $R6
  Push $R8
  ; The executable can legitimately be absent after quarantine or a partially
  ; completed repair. In that case electron-builder's normal cleanup still runs.
  ; Never ExecWait the transitional stub when the real launcher is available.
  StrCpy $R6 "$INSTDIR\MT3KLauncher.exe"
  IfFileExists "$R6" orbit_background_shutdown_start
  ; Before an upgrade, only the old executable may be installed.
  StrCpy $R6 "$INSTDIR\ORBIT.exe"
  IfFileExists "$R6" orbit_background_shutdown_inspect orbit_background_shutdown_done
  orbit_background_shutdown_inspect:
    ; The C# compatibility stub is a managed PE; the pre-rename Electron exe is
    ; native. Inspect without executing it. A stub's exit 0 does not mean that
    ; its child has stopped. Wait up to 10 seconds, and abort if still running.
    ; An environment variable transports install paths without PowerShell quoting.
    System::Call 'kernel32::SetEnvironmentVariableW(w "MT3K_SHUTDOWN_EXE", w "$R6") i .r0'
    StrCmp $0 0 orbit_background_shutdown_failed
    !insertmacro orbitXboxModePowerShell
    nsExec::ExecToStack '"$R8" -NoProfile -NonInteractive -Command "try { $$null = [Reflection.AssemblyName]::GetAssemblyName($$env:MT3K_SHUTDOWN_EXE) } catch [System.BadImageFormatException] { exit 0 } catch { exit 2 }; for ($$i = 0; $$i -lt 100; $$i++) { if (!(Get-Process -Name MT3KLauncher -ErrorAction SilentlyContinue)) { exit 10 }; Start-Sleep -Milliseconds 100 }; if (Get-Process -Name MT3KLauncher -ErrorAction SilentlyContinue) { exit 2 }; exit 10"'
    Pop $0
    Pop $R8
    System::Call 'kernel32::SetEnvironmentVariableW(w "MT3K_SHUTDOWN_EXE", p 0)'
    StrCmp $0 10 orbit_background_shutdown_done
    StrCmp $0 0 orbit_background_shutdown_start orbit_background_shutdown_failed
  orbit_background_shutdown_start:
    ClearErrors
    ExecWait '"$R6" orbit-background-agent-shutdown' $0
    IfErrors orbit_background_shutdown_failed
    StrCmp $0 0 orbit_background_shutdown_done
  orbit_background_shutdown_failed:
    SetErrorLevel 2
    Abort
  orbit_background_shutdown_done:
  Pop $R8
  Pop $R6
!macroend

!macro orbitXboxModePowerShell
  ; Out: $R8 = native PowerShell. The installer stub is 32-bit and the Appx
  ; cmdlets need the 64-bit host, reachable through Sysnative from WOW64.
  StrCpy $R8 "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $R8 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
!macroend

!macro orbitXboxModeDeveloperMode
  ; Out: $R9 = 1 when Windows Developer Mode is on.
  SetRegView 64
  ClearErrors
  ReadRegDWORD $R9 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" "AllowDevelopmentWithoutDevLicense"
  IfErrors 0 +2
    StrCpy $R9 0
  SetRegView lastused
!macroend

!macro customInstall
  ; MT3K Edition: ORBIT as the Xbox Mode home app through a Developer Mode
  ; registration. An existing registration is refreshed silently so Xbox Mode
  ; runs the version just installed; otherwise interactive setups offer it.
  Push $R7
  Push $R8
  Push $R9
  !insertmacro orbitXboxModePowerShell
  StrCpy $R7 '"$R8" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\xbox-mode\Register-Mt3kLauncherXboxMode.ps1" -Source "$INSTDIR" -LogPath "$TEMP\mt3k-launcher-xbox-mode.log"'
  DetailPrint "Xbox Mode: checking MT3K Launcher registration"
  nsExec::Exec '$R7 -OnlyIfRegistered'
  Pop $R9
  StrCmp $R9 0 orbit_xbox_mode_done
  StrCmp $R9 3 0 orbit_xbox_mode_failed
  IfSilent orbit_xbox_mode_done
  MessageBox MB_YESNO|MB_ICONQUESTION "MT3K Launcher puede ser la app de inicio de Xbox Mode.$\r$\nMT3K Launcher can be your Xbox Mode home app.$\r$\n$\r$\nRegistrarlo ahora? / Register it now?" IDNO orbit_xbox_mode_done
  orbit_xbox_mode_developer_mode:
    !insertmacro orbitXboxModeDeveloperMode
    StrCmp $R9 1 orbit_xbox_mode_register
    ExecShell "open" "ms-settings:developers"
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Xbox Mode necesita el Modo de desarrollador de Windows.$\r$\nXbox Mode needs Windows Developer Mode.$\r$\n$\r$\nActivalo en la ventana que se abrio y pulsa OK.$\r$\nTurn it on in the window that opened, then press OK." IDCANCEL orbit_xbox_mode_done
    Goto orbit_xbox_mode_developer_mode
  orbit_xbox_mode_register:
    DetailPrint "Xbox Mode: registering MT3K Launcher"
    nsExec::Exec '$R7'
    Pop $R9
    StrCmp $R9 0 0 orbit_xbox_mode_failed
    MessageBox MB_OK|MB_ICONINFORMATION "Listo. En Settings > Gaming > Xbox mode > Choose home app escoge MT3K Launcher.$\r$\nDone. In Settings > Gaming > Xbox mode > Choose home app, pick MT3K Launcher."
    Goto orbit_xbox_mode_done
  orbit_xbox_mode_failed:
    DetailPrint "Xbox Mode registration failed ($R9). Log: $TEMP\mt3k-launcher-xbox-mode.log"
    IfSilent orbit_xbox_mode_done
    MessageBox MB_OK|MB_ICONEXCLAMATION "No se pudo registrar MT3K Launcher en Xbox Mode.$\r$\nMT3K Launcher could not be registered for Xbox Mode.$\r$\n$\r$\nLog: $TEMP\mt3k-launcher-xbox-mode.log"
  orbit_xbox_mode_done:
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

!ifdef BUILD_UNINSTALLER
  Function un.orbitStopBackgroundServiceBeforeRemove
    !insertmacro orbitStopBackgroundService
  FunctionEnd
!endif

!macro customUnWelcomePage
  ; This callback runs only when the user advances into the non-cancellable
  ; removal page, so closing the confirmation UI never suspends the service.
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.orbitStopBackgroundServiceBeforeRemove
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInit
  ; Silent update/uninstall has no page transition on which to run the callback.
  ; It is already committed, so stopping here cannot create a cancel outage.
  ${If} ${Silent}
    !insertmacro orbitStopBackgroundService
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$INSTDIR\ORBIT.exe" ; Transitional stub is also removed on uninstall.
  ${ifNot} ${isUpdated}
    ; Only remove an autostart value that points at this exact installation.
    ; A second ORBIT channel or moved install using the same value name is left intact.
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ORBIT Background Service"
    ; NSIS StrCmp is case-insensitive; StrCmpS would be the case-sensitive form.
    StrCmp $0 '"$INSTDIR\${PRODUCT_FILENAME}.exe" orbit-background-agent' 0 orbit_background_cleanup_done
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ORBIT Background Service"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ORBIT Background Service"
    orbit_background_cleanup_done:
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MT3K Launcher"
    StrCmp $0 '"$INSTDIR\${PRODUCT_FILENAME}.exe" --orbit-background' 0 mt3k_startup_cleanup_done
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "MT3K Launcher"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "MT3K Launcher"
    mt3k_startup_cleanup_done:
    ; Remove the Xbox Mode registration this installer staged. Registrations
    ; staged elsewhere (by hand, with -Stage) are left alone.
    Push $R8
    !insertmacro orbitXboxModePowerShell
    nsExec::Exec `"$R8" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-AppxPackage -Name MT3K.OrbitGamingHome | Where-Object { $$_.InstallLocation -like ($$env:LOCALAPPDATA + '\ORBIT-MT3K-XboxMode*') } | Remove-AppxPackage"`
    Pop $R8
    RMDir /r "$LOCALAPPDATA\ORBIT-MT3K-XboxMode"
    Pop $R8
  ${endIf}
!macroend
