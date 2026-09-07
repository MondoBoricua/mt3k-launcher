# Incremental HUD roadmap

The reference suggests a useful destination: contextual controls, clear cards,
controller navigation and short animations. Feature parity is a direction, not a
promise that every vendor setting is available through a public Windows API.

## Preview 01 — independent foundation (this change)

Clock/power, current app context, manual session timer, local preferences,
localization, native navigation, short transitions and isolated packaging.
Exit condition: a native build and a usable preview, with host/game testing
explicitly distinguished from compilation and standalone inspection.

## Preview 02 — useful quick controls

Add one real capability at a time: system/media controls, then supported display
controls. Each must discover support, show its actual value, handle failures, and
remain usable with a controller. Reuse an existing Game Bar function when it meets
the need; custom controls should earn their place through a better ORBIT flow.

Display resolution/refresh changes need rollback and recovery before exposure.
Brightness differs between an internal panel and external monitors. Per-game
profiles depend on a reliable identity and a clearly scoped set of reversible
settings. Avoid UI toggles that merely store a preference without applying it.

## Preview 03 — passive HUD and polish

Add an explicitly designed pinned mode with clock/timer/power and a tiny footprint.
Separate passive display from interactive navigation and obey Game Bar opacity,
click-through and display-mode behavior. Measure hidden/visible CPU, working set,
GPU load and frame pacing before introducing richer effects or performance claims.
Test standard/compact modes, scaling, HDR and multiple monitors.

## Future ORBIT release — first connection

After the upcoming launcher release is finished, define one connection: current
game identity plus session state. Build a narrow local bridge with version
negotiation and an honest disconnected state. Then add achievements/downloads and
supported friend/media integrations in separate, testable steps.

This milestone requires deliberate changes to both products. It is not enabled by
installing Preview 01 and is not included in the current ORBIT installer/updater.

## Later research — performance and device controls

FPS/frame-time sources, frame limiting, GPU controls, TDP, HDR/scaling and vendor
profiles are separate feasibility investigations. Check the supported APIs,
privilege requirements, anti-cheat compatibility, hardware coverage and recovery
path before choosing an implementation. A custom injected graphics overlay is
not part of the current technical foundation.

## Gate for each increment

Build the vertical slice, validate native focus/back behavior, handle unsupported
devices and missing data, stop inactive work, and test inside Game Bar over real
games. Never infer game compatibility or zero performance cost from a successful
build. Preserve the independent package and release boundaries until integration
is explicitly approved as product work.
