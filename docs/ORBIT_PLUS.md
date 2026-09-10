# ORBIT Plus integration

ORBIT Plus uses provider-neutral entitlements in the launcher. Patreon grants
monthly access; Gumroad grants the live annual and lifetime licenses. Every
provider uses the same feature IDs without changing premium feature code.

## Included launcher features

- `manual-audio`: custom local UI sounds and launcher music.
- `cloud-gaming`: the cloud library, GeForce NOW catalog matching, cloud game
  launches, browser launch, and the installed GeForce NOW app launch from ORBIT.
- `background-motion`: gentle and cinematic Home backdrop movement. The still
  backdrop remains available without ORBIT Plus and whenever reduced motion is active.
- `premium-appearance`: six additional colour themes, the Cuadro Home layout,
  plus an independent corner style with theme-native, square, soft and strongly
  rounded presets.
- `next-game-picker`: a controller-ready Library carousel that draws from the
  current filters, prefers ready-to-launch games, explains the result and enriches
  only the winner with cached HowLongToBeat and available store-rating signals.
- `achievement-guides`: complete controller browsing and inline expansion for
  achievements in game details, plus a main-process-gated YouTube search that
  plays the best matching solution in ORBIT's existing safe video player.

The cloud tab remains discoverable with an ORBIT Plus badge and an upgrade
panel. Locked accounts receive no cloud matches; refresh and launch operations
are checked in the main process as well as the UI. Access changes clear renderer
matches and invalidate pending responses. Existing local game libraries remain
available. ORBIT Plus includes the integration, not NVIDIA accounts, game
licenses, or third-party subscriptions.

The GeForce NOW library toolbar stores the user's `geForceNowLaunchMode`
(`web` by default, or `native`). This choice applies to cloud launches from
both game cards and game details. The native option requires an installed
Windows GeForce NOW client and its `GeForceNOWStreamer.exe`; availability is
rechecked when the page gains focus and immediately before native game launch.
If the app has been removed, launches use the existing web flow. A native
spawn error is reported instead of starting a second session in the browser.

Native launch arguments follow NVIDIA's own desktop-shortcut mechanism:
`--url-route=#?cmsId=<store-variant-id>&launchSource=External&parentGameId=<game-uuid>&shortName=<encoded-name>`.
The main process resolves the game and store variant from its catalog; the
renderer only sends an ORBIT game ID. IDs are validated, values URL-encoded,
and the executable receives an argument array with `shell: false`. The cloud
feature gate runs again after asynchronous native discovery. NVIDIA's app
handles sign-in, ownership checks and streaming; ORBIT does not import or
modify the user's NVIDIA account library. ORBIT minimizes after a successful
native handoff and remains available in the taskbar, as with other native apps.
Cloud game launches use ORBIT's shared three-second cancel window before either
native or web dispatch. B/Escape cancels without launching NVIDIA or recording
history. Concurrent starts are rejected until the handoff completes; native
login/queue time does not create a played session.

Native GeForce NOW sessions use a separate `geforce-now-window` tracking method.
The existing Windows process monitor identifies the `GeForceNOW.exe` game
window (current CEF client) or `GeForceNOWStreamer.exe` (older client), excludes
CEF helper subprocesses, and matches its exact localized title against the ORBIT/NVIDIA game
names and uses the requested store variant to disambiguate duplicate copies.
The NVIDIA client's local `console.log` stream-start marker confirms playback:
the title alone also exists during loading and must not start the clock.
The log is read incrementally with a 512 KiB bound; only lifecycle timestamps
are retained. No NVIDIA account data is transmitted or persisted by this reader.
Stream termination, window removal or process exit ends the session through
ORBIT's existing running indicator, return flow and playtime persistence.
Local backups and launcher-closing policies are not applied to cloud sessions.
An already confirmed session can finish after Plus expires. New passive
discovery requires cloud access and a catalog match; ambiguous titles are ignored.
This detection targets the native Windows client. The external browser flow
does not expose these signals and is not timed as if browser lifetime were playtime.
NVIDIA's private window/log format can change; missing confirmation does not
prevent launching a game but leaves automatic tracking inactive.

Confirmed native cloud starts also update `lastGeForceNowStartedAt`; ordinary
starts update `lastLocalStartedAt`. Home projects these into distinct local and
GeForce NOW continuation cards with stable source-specific focus keys. Cloud
cards include the supplied GeForce NOW badge and retain their cloud activation
target in all six Home layouts, including controller secondary actions. They
remain available without a local installation. The underlying library record,
artwork, metadata and total playtime are shared, so library/game statistics are
not duplicated. Existing records without cloud history keep their usual Home
behavior. The badge asset was supplied as `geforcenow.png` but contains SVG;
it is bundled as `geforce-now-badge.svg` without changing its artwork.

