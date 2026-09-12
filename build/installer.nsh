!macro customHeader
  BrandingText "${PRODUCT_NAME} ${VERSION} - Console-first gaming"
  !define MUI_ABORTWARNING
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro orbitStopBackgroundService
  ; The executable can legitimately be absent after quarantine or a partially
  ; completed repair. In that case electron-builder's normal cleanup still runs.
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" orbit_background_shutdown_start orbit_background_shutdown_done
  orbit_background_shutdown_start:
    ClearErrors
    ExecWait '"$INSTDIR\${PRODUCT_FILENAME}.exe" orbit-background-agent-shutdown' $0
    IfErrors orbit_background_shutdown_failed
    StrCmp $0 0 orbit_background_shutdown_done
  orbit_background_shutdown_failed:
    SetErrorLevel 2
    Abort
  orbit_background_shutdown_done:
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
  StrCpy $R7 '"$R8" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\xbox-mode\Register-OrbitMt3kXboxMode.ps1" -Source "$INSTDIR" -LogPath "$TEMP\orbit-mt3k-xbox-mode.log"'
  DetailPrint "Xbox Mode: checking ORBIT MT3K registration"
  nsExec::Exec '$R7 -OnlyIfRegistered'
  Pop $R9
  StrCmp $R9 0 orbit_xbox_mode_done
  StrCmp $R9 3 0 orbit_xbox_mode_failed
  IfSilent orbit_xbox_mode_done
  MessageBox MB_YESNO|MB_ICONQUESTION "ORBIT MT3K puede ser la app de inicio de Xbox Mode.$\r$\nORBIT MT3K can be your Xbox Mode home app.$\r$\n$\r$\nRegistrarlo ahora? / Register it now?" IDNO orbit_xbox_mode_done
  orbit_xbox_mode_developer_mode:
    !insertmacro orbitXboxModeDeveloperMode
    StrCmp $R9 1 orbit_xbox_mode_register
    ExecShell "open" "ms-settings:developers"
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Xbox Mode necesita el Modo de desarrollador de Windows.$\r$\nXbox Mode needs Windows Developer Mode.$\r$\n$\r$\nActivalo en la ventana que se abrio y pulsa OK.$\r$\nTurn it on in the window that opened, then press OK." IDCANCEL orbit_xbox_mode_done
    Goto orbit_xbox_mode_developer_mode
  orbit_xbox_mode_register:
    DetailPrint "Xbox Mode: registering ORBIT MT3K"
    nsExec::Exec '$R7'
    Pop $R9
    StrCmp $R9 0 0 orbit_xbox_mode_failed
    MessageBox MB_OK|MB_ICONINFORMATION "Listo. En Settings > Gaming > Xbox mode > Choose home app escoge ORBIT MT3K.$\r$\nDone. In Settings > Gaming > Xbox mode > Choose home app, pick ORBIT MT3K."
    Goto orbit_xbox_mode_done
  orbit_xbox_mode_failed:
    DetailPrint "Xbox Mode registration failed ($R9). Log: $TEMP\orbit-mt3k-xbox-mode.log"
    IfSilent orbit_xbox_mode_done
    MessageBox MB_OK|MB_ICONEXCLAMATION "No se pudo registrar ORBIT MT3K en Xbox Mode.$\r$\nORBIT MT3K could not be registered for Xbox Mode.$\r$\n$\r$\nLog: $TEMP\orbit-mt3k-xbox-mode.log"
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
  ${ifNot} ${isUpdated}
    ; Only remove an autostart value that points at this exact installation.
    ; A second ORBIT channel or moved install using the same value name is left intact.
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ORBIT Background Service"
    ; NSIS StrCmp is case-insensitive; StrCmpS would be the case-sensitive form.
    StrCmp $0 '"$INSTDIR\${PRODUCT_FILENAME}.exe" orbit-background-agent' 0 orbit_background_cleanup_done
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ORBIT Background Service"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "ORBIT Background Service"
    orbit_background_cleanup_done:
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
