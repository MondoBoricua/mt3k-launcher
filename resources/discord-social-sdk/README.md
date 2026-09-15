# Discord Social SDK runtime

This directory is the packaging location for MT3K Launcher's Discord Social SDK
integration. The proprietary SDK binary is intentionally excluded from the GPL
source repository.

Official MT3K Launcher builds add the Windows x64 runtime (version 1.10.19337)
in GitHub Actions from private storage, verify its SHA-256 and API contract with
`npm run verify:discord`, and package it inside the app.

To test Discord in a local build, create your own application in the Discord
Developer Portal, download the SDK from *Games → Social SDK → Downloads*, and
place the runtime at:

`resources/discord-social-sdk/win32-x64/discord_partner_sdk.dll`

Keep Discord's original `License-Notices.txt` in this directory. Use and
distribution remain subject to the Discord Social SDK Terms:

<https://support-dev.discord.com/hc/en-us/articles/30225844245271-Discord-Social-SDK-Terms>
