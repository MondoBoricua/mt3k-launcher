# Architecture and release boundary

## Current vertical slice

`Program` starts native UWP XAML on the required MTA entry thread. `App` owns the
application settings and each window's lifetime. `HudWindow` retains one
`XboxGameBarWidget` per Game Bar launch activation and reuses it on repeat
activation. It owns host visibility, Compact Mode and system-back subscriptions.

`HudPage` loads the shared native markup for both standalone and widget views.
It owns local navigation, native focus, short cancellable transitions, and
visible-only power/target subscriptions. It stops its one-second dispatcher
timer and animations when hidden or suspended. No background activity exemption
is requested; session elapsed time is derived from persisted timestamps.

`HudSettings` stores preferences and an atomic timer snapshot in the HUD package's
own `ApplicationData.LocalSettings`. Live views share the settings instance and
receive changes via their dispatchers. Secrets, accounts, ORBIT preferences and
the ORBIT game library are not accessed.

`SessionTimer` contains platform-independent timing logic. The build checks its
pause, restoration, hidden-UI, reset, clock-rollback and long-session behavior.

## Native SDK and packaging

Pinned versions: Game Bar SDK `7.3.2607010`, C#/WinRT `2.3.1`. The lockfile records
the resolved package hashes. C#/WinRT projects the SDK's public WinMD into C#;
the native Game Bar DLL and public/private metadata are copied into the package.

The package template declares only `microsoft.gameBarUIExtension`; it has no Gaming
Home registration, launcher protocol, full-trust helper, autostart or network
capability. The build tool derives runtime-class registration and private COM
marshaling interface IDs from the pinned SDK metadata, avoiding a stale manually
copied list. MakeAppx validates the resulting manifest and package.

Developer registration uses a unique HUD package family. The revision must
increase between staged builds. The registration script verifies both the exact
identity and the actual registered directory to catch Windows retaining an older
build. Neither build nor registration imports ORBIT's release tools or signing
profile. An optional, explicitly authorized binary-signing parameter accepts a
certificate from the current user's store; it signs only the two HUD binaries
with SHA-256 and a verified Certum timestamp. Signing preserves the HUD identity
and never installs trust certificates or changes code-integrity policies.

## How to add the next function

1. Define the real Windows/provider capability and how unavailable, denied and
   disconnected states should appear. Display no invented telemetry.
2. Put system/data access behind a small service in `Services/`; keep capability
   discovery out of layout code. Reuse one service across views where appropriate.
3. Add native controls in `Views/HudView.xaml`, labels in `HudText`, and a bounded
   interaction in `HudPage`. Split page controllers when actual new behavior makes
   the existing controller unwieldy; do not introduce a plugin framework now.
4. Give subscriptions, requests and helpers explicit ownership and cleanup. Fetch
   a fresh snapshot on visibility changes instead of polling hidden views.
5. Check the complete controller/back/error flow and relevant host/display modes.

## Future ORBIT connection

Connecting the launcher is an explicit later milestone. Before changing either
product, define a versioned, capability-based contract and its disconnect behavior.
The widget should get the minimum required snapshots and allowlisted commands;
account credentials remain with the owning process. A bridge must authenticate its
peer and validate every command. Local transport and packaging will be chosen
against an actual first integration, not implemented as an empty server today.

An eventual standalone overlay may consume the same application services. Rendering
and input ownership remain separate concerns; this plan does not assume that a
transparent topmost window works over every exclusive-fullscreen title.