New verification-service grants should include all six feature IDs. The launcher
normalizes older verified `manual-audio` grants (including encrypted cached
grants) to the same Plus bundle with `cloud-gaming`, `background-motion` and
`premium-appearance`, plus `next-game-picker` and `achievement-guides`;
expiration, offline grace, and owner-test membership rules still apply.

The main process supplies a local `accessUntil` deadline covering verification
freshness, entitlement expiry and offline grace. The UI expires access at that
deadline and checks again only when the provider-specific refresh interval is
due. Regaining window focus never creates a billing request by itself. Disconnect locks access locally before
waiting for remote revocation. Older refresh, owner-test or sign-in responses
cannot replace a newer membership decision; cancelled sign-in flows cannot
open a late browser window or restore access.

A refresh keeps the last confirmed entitlement in place while verification is
running. New service responses carry an explicit, revisioned `membership`
decision; responses without that object remain supported for older deployments
and require a second consistent entitlement-free response before access is
removed. Owner-test disable remains immediate. An expired ORBIT session token
preserves the cached entitlement through its existing access window while asking
the member to reconnect. Premium preferences and local assets are never rewritten
when access is checking, temporarily unavailable or locked: runtime surfaces may
use their free fallback, then resume the saved choice when confirmed access returns.

### Membership decision contract

The verification service is authoritative for billing. The launcher never adds
30 days locally. Every completed sign-in, refresh and owner-test response should
include:

```json
{
  "membership": {
    "state": "active",
    "verifiedAt": 1788699000000,
    "revision": 42,
    "paidThrough": 1791377400000,
    "graceUntil": 1791636600000
  }
}
```

- `active`: the current period is paid. `paidThrough` is required for monthly
  and annual plans and omitted for lifetime access.
- `grace`: payment or verification is recoverable. `graceUntil` is required;
  access remains enabled until that instant.
- `inactive`: no current paid or grace access exists. The response must omit
  both `entitlement` and `graceUntil`.
- `verifiedAt`: time at which the service made this billing decision.
- `revision`: account-scoped, monotonically increasing decision number. The
  service must never reuse a revision for different membership data. The client
  ignores missing or older decisions after it has stored a revisioned decision.

Cancellation at period end is still `active` until `paidThrough`; only the
server's later `inactive` decision removes runtime access. Network errors and a
temporary `verifying` state are not membership decisions and therefore cannot
replace the last confirmed state.

