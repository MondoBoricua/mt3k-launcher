import assert from 'node:assert/strict'
import {
  cachedEntitlementIsUsable,
  freshEntitlementIsUsable,
  parseOrbitPlusEntitlement,
  parseOrbitPlusOwnerTestAccess,
  parseOrbitPlusPollResponse,
  parseOrbitPlusStartResponse,
  validatedOrbitPlusServiceUrl,
  validatedPatreonMembershipUrl
} from '../src/main/orbitPlus/orbitPlusPolicy.ts'
import {
  CORNER_STYLE_IDS,
  FREE_THEME_IDS,
  ORBIT_PLUS_THEME_IDS,
  isCornerStyleId,
  isOrbitPlusThemeId,
  isThemeId,
  orbitPlusHasFeature,
  type OrbitPlusSnapshot
} from '../src/shared/ipc.ts'

const now = 1_788_700_000_000
const serviceUrl = 'https://plus.orbit.example'

assert.equal(FREE_THEME_IDS.length, 13)
assert.equal(ORBIT_PLUS_THEME_IDS.length, 6)
assert.equal(isThemeId('cobalt'), true)
assert.equal(isThemeId('unknown-theme'), false)
assert.equal(isOrbitPlusThemeId('cobalt'), true)
assert.equal(isOrbitPlusThemeId('midnight'), false)
assert.deepEqual(CORNER_STYLE_IDS, ['theme', 'square', 'soft', 'round'])
assert.equal(isCornerStyleId('square'), true)
assert.equal(isCornerStyleId('rounded-ish'), false)

assert.equal(
  validatedPatreonMembershipUrl('https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership'),
  'https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership'
)
assert.throws(() => validatedPatreonMembershipUrl('https://patreon.example/membership'))
assert.equal(validatedOrbitPlusServiceUrl(`${serviceUrl}/`, false), serviceUrl)
assert.equal(validatedOrbitPlusServiceUrl('http://127.0.0.1:8787', true), 'http://127.0.0.1:8787')
assert.throws(() => validatedOrbitPlusServiceUrl('http://plus.orbit.example', false))

const start = parseOrbitPlusStartResponse(
  {
    sessionId: 'device-session-1',
    authorizationUrl: `${serviceUrl}/patreon/authorize?session=device-session-1`,
    expiresAt: now + 5 * 60_000,
    pollIntervalMs: 50
  },
  serviceUrl,
  now
)
assert.equal(start.pollIntervalMs, 1_000)
assert.equal(
  parseOrbitPlusStartResponse(
    {
      sessionId: 'clock-skew-device-session',
      authorizationUrl: `${serviceUrl}/patreon/authorize?session=clock-skew-device-session`,
      expiresAt: now + 15 * 60_000 + 30_000
    },
    serviceUrl,
    now
  ).sessionId,
  'clock-skew-device-session'
)
assert.throws(() =>
  parseOrbitPlusStartResponse(
    {
      sessionId: 'overlong-device-session',
      authorizationUrl: `${serviceUrl}/patreon/authorize?session=overlong-device-session`,
      expiresAt: now + 16 * 60_000 + 1
    },
    serviceUrl,
    now
  )
)
assert.throws(() =>
  parseOrbitPlusStartResponse(
    {
      sessionId: 'device-session-1',
      authorizationUrl: 'https://attacker.example/authorize',
      expiresAt: now + 60_000
    },
    serviceUrl,
    now
  )
)

