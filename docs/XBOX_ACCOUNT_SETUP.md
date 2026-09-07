# Xbox account services

ORBIT reads the local Xbox/Game Pass library without account credentials. Achievements additionally require ORBIT's own Microsoft public-client registration.

1. Register a public desktop/native application for ORBIT in Microsoft Entra.
2. Register `https://login.microsoftonline.com/common/oauth2/nativeclient` as its redirect URI and allow public-client flows.
3. Enable the Xbox Live delegated scopes `XboxLive.signin` and `XboxLive.offline_access` for the application.
4. Put the application ID in `resources/release-manifest.json` as `integrations.xboxClientId` before packaging. For a local development run, `ORBIT_XBOX_CLIENT_ID` overrides the manifest.

The client ID is public configuration, not a secret. ORBIT never needs a client secret. The Microsoft refresh token is encrypted with Electron `safeStorage`; Microsoft access tokens and Xbox/XSTS tokens remain in main-process memory and never cross IPC.

The session manager is intentionally provider-neutral enough to add further first-party Xbox services later. xCloud discovery and streaming still require separate service-specific scopes, relying parties, API adapters, and licensing checks; they must not reuse achievement endpoints by assumption.
