# ORBIT HUD — Preview 01

An independent Windows Game Bar widget for a future ORBIT version. This project is
an early native prototype, with its own identity, settings, dependencies and build.
It is not connected to the launcher and is not part of the upcoming ORBIT release.

## Available now

- Native UWP XAML interface: Overview, Session and Customize.
- Local clock and date; actual Windows battery and power-supply status, including
  a clear no-battery state on desktop PCs.
- Current app name from Game Bar's target tracker when that feature is available
  and enabled. This is an app-context display, not a claim that a game is running.
- A **manual** session timer: start, pause, resume and confirmed reset. Its state
  survives widget closure, suspension and process restart. It does not track game
  playtime automatically, and follows the system clock while running.
- German and English, larger text, short optional page transitions, Windows
  reduced-motion preference, and native focus visuals.
- A standalone preview window for working on the same interface outside Game Bar.

Everything in this build runs locally. There is no launcher IPC, account login,
telemetry, autostart, driver, game injection, FPS limiter or hardware tuning.
Future features are described in [ROADMAP.md](ROADMAP.md); unavailable functions
are not represented by working-looking controls.

## Build

Requirements:

- Windows 11 development PC; .NET 10 SDK (verified with 10.0.400).
- Windows SDK 10.0.26100.0 or newer, including x64 `makeappx.exe` and WinRT metadata.
- NuGet access for the first restore. Dependencies and cache stay in `.tools/`.
- Current Game Bar and Microsoft VCLibs 14 UWP x64 runtime for the native host.

From this directory in PowerShell:

```powershell
./scripts/Build-Hud.ps1
```

For subsequent offline builds:

```powershell
./scripts/Build-Hud.ps1 -NoRestore
```

On this development PC, Windows Code Integrity subsequently blocked the unsigned
`OrbitHud.dll` with `0x800711C7`, including on Game Bar activation. Developer Mode
and a valid loose package registration do not override that signing requirement.
The regular remedy is to sign the two project-authored binaries with an authorized,
trusted code-signing certificate. After explicitly authorizing certificate use and
the Certum RFC3161 timestamp request:

```powershell
./scripts/Build-Hud.ps1 -NoRestore -BinarySigningThumbprint <authorized-certificate-thumbprint>
```

This option signs only `OrbitHud.exe` and `OrbitHud.dll`, checks both signatures and
timestamps, and retains the independent HUD package identity. It neither signs the
MSIX itself nor imports certificates or changes Windows security policies. The
certificate thumbprint is supplied explicitly; the project does not load ORBIT's
signing profile or select its certificate automatically. The first signing attempt
was blocked by automatic approval review pending explicit user authorization.

The script builds the native app, runs the timer checks, generates Game Bar COM
registration from the pinned SDK metadata, creates original package assets and
validates an unsigned MSIX with MakeAppx. See `artifacts/latest-build.json` for the
exact output directory and package. Each successful local build increments the
fourth package-version component; Windows otherwise retains a previously
registered loose package with the same identity and version.

This first development build bundles the .NET runtime for reproducible startup.
Package-size reduction/AOT is a later measured optimization, not yet a release
claim. No Visual Studio installation is required for this code-and-markup build:
the embedded XAML is parsed by native UWP XamlReader, and C#/WinRT generates the
Game Bar projections. Compilation alone does not validate every XAML property;
opening the native preview remains a required check after markup changes.

## Register the isolated development preview

Developer Mode must already be enabled. Registration does not enable it and does
not create, trust or install signing certificates.

```powershell
./scripts/Register-HudPreview.ps1 -Launch
```

The package is `OrbitHud.Preview`, publisher `CN=Orbit HUD Preview`. It is separate
from `ORBIT.GamingHome`. Registration replaces only an older HUD preview and may
close its windows. It preserves the HUD package's local settings.

Open **Win+G → Widgets → ORBIT HUD**. The standalone preview is also available as
**ORBIT HUD Preview** in Start. The unsigned MSIX is a development artifact, not a
double-click production installer. Public signing and distribution are deferred.

To remove the development preview and its local timer/settings when desired:

```powershell
Get-AppxPackage -Name OrbitHud.Preview | Remove-AppxPackage
```

## Input

- D-pad/left stick or arrow keys: spatial navigation; Tab also follows controls.
- A/Enter: activate. B/Escape: cancel a reset, return to Overview, then leave the
  root dismissal to Game Bar. In the standalone preview, the root closes the view.
- **LB/RB belong to Game Bar** and are not bound to HUD sections.
- Scrollable content keeps navigation and the footer available in small windows.
- Compact Mode requests larger content automatically. Larger text can also be
  selected manually. Pinning is intentionally disabled until a dedicated passive
  HUD presentation has been implemented and tested.

## Project boundaries

See [ARCHITECTURE.md](ARCHITECTURE.md) for extension points and
[VALIDATION.md](VALIDATION.md) for observed results and remaining checks.

The launcher files, `package.json`, its updater, release manifest, Xbox Gaming Home
manifest and installer are not modified. ORBIT's packaging allowlist only includes
the launcher outputs; it does not include this experiment.

## Primary references

- [Game Bar overview](https://learn.microsoft.com/en-us/xbox/game-bar/overview)
- [Microsoft SDK samples](https://github.com/microsoft/XboxGameBarSamples)
- [Controller and widget design](https://learn.microsoft.com/en-us/xbox/game-bar/designguide/widgetui)
- [Modern .NET UWP support](https://learn.microsoft.com/en-us/windows/uwp/dotnet-native/modernize-uwp-apps-with-dotnet)
- [Known Game Bar limitations](https://learn.microsoft.com/en-us/xbox/game-bar/known-issues)

The original UI/package artwork is implemented in this project. The reference
screenshot was used as product inspiration; competitor assets are not bundled.
Microsoft Game Bar SDK redistributables retain their bundled SDK license.
