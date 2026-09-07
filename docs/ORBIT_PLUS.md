# ORBIT Plus integration

ORBIT Plus uses a provider-neutral entitlement in the launcher. Patreon is the
first issuer; a later annual pass or lifetime key can grant the same feature
IDs without changing premium feature code.

## Included launcher features

- `manual-audio`: custom local UI sounds and launcher music.
- `cloud-gaming`: the cloud library, GeForce NOW catalog matching, cloud game
  launches, browser launch, and the installed GeForce NOW app launch from ORBIT.
- `background-motion`: gentle and cinematic Home backdrop movement. The still
  backdrop remains available without ORBIT Plus and whenever reduced motion is active.
- `premium-appearance`: six additional colour themes plus an independent corner
  style with theme-native, square, soft and strongly rounded presets.

The cloud tab remains discoverable with an ORBIT Plus badge and an upgrade
panel. Locked accounts receive no cloud matches; refresh and launch operations
are checked in the main process as well as the UI. Access changes clear renderer
matches and invalidate pending responses. Existing local game libraries remain
available. ORBIT Plus includes the integration, not NVIDIA accounts, game
licenses, or third-party subscriptions.

New verification-service grants should include all four feature IDs. The launcher
normalizes older verified `manual-audio` grants (including encrypted cached
grants) to the same Plus bundle with `cloud-gaming`, `background-motion` and
`premium-appearance`;
expiration, offline grace, and owner-test membership rules still apply.

The main process supplies a local `accessUntil` deadline covering verification
freshness, entitlement expiry and offline grace. The UI expires access at that
deadline and checks again on wake. Disconnect locks access locally before
waiting for remote revocation. Older refresh, owner-test or sign-in responses
cannot replace a newer membership decision; cancelled sign-in flows cannot
open a late browser window or restore access.

## Security boundary

The Electron app never contains a Patreon client secret or Patreon access
token. It opens a browser-based device session on an ORBIT-owned HTTPS service.
That service performs Patreon OAuth with the `identity` and
`identity.memberships` scopes, calls Patreon API v2, checks the configured
campaign and stable `Orbit Plus` tier ID through `currently_entitled_tiers`, and returns an opaque
ORBIT session token plus the sanitized entitlement.

The opaque token and cached entitlement are encrypted through Electron
`safeStorage`. A cached grant only works until the server-provided
`offlineUntil` time. Disconnecting removes the encrypted local session even if
the service is temporarily unavailable.

The creator account can be configured as a single server-side owner identity.
Only that exact Patreon user receives the owner test control; no Patreon or
provider identifier is exposed to the renderer. The control can force the
owner's premium access on or simulate an inactive membership without changing
normal member verification.

## Public launcher configuration

`resources/orbit-plus.json` is packaged with ORBIT:

```json
{
  "patreonMembershipUrl": "https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership",
  "serviceUrl": "https://getorbitlauncher.com"
}
```

The committed `serviceUrl` points to the ORBIT-owned verification service.
Development builds can override either public value with
`ORBIT_PLUS_SERVICE_URL` and `ORBIT_PATREON_MEMBERSHIP_URL`. Production service
URLs must use HTTPS; development also permits loopback HTTP.

## Verification-service contract

All responses use JSON and reveal no Patreon credentials to the launcher.

### Start Patreon connection

`POST /v1/patreon/device-sessions`

Request:

```json
{
  "clientVersion": "0.1.3",
  "platform": "win32",
  "deviceChallenge": "base64url-sha256-of-device-verifier"
}
```

Response (`201`):

```json
{
  "sessionId": "single-use-device-session",
  "authorizationUrl": "https://plus.example.com/patreon/authorize?...",
  "expiresAt": 1788700000000,
  "pollIntervalMs": 1500
}
```

The service must generate and validate OAuth `state`, bind it and the supplied
device challenge to the device session, use a single-use authorization code,
and expire the session within 15 minutes.

### Poll connection

`GET /v1/patreon/device-sessions/{sessionId}`

The launcher sends the original random verifier in
`X-ORBIT-Device-Verifier`; the service hashes and constant-time compares it to
the stored challenge before returning status or a token. This keeps a session
ID copied from browser history from claiming the completed login.

Pending responses are `{ "state": "pending" }` or
`{ "state": "verifying" }`. A completed response is:

```json
{
  "state": "complete",
  "sessionToken": "opaque-rotatable-orbit-token",
  "accountName": "Patreon member",
  "ownerTestAccess": {
    "available": true,
    "enabled": true
  },
  "entitlement": {
    "source": "patreon",
    "plan": "monthly",
    "features": ["manual-audio", "cloud-gaming", "background-motion", "premium-appearance"],
    "verifiedAt": 1788699000000,
    "expiresAt": 1789303800000,
    "offlineUntil": 1788958200000
  }
}
```

Omit `entitlement` when Patreon sign-in succeeded but the member is not in the
Orbit Plus tier. Use `denied`, `expired`, or `failed` for terminal failures and
`410` for an expired device session.

`ownerTestAccess` is returned only for the configured creator account. The
launcher can call `PUT /v1/entitlements/orbit-plus/owner-test` with
`{ "enabled": false }` or `{ "enabled": true }` and the current ORBIT bearer
token to simulate locked and active premium states. Other accounts receive
`404` from this endpoint.

### Refresh and disconnect

- `GET /v1/entitlements/orbit-plus` with `Authorization: Bearer <sessionToken>`
  returns `accountName` plus the current `entitlement`, or omits the entitlement
  when access ended. Return `401` for an invalid/expired ORBIT session.
- `DELETE /v1/sessions/current` revokes the ORBIT session. The desktop client
  treats `200`, `204`, and `401` as idempotent success.

The server should rotate ORBIT tokens, rate-limit device sessions and refreshes,
store Patreon refresh tokens encrypted, and log only internal correlation IDs.