Every successful positive check grants a local offline window of at least seven
days from that check, even if the service sends a shorter `offlineUntil`. When
the window is reached, ORBIT starts a new verification without hiding premium
features during the request. If the service is unreachable, the request times
out, or the ORBIT session must be reconnected, the launcher keeps the confirmed
entitlement in `grace`, schedules another retry, and never rewrites premium
preferences. Only an explicit revisioned `membership.state: "inactive"` (or the
legacy service's twice-confirmed entitlement-free response) automatically locks
access. A server-supplied `graceUntil` may extend the seven-day local minimum.

## Security boundary

The Electron app never contains a Patreon client secret or Patreon access
token. It opens a browser-based device session on an ORBIT-owned HTTPS service.
That service performs Patreon OAuth with the `identity` and
`identity.memberships` scopes, calls Patreon API v2, checks the configured
campaign and stable `Orbit Plus` tier ID through `currently_entitled_tiers`, and returns an opaque
ORBIT session token plus the sanitized entitlement.

The opaque token, cached entitlement, membership decision and retry deadline are
encrypted through Electron `safeStorage`. A positive grant remains available
for the local seven-day minimum and any longer server-provided grace. Temporary
verification failures roll the deadline forward for another retry instead of
being interpreted as cancellation. Disconnecting removes the encrypted local
Patreon session even if the service is temporarily unavailable. A separately
activated annual or lifetime license remains independent; access is granted when
at least one provider has a usable entitlement.

The creator account can be configured as a single server-side owner identity.
Only that exact Patreon user receives the owner test control; no Patreon or
provider identifier is exposed to the renderer. The control can force the
owner's premium access on or simulate an inactive membership without changing
normal member verification.

## Annual and lifetime licenses

`gumroad.enabled` is the single commerce rollout gate. The committed production
configuration enables the live annual and lifetime products. Checkout opens on
the seller's HTTPS Gumroad product page in the user's external browser; no
third-party checkout script is loaded inside Electron.

License activation and validation use Gumroad's public License API from the
main process with `increment_uses_count=false`. No Gumroad access token or API
secret is embedded. ORBIT tries only the two configured product IDs and accepts
a response only when the returned product ID and purchase shape match: the
annual product must be a yearly subscription, while the lifetime product must
be a one-time purchase. Refunds, disputes, chargebacks and ended subscriptions
are handled as explicit provider decisions. A cancelled annual subscription
remains usable until Gumroad's reported end timestamp.

Production packages reject Gumroad responses marked `purchase.test=true`.
Local unpackaged development builds accept those keys so the creator can run
Gumroad's official test-purchase flow without creating a real self-purchase.
Legacy encrypted license records created before this distinction are forced
through one online verification before they can grant permanent access.

The license key is encrypted with Electron `safeStorage`; customer names, email
addresses and payment details are neither requested nor retained. Removing a
license from ORBIT deletes only the local encrypted credential and does not
cancel a Gumroad subscription.

A confirmed annual license receives a new seven-day offline window after every
successful check. Gumroad licenses are refreshed at most once per 24 hours by
the background scheduler; a focus or visibility change only checks whether that
deadline is due. Network failures and in-progress checks retain the existing
deadline and never alter premium preferences. A provider-level invalid-key
response must be repeated consistently before ORBIT locks an existing license;
refund, dispute, chargeback and reached subscription-end timestamps are already
authoritative and apply immediately. Requests reject redirects and non-JSON
responses, omit browser credentials and are protected by local activation and
manual-refresh rate limits. A lifetime purchase remains locally usable without
an expiry; successful online refreshes can still apply an explicit provider
revocation. A still-valid Patreon or other license grant continues to unlock
Plus independently.

Gumroad's `uses` value is a global counter, not a device identity. ORBIT does
not increment it because doing so would punish reinstalls without a reliable
authenticated deactivation path. Consequently, a Gumroad key is a bearer
credential and the direct integration does not prevent deliberate key sharing
or patching of the desktop binary. Add an ORBIT-owned activation service before
promising a fixed device/seat count; never embed a Gumroad creator access token
in the desktop app.

## Public launcher configuration

`resources/orbit-plus.json` is packaged with ORBIT:

```json
{
  "patreonMembershipUrl": "https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership",
  "serviceUrl": "https://getorbitlauncher.com",
  "gumroad": {
    "enabled": true,
    "testMode": false,
    "offers": {
      "annual": {
        "checkoutUrl": "https://luisgarcia850.gumroad.com/l/yxzbb?wanted=true",
        "productId": "zkpocK00pDuRYyH0VRXxjA==",
        "priceCents": 1999,
        "currency": "EUR",
        "billing": "yearly"
      },
      "lifetime": {
        "checkoutUrl": "https://luisgarcia850.gumroad.com/l/vdomon",
        "productId": "cM7QDxBO4m2EcKD9FvjGtA==",
        "priceCents": 4999,
        "currency": "EUR",
        "billing": "one-time"
      }
    }
  }
}
```

The committed `serviceUrl` points to the ORBIT-owned Patreon verification service.
Development builds can override either public value with
`ORBIT_PLUS_SERVICE_URL` and `ORBIT_PATREON_MEMBERSHIP_URL`. Production service
URLs must use HTTPS; development also permits loopback HTTP. The commerce
metadata has no environment override, so provider or product changes require an
explicit, reviewable packaged configuration change.

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
  "membership": {
    "state": "active",
    "verifiedAt": 1788699000000,
    "revision": 42,
    "paidThrough": 1789303800000,
    "graceUntil": 1789563000000
  },
  "entitlement": {
    "source": "patreon",
    "plan": "monthly",
    "features": ["manual-audio", "cloud-gaming", "background-motion", "premium-appearance", "next-game-picker", "achievement-guides"],
    "verifiedAt": 1788699000000,
    "expiresAt": 1789303800000,
    "offlineUntil": 1788958200000
  }
}
```

Return `membership.state: "inactive"` and omit `entitlement` when Patreon sign-in
succeeded but the member has no current Orbit Plus access. Use `denied`, `expired`,
or `failed` for terminal failures and `410` for an expired device session. Older
services may omit `membership`; the launcher retains its defensive two-response
confirmation for that legacy shape.

`ownerTestAccess` is returned only for the configured creator account. The
launcher can call `PUT /v1/entitlements/orbit-plus/owner-test` with
`{ "enabled": false }` or `{ "enabled": true }` and the current ORBIT bearer
token to simulate locked and active premium states. Other accounts receive
`404` from this endpoint.

### Refresh and disconnect

- `GET /v1/entitlements/orbit-plus` with `Authorization: Bearer <sessionToken>`
  returns `accountName`, the current `membership` decision and, for `active` or
  `grace`, the matching `entitlement`. Return `401` for an invalid/expired ORBIT
  session; a `401` is an authentication result, not proof that billing ended.
- `DELETE /v1/sessions/current` revokes the ORBIT session. The desktop client
  treats `200`, `204`, and `401` as idempotent success.

The server should rotate ORBIT tokens, rate-limit device sessions and refreshes,
store Patreon refresh tokens encrypted, and log only internal correlation IDs.
