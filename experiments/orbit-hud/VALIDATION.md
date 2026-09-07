# Preview 01 validation

Date: 2026-09-07. This is a development prototype, not a release approval.

**Guardian: NICHT FREIGEGEBEN for Game Bar/runtime release.** The independent
foundation builds, but the reported Game Bar error is confirmed to be a Windows
Code Integrity block on the unsigned project assembly. Required native-host
evidence is still missing. The signature remedy is prepared and awaits explicit
authorization; no security setting was disabled or bypassed.

## Observed

- Native Debug and Release builds complete with zero compiler warnings/errors on
  .NET SDK 10.0.400 and Windows SDK 10.0.26100.0.
- Eight executable timer checks pass: initial state, elapsed time while UI is
  absent, pause, restart restoration, rollback of the system clock, reset,
  sessions longer than 24 hours, and negative persisted elapsed time.
- MakeAppx validates and builds the standalone unsigned development package.
- SDK metadata produces 10 native runtime-class registrations and 34 private COM
  marshaling interfaces for the pinned SDK version.
- The package registers as `OrbitHud.Preview_dhw55ygv40ngc`, independently of
  ORBIT. Registration verifies the staged build path rather than assuming success.
- The standalone native window starts. Its actual XAML view renders, including
  clock/power cards, navigation, scrollable content and visible focus treatment.
  The session card is reachable in the observed approximately 500×534 preview.
- The initial startup apartment error was corrected (UWP requires MTA), and an
  older-build registration issue was corrected with increasing dev revisions.
- The user tested the actual Game Bar widget and reported an error. Windows
  Application event 1026 identifies `System.IO.FileLoadException`, `0x800711C7`, on
  the staged `OrbitHud.dll`; Code Integrity events 3033/3077 confirm a signing-level
  failure. This occurs before the widget activation handler can run. The Microsoft
  XAML, Windows SDK, Game Bar and WinRT runtime binaries have valid Microsoft
  signatures; `OrbitHud.exe` and `OrbitHud.dll` are unsigned.
- The optional binary-signing build path is implemented. Automatic approval review
  rejected using the private developer certificate and contacting the timestamp
  service without explicit authorization. No signing took place. A successful
  build/package alone does not resolve this native-host blocker.

## Still required before host/game approval

- Activate ORBIT HUD from Game Bar's widget menu and confirm widget SDK bootstrap,
  current-target handling, repeat activation, close and reopen.
- Exercise all controls with keyboard and a physical controller; verify that
  opening/interacting does not also send gameplay input to the underlying title.
- Test 1280×720 and 1920×1080 display classes, Game Bar Compact Mode, large text,
  long app names, high contrast and Windows reduced motion.
- Confirm focus return and behavior over representative DX11/DX12 games and the
  intended Vulkan/OpenGL display modes. Game Bar itself has documented limits.
- Measure CPU/RAM/GPU and game frame timing with the HUD hidden and visible. The
  current self-contained .NET package is not size/performance optimized.

The timer and packaging checks are automated evidence. Standalone inspection is
visual evidence for that window only; it does not establish Game Bar/controller
or game compatibility. Product controls for future hardware features are absent.