const entitlement = parseOrbitPlusEntitlement({
  source: 'patreon',
  plan: 'monthly',
  features: ['manual-audio'],
  verifiedAt: now,
  expiresAt: now + 7 * 24 * 60 * 60_000,
  offlineUntil: now + 3 * 24 * 60 * 60_000
})
const completed = parseOrbitPlusPollResponse({
  state: 'complete',
  sessionToken: 'opaque-session-token',
  accountName: 'Orbit member',
  entitlement,
  ownerTestAccess: { available: true, enabled: true }
})
assert.equal(completed.state, 'complete')
assert.equal(completed.state === 'complete' && completed.ownerTestAccess?.enabled, true)
assert.deepEqual(parseOrbitPlusOwnerTestAccess({ available: true, enabled: false }), {
  available: true,
  enabled: false
})
assert.throws(() => parseOrbitPlusOwnerTestAccess({ available: false, enabled: true }))
assert.equal(cachedEntitlementIsUsable(entitlement, now + 1_000), true)
assert.equal(cachedEntitlementIsUsable(entitlement, now + 4 * 24 * 60 * 60_000), false)
assert.equal(freshEntitlementIsUsable(entitlement, now + 1_000), true)
assert.equal(freshEntitlementIsUsable(entitlement, now + 8 * 24 * 60 * 60_000), false)
assert.throws(() =>
  parseOrbitPlusEntitlement({
    source: 'patreon',
    plan: 'lifetime',
    features: ['manual-audio'],
    verifiedAt: now
  })
)

const activeSnapshot: OrbitPlusSnapshot = {
  access: 'active',
  connected: true,
  serviceAvailable: true,
  secureStorageAvailable: true,
  purchaseUrl: 'https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership',
  entitlement
}
assert.equal(orbitPlusHasFeature(activeSnapshot, 'manual-audio'), true)
assert.equal(orbitPlusHasFeature({ ...activeSnapshot, access: 'locked' }, 'manual-audio'), false)
assert.deepEqual(entitlement.features, [
  'manual-audio',
  'cloud-gaming',
  'background-motion',
  'premium-appearance'
])
for (const access of ['active', 'grace', 'locked'] as const) {
  assert.equal(orbitPlusHasFeature({ ...activeSnapshot, access }, 'cloud-gaming'), access !== 'locked')
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, access }, 'background-motion'),
    access !== 'locked'
  )
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, access }, 'premium-appearance'),
    access !== 'locked'
  )
}
assert.equal(orbitPlusHasFeature({ ...activeSnapshot, entitlement: undefined }, 'cloud-gaming'), false)
for (const [source, plan] of [['patreon', 'monthly'], ['annual-pass', 'annual'], ['lifetime-key', 'lifetime']]) {
  const migrated = parseOrbitPlusEntitlement({ source, plan, features: ['manual-audio'], verifiedAt: now })
  assert.equal(orbitPlusHasFeature({ ...activeSnapshot, entitlement: migrated }, 'cloud-gaming'), true)
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, entitlement: migrated }, 'background-motion'),
    true
  )
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, entitlement: migrated }, 'premium-appearance'),
    true
  )
}
assert.deepEqual(
  parseOrbitPlusEntitlement({
    ...entitlement,
    features: ['manual-audio', 'cloud-gaming', 'background-motion', 'premium-appearance']
  }).features,
  ['manual-audio', 'cloud-gaming', 'background-motion', 'premium-appearance']
)
assert.deepEqual(
  parseOrbitPlusEntitlement({ ...entitlement, features: ['cloud-gaming'] }).features,
  ['cloud-gaming']
)
assert.equal(
  orbitPlusHasFeature(
    {
      ...activeSnapshot,
      entitlement: parseOrbitPlusEntitlement({
        ...entitlement,
        features: ['cloud-gaming']
      })
    },
    'background-motion'
  ),
  false
)
assert.equal(
  orbitPlusHasFeature(
    {
      ...activeSnapshot,
      entitlement: parseOrbitPlusEntitlement({
        ...entitlement,
        features: ['cloud-gaming']
      })
    },
    'premium-appearance'
  ),
  false
)
assert.throws(() => parseOrbitPlusEntitlement({ ...entitlement, features: ['unknown-feature'] }))
assert.equal(orbitPlusHasFeature({ ...activeSnapshot, accessUntil: now }, 'cloud-gaming', now), true)
assert.equal(orbitPlusHasFeature({ ...activeSnapshot, accessUntil: now }, 'cloud-gaming', now + 1), false)
assert.equal(orbitPlusHasFeature({ ...activeSnapshot, ownerTestAccess: { available: true, enabled: false } }, 'cloud-gaming'), false)
assert.equal(cachedEntitlementIsUsable({ ...entitlement, verifiedAt: now + 10 * 60_000 }, now), false)

console.log('ORBIT Plus policy checks passed')
