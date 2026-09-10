<p align="center">
  <img src="docs/images/orbit-handheld.webp" alt="ORBIT running on a gaming handheld" width="100%" />
</p>

<h1 align="center">ORBIT</h1>

<p align="center">
  A controller-first gaming launcher that brings your PC library together in one console-style home.
</p>

<p align="center">
  <a href="https://github.com/toonymak1993/orbit/releases/latest"><img alt="Download the latest release" src="https://img.shields.io/badge/download-latest%20release-22d3ee?style=for-the-badge&logo=windows11&logoColor=05070c" /></a>
  <img alt="Windows 11" src="https://img.shields.io/badge/Windows-11-111827?style=for-the-badge&logo=windows11&logoColor=white" />
  <img alt="Controller first" src="https://img.shields.io/badge/input-controller%20first-111827?style=for-the-badge" />
</p>

## One home for your games

ORBIT is an Electron-based Windows launcher designed for handhelds, TVs and desktop PCs. It combines a focused game library with a living home screen, store offers and upcoming releases — all built around controller and keyboard navigation.

- Steam, Epic Games, GOG, Xbox / Microsoft Store, PlayStation, EA app, Ubisoft Connect, retro systems and custom local games
- Console-style spatial navigation with visible focus and gamepad support
- Six Home layouts, including the Xbox-inspired XMODE, CoreSense recommendations and the ORBIT Plus-exclusive Cuadro TV Launcher
- Friends Hub with Steam, Epic and optional Discord presence, conversations and notifications
- Favorites, custom collections and adjustable 4–8-column library layouts
- Live Steam, Epic Games and Xbox download/update activity
- Release calendar, wishlist offers and regional store prices
- Update badges for pending Steam game updates
- Session history, activity summaries and second-accurate local playtime
- Game trailers, optional title music, editable metadata and clear running-game indicators
- Artwork Studio for covers, backgrounds and icons, plus profile avatars, local save backups, notifications and themes
- Safe per-game launch options and adaptive Xbox/PlayStation controller hints
- Quick Settings and a compact system HUD for battery, network and Bluetooth status
- Read-only Windows Update and graphics-driver checks
- English, German, Spanish and Russian interfaces with adjustable text size
- Optional Xbox Mode and background Hardware Control
- Optional ORBIT Plus membership for cloud gaming and premium personalization

## A closer look

![ORBIT Home](docs/images/orbit-home.webp)

![ORBIT release calendar](docs/images/orbit-releases.webp)

## Download

ORBIT `0.1.4` is the current stable release. Download **`ORBIT-XboxMode-Setup-0.1.4-x64.exe`** from the [latest GitHub Release](https://github.com/toonymak1993/orbit/releases/latest). This is the only file required: the setup contains ORBIT, the signed Xbox Mode AppX, the public ORBIT certificate and the verified English installation flow.

Run the setup from the Windows account that should own ORBIT and approve the administrator prompt. After installation, Windows opens **Settings > Gaming > Xbox mode** so ORBIT can be selected as the home app.

> ORBIT `0.1.4` is signed with the publicly trusted Certum Open Source Code Signing certificate. ORBIT never installs this public certificate into a Windows trust store. During the one-time transition from old self-signed builds, setup keeps the legacy package and its development certificate in place because Windows scopes its data to the old package family. SmartScreen may still warn while a new certificate or binary builds reputation; always verify the SHA-256 and signer published in the release notes.

### Previous stable release

ORBIT `0.1.3` remains available on its [release page](https://github.com/toonymak1993/orbit/releases/tag/v0.1.3). New users should install the current all-in-one setup above. Existing Certum-signed installations can update on the same trusted publisher line.

### Requirements

- Windows 11 x64
- A controller is recommended, but keyboard and mouse are supported
- Xbox Mode requires Windows 11 24H2 or newer

Xbox Mode visibility still depends on Microsoft's supported markets, device policy and phased Windows rollout. Keep Windows, the Xbox app and Game Bar current.

## What's new in 0.1.4

- The first complete ORBIT Plus release adds secure Patreon membership verification plus annual and lifetime license-key activation, all mapped to the same provider-neutral entitlement
- Plus gains the Next Game Picker, controller-ready achievement video guides, the exclusive Cuadro TV Launcher, GeForce NOW cloud launching and session tracking, dynamic Home motion, premium themes, corner styles and custom launcher/UI audio
- The free launcher gains Russian, a controller-ready Download Center, Steam wishlist and Family-library improvements, PS3/Xbox 360 retro support, a device Power menu and broader install/uninstall actions
- Game details now provide a complete metadata workspace with artwork quality guidance and safe YouTube search for trailers and title music
- ORBIT remains navigable while a game runs; stronger multi-signal process/window tracking handles launch, playtime, manual stop and automatic return more reliably
- Played GeForce NOW titles participate in local Home history and can continue back into GeForce NOW, while cloud catalog discovery and direct matched-game launching remain ORBIT Plus features
- The single English Xbox Mode setup still contains the complete app and is signed with ORBIT's official Certum certificate

See the complete [0.1.4 release notes](docs/releases/0.1.4.md) for details. The ORBIT Plus security and entitlement model is documented separately in [ORBIT_PLUS.md](docs/ORBIT_PLUS.md).

## ORBIT Plus

ORBIT remains a complete controller-first launcher without Plus. ORBIT Plus is an optional layer for cloud gaming, guided discovery and premium personalization. Access can be verified through Patreon or an annual/lifetime license key; the launcher keeps only encrypted ORBIT sessions and license credentials in Windows secure storage. Payment details, Patreon passwords, provider credentials and private signing material never enter the renderer or repository. GeForce NOW accounts, games and third-party subscriptions remain separate. Visit the [official ORBIT website](https://www.getorbitlauncher.com/) for product information and future downloads.

## Build from source

```powershell
git clone https://github.com/toonymak1993/orbit.git
cd orbit
npm ci
npm run typecheck
npm run verify:steam
npm run verify:downloads
npm run verify:launch-arguments
npm run verify:updates
npm run dev
```

Create a production build with `npm run build`. Windows installer and Xbox Mode packaging details are documented in [PACKAGING.md](PACKAGING.md).

## Project status

ORBIT `0.1.4` is the current stable public release. `0.1.3` remains available as the previous stable build, while older beta packages are historical test material. The next development phase prioritizes measured stability, startup/navigation performance, lower resource use and reliable long-session behavior before another large feature wave.

ORBIT is an independent project and is not affiliated with Valve, Epic Games, Microsoft, Xbox or the publishers shown in screenshots.

## License

Copyright (C) 2026 Luis Garcia.

ORBIT is free software licensed under the [GNU General Public License v3.0](LICENSE). You may use, study, modify and redistribute it under those terms. Distributed modified versions must preserve the license and make the corresponding source code available.

The optional Discord integration uses the separately licensed Discord Social SDK. See the [GPL linking exception](LICENSE_EXCEPTION.md) and [third-party notices](THIRD_PARTY_NOTICES.md); the Discord SDK itself is not covered by the GPL.
