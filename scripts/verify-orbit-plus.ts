import assert from 'node:assert/strict'
import {
  cachedEntitlementIsUsable,
  freshEntitlementIsUsable,
  orbitPlusMembershipDecisionIsStale,
  orbitPlusMembershipEndNeedsConfirmation,
  parseOrbitPlusEntitlement,
  parseOrbitPlusMembershipDecision,
  parseOrbitPlusOwnerTestAccess,
  parseOrbitPlusPollResponse,
  parseOrbitPlusStartResponse,
  validatedOrbitPlusServiceUrl,
  validatedPatreonMembershipUrl,
  orbitPlusCommunitySnapshot,
  parseOrbitPlusCommunityEdition
} from '../src/main/orbitPlus/orbitPlusPolicy.ts'
import {
  gumroadLicenseIssue,
  matchingGumroadOffer,
  parseGumroadCommerceConfig,
  parseGumroadLicenseResponse,
  publicGumroadOffers,
  validatedGumroadLicenseKey
} from '../src/main/orbitPlus/gumroadPolicy.ts'
import {
  CORNER_STYLE_IDS,
  FREE_THEME_IDS,
  HOME_LAYOUT_IDS,
  ORBIT_PLUS_FEATURES,
  ORBIT_PLUS_HOME_LAYOUT_IDS,
  ORBIT_PLUS_LICENSE_REFRESH_INTERVAL_MS,
  ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS,
  ORBIT_PLUS_THEME_IDS,
  isCornerStyleId,
  isHomeLayoutId,
  isOrbitPlusHomeLayoutId,
  isOrbitPlusThemeId,
  isThemeId,
  ORBIT_PLUS_OFFLINE_ACCESS_MINIMUM_MS,
  orbitPlusBackgroundRefreshIsDue,
  orbitPlusConfirmedOfflineAccessUntil,
  orbitPlusHasFeature,
  orbitPlusMembershipDecisionAccess,
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
assert.deepEqual(ORBIT_PLUS_HOME_LAYOUT_IDS, ['cuadro'])
assert.equal(HOME_LAYOUT_IDS.length, 6)
assert.equal(isHomeLayoutId('cuadro'), true)
assert.equal(isHomeLayoutId('unknown-layout'), false)
assert.equal(isOrbitPlusHomeLayoutId('float'), false)
assert.equal(isOrbitPlusHomeLayoutId('cuadro'), true)

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
const activeMembership = parseOrbitPlusMembershipDecision(
  {
    state: 'active',
    verifiedAt: now,
    revision: 7,
    paidThrough: entitlement.expiresAt,
    graceUntil: now + 8 * 24 * 60 * 60_000
  },
  entitlement
)
assert.deepEqual(orbitPlusMembershipDecisionAccess(activeMembership, entitlement, now), {
  access: 'active',
  accessUntil: activeMembership.paidThrough
})
const minimumOfflineAccessUntil = orbitPlusConfirmedOfflineAccessUntil(
  entitlement,
  undefined,
  now
)
assert.equal(minimumOfflineAccessUntil, now + ORBIT_PLUS_OFFLINE_ACCESS_MINIMUM_MS)
assert.equal(
  orbitPlusConfirmedOfflineAccessUntil(entitlement, activeMembership, now),
  activeMembership.graceUntil
)
assert.deepEqual(
  orbitPlusMembershipDecisionAccess(
    activeMembership,
    entitlement,
    now + 7 * 24 * 60 * 60_000 + 1,
    now + 8 * 24 * 60 * 60_000
  ),
  { access: 'grace', accessUntil: now + 8 * 24 * 60 * 60_000 }
)
assert.deepEqual(
  orbitPlusMembershipDecisionAccess(activeMembership, entitlement, now + 7 * 24 * 60 * 60_000 + 1),
  { access: 'grace', accessUntil: activeMembership.graceUntil }
)
assert.deepEqual(
  orbitPlusMembershipDecisionAccess(activeMembership, entitlement, now + 9 * 24 * 60 * 60_000),
  { access: 'locked' }
)
const graceEntitlement = {
  ...entitlement,
  verifiedAt: now - 2 * 24 * 60 * 60_000,
  expiresAt: now - 1
}
const graceMembership = parseOrbitPlusMembershipDecision(
  {
    state: 'grace',
    verifiedAt: now,
    revision: 8,
    paidThrough: graceEntitlement.expiresAt,
    graceUntil: now + 24 * 60 * 60_000
  },
  graceEntitlement
)
assert.deepEqual(orbitPlusMembershipDecisionAccess(graceMembership, graceEntitlement, now), {
  access: 'grace',
  accessUntil: graceMembership.graceUntil
})
const inactiveMembership = parseOrbitPlusMembershipDecision(
  { state: 'inactive', verifiedAt: now, revision: 9, paidThrough: now - 1 },
  undefined
)
assert.deepEqual(orbitPlusMembershipDecisionAccess(inactiveMembership, undefined, now), {
  access: 'locked'
})
assert.equal(
  orbitPlusConfirmedOfflineAccessUntil(undefined, inactiveMembership, now),
  undefined
)
assert.equal(orbitPlusMembershipDecisionIsStale(activeMembership, undefined), true)
assert.equal(
  orbitPlusMembershipDecisionIsStale(activeMembership, { ...activeMembership, revision: 6 }),
  true
)
assert.equal(
  orbitPlusMembershipDecisionIsStale(activeMembership, { ...activeMembership, revision: 7 }),
  false
)
assert.equal(
  orbitPlusMembershipDecisionIsStale(activeMembership, {
    ...activeMembership,
    state: 'grace',
    revision: 7
  }),
  true
)
assert.throws(() =>
  parseOrbitPlusMembershipDecision(
    { state: 'active', verifiedAt: now, revision: 1, paidThrough: now + 1_000 },
    undefined
  )
)
assert.throws(() =>
  parseOrbitPlusMembershipDecision(
    {
      state: 'active',
      verifiedAt: now,
      revision: 1,
      paidThrough: (entitlement.expiresAt ?? now) + 1
    },
    entitlement
  )
)
assert.throws(() =>
  parseOrbitPlusMembershipDecision(
    { state: 'inactive', verifiedAt: now, revision: 1, graceUntil: now + 1_000 },
    undefined
  )
)
assert.throws(() =>
  parseOrbitPlusMembershipDecision(
    { state: 'inactive', verifiedAt: now, revision: 1, paidThrough: now + 1_000 },
    undefined
  )
)
const completedWithDecision = parseOrbitPlusPollResponse({
  state: 'complete',
  sessionToken: 'opaque-session-token',
  entitlement,
  membership: activeMembership
})
assert.equal(
  completedWithDecision.state === 'complete' && completedWithDecision.membership?.revision,
  7
)
assert.deepEqual(parseOrbitPlusOwnerTestAccess({ available: true, enabled: false }), {
  available: true,
  enabled: false
})
assert.throws(() => parseOrbitPlusOwnerTestAccess({ available: false, enabled: true }))
assert.equal(cachedEntitlementIsUsable(entitlement, now + 1_000), true)
assert.equal(cachedEntitlementIsUsable(entitlement, now + 4 * 24 * 60 * 60_000), false)
assert.equal(freshEntitlementIsUsable(entitlement, now + 1_000), true)
assert.equal(freshEntitlementIsUsable(entitlement, now + 8 * 24 * 60 * 60_000), false)
assert.equal(
  orbitPlusMembershipEndNeedsConfirmation(entitlement, undefined, undefined),
  true
)
assert.equal(
  orbitPlusMembershipEndNeedsConfirmation(
    entitlement,
    undefined,
    { available: true, enabled: false }
  ),
  false
)
assert.equal(
  orbitPlusMembershipEndNeedsConfirmation(undefined, undefined, undefined),
  false
)
assert.equal(
  orbitPlusMembershipEndNeedsConfirmation(entitlement, entitlement, undefined),
  false
)
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
  'premium-appearance',
  'next-game-picker',
  'achievement-guides'
])
assert.equal(ORBIT_PLUS_FEATURES.length, 6)
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
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, access }, 'next-game-picker'),
    access !== 'locked'
  )
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, access }, 'achievement-guides'),
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
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, entitlement: migrated }, 'next-game-picker'),
    true
  )
  assert.equal(
    orbitPlusHasFeature({ ...activeSnapshot, entitlement: migrated }, 'achievement-guides'),
    true
  )
}
assert.equal(
  orbitPlusBackgroundRefreshIsDue({ ...activeSnapshot, checkedAt: now }, now),
  false
)
assert.equal(
  orbitPlusBackgroundRefreshIsDue(
    { ...activeSnapshot, checkedAt: now },
    now + ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS
  ),
  true
)
const freshLicenseSnapshot: OrbitPlusSnapshot = {
  ...activeSnapshot,
  connected: false,
  checkedAt: undefined,
  license: { state: 'active', configured: true, plan: 'annual', checkedAt: now }
}
assert.equal(orbitPlusBackgroundRefreshIsDue(freshLicenseSnapshot, now), false)
assert.equal(
  orbitPlusBackgroundRefreshIsDue(
    freshLicenseSnapshot,
    now + ORBIT_PLUS_LICENSE_REFRESH_INTERVAL_MS
  ),
  true
)
assert.deepEqual(
  parseOrbitPlusEntitlement({
    ...entitlement,
    features: ['manual-audio', 'cloud-gaming', 'background-motion', 'premium-appearance', 'next-game-picker', 'achievement-guides']
  }).features,
  ['manual-audio', 'cloud-gaming', 'background-motion', 'premium-appearance', 'next-game-picker', 'achievement-guides']
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

const gumroadConfig = parseGumroadCommerceConfig({
  enabled: true,
  testMode: false,
  offers: {
    annual: {
      checkoutUrl: 'https://luisgarcia850.gumroad.com/l/yxzbb?wanted=true',
      productId: 'zkpocK00pDuRYyH0VRXxjA==',
      priceCents: 1999,
      currency: 'EUR',
      billing: 'yearly'
    },
    lifetime: {
      checkoutUrl: 'https://luisgarcia850.gumroad.com/l/vdomon',
      productId: 'cM7QDxBO4m2EcKD9FvjGtA==',
      priceCents: 4999,
      currency: 'EUR',
      billing: 'one-time'
    }
  }
})
assert.ok(gumroadConfig)
assert.equal(
  gumroadConfig.offers.annual.checkoutUrl,
  'https://luisgarcia850.gumroad.com/l/yxzbb?wanted=true'
)
assert.deepEqual(
  publicGumroadOffers(gumroadConfig).map(({ plan, available }) => ({
    plan,
    available
  })),
  [
    { plan: 'annual', available: true },
    { plan: 'lifetime', available: true }
  ]
)
assert.throws(() =>
  parseGumroadCommerceConfig({
    ...gumroadConfig,
    offers: {
      ...gumroadConfig.offers,
      annual: {
        ...gumroadConfig.offers.annual,
        checkoutUrl: 'https://attacker.example/l/yxzbb'
      }
    }
  })
)
assert.throws(() =>
  parseGumroadCommerceConfig({
    ...gumroadConfig,
    offers: {
      ...gumroadConfig.offers,
      annual: {
        ...gumroadConfig.offers.annual,
        checkoutUrl: 'http://luisgarcia850.gumroad.com/l/yxzbb'
      }
    }
  })
)
assert.throws(() =>
  parseGumroadCommerceConfig({
    ...gumroadConfig,
    offers: {
      annual: gumroadConfig.offers.annual,
      lifetime: {
        ...gumroadConfig.offers.lifetime,
        productId: gumroadConfig.offers.annual.productId
      }
    }
  })
)

assert.equal(
  validatedGumroadLicenseKey('  ORBIT-ANNUAL-1234567890  '),
  'ORBIT-ANNUAL-1234567890'
)
assert.throws(() => validatedGumroadLicenseKey('short'))
assert.throws(() => validatedGumroadLicenseKey('ORBIT LICENSE KEY WITH SPACES'))

const activeAnnualLicense = parseGumroadLicenseResponse({
  success: true,
  uses: 0,
  purchase: {
    product_id: gumroadConfig.offers.annual.productId,
    license_key: '11111111-22222222-33333333-44444444',
    subscription_id: 'annual-subscription-id',
    recurrence: 'yearly',
    refunded: false,
    disputed: false,
    chargebacked: false,
    subscription_ended_at: null,
    subscription_cancelled_at: null,
    subscription_failed_at: null
  }
})
assert.equal(matchingGumroadOffer(gumroadConfig, activeAnnualLicense)?.plan, 'annual')
assert.equal(gumroadLicenseIssue(activeAnnualLicense, now), undefined)

const activeLifetimeLicense = parseGumroadLicenseResponse({
  success: true,
  uses: 0,
  purchase: {
    product_id: gumroadConfig.offers.lifetime.productId,
    license_key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD',
    subscription_id: null,
    recurrence: null,
    refunded: false,
    disputed: false,
    chargebacked: false,
    subscription_ended_at: null,
    subscription_cancelled_at: null,
    subscription_failed_at: null
  }
})
assert.equal(matchingGumroadOffer(gumroadConfig, activeLifetimeLicense)?.plan, 'lifetime')
assert.equal(gumroadLicenseIssue(activeLifetimeLicense, now), undefined)

const testPurchaseLicense = parseGumroadLicenseResponse({
  success: true,
  purchase: {
    product_id: gumroadConfig.offers.lifetime.productId,
    license_key: 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD',
    subscription_id: null,
    recurrence: null,
    test: true,
    refunded: false,
    disputed: false,
    chargebacked: false,
    subscription_ended_at: null,
    subscription_cancelled_at: null,
    subscription_failed_at: null
  }
})
assert.equal(gumroadLicenseIssue(testPurchaseLicense, now), 'license-test-purchase')
assert.equal(gumroadLicenseIssue(testPurchaseLicense, now, true), undefined)
assert.throws(() =>
  parseGumroadLicenseResponse({
    success: true,
    purchase: {
      product_id: gumroadConfig.offers.lifetime.productId,
      test: 'true'
    }
  })
)

const expiredLicense = parseGumroadLicenseResponse({
  success: true,
  purchase: {
    product_id: gumroadConfig.offers.annual.productId,
    license_key: '11111111-22222222-33333333-44444444',
    subscription_id: 'expired-subscription-id',
    recurrence: 'yearly',
    refunded: false,
    disputed: false,
    chargebacked: false,
    subscription_ended_at: '2020-09-08T00:00:00.000Z',
    subscription_cancelled_at: null,
    subscription_failed_at: null
  }
})
assert.equal(expiredLicense.expiresAt, Date.parse('2020-09-08T00:00:00.000Z'))
assert.equal(gumroadLicenseIssue(expiredLicense, now), 'license-expired')
assert.equal(
  gumroadLicenseIssue({
    succeeded: false,
    error: 'That license does not exist for the provided product.',
    testPurchase: false,
    refunded: false,
    disputed: false,
    chargebacked: false
  }, now),
  'license-invalid'
)
assert.equal(
  matchingGumroadOffer(gumroadConfig, {
    ...activeLifetimeLicense,
    productId: 'not-an-orbit-product-id'
  }),
  undefined
)

// Community edition (MT3K): every feature unlocked locally, permanently, with no refresh traffic
const communitySnapshot = orbitPlusCommunitySnapshot(
  now,
  'https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership'
)
const tenYearsLater = now + 10 * 365 * 24 * 60 * 60_000
for (const feature of ORBIT_PLUS_FEATURES) {
  assert.equal(orbitPlusHasFeature(communitySnapshot, feature, tenYearsLater), true, feature)
}
assert.equal(communitySnapshot.communityEdition, true)
assert.equal(communitySnapshot.connected, false)
assert.equal(communitySnapshot.serviceAvailable, false)
assert.deepEqual(communitySnapshot.offers, [])
assert.deepEqual(communitySnapshot.activeSources, [])
assert.equal(orbitPlusBackgroundRefreshIsDue(communitySnapshot, tenYearsLater), false)
assert.equal(parseOrbitPlusCommunityEdition(true), true)
for (const value of [false, 'true', 1, null, undefined, {}]) {
  assert.equal(parseOrbitPlusCommunityEdition(value), false, String(value))
}

console.log('ORBIT Plus policy checks passed')
