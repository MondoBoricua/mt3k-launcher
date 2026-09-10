import type {
  OrbitPlusCommerceOffer,
  OrbitPlusCommercePlan,
  OrbitPlusIssue
} from '@shared/ipc'

const COMMERCE_PLANS: readonly OrbitPlusCommercePlan[] = ['annual', 'lifetime']
const CHECKOUT_HOST = 'luisgarcia850.gumroad.com'
const ANNUAL_RECURRENCES = new Set(['annual', 'annually', 'yearly'])

export interface GumroadOfferConfig extends OrbitPlusCommerceOffer {
  checkoutUrl: string
  productId: string
}

export interface GumroadCommerceConfig {
  enabled: boolean
  testMode: boolean
  offers: Record<OrbitPlusCommercePlan, GumroadOfferConfig>
}

export interface ParsedGumroadLicenseResponse {
  succeeded: boolean
  error?: string
  productId?: string
  licenseKey?: string
  subscriptionId?: string
  recurrence?: string
  expiresAt?: number
  testPurchase: boolean
  refunded: boolean
  disputed: boolean
  chargebacked: boolean
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function optionalShortString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 512) throw new Error(`Invalid ${label}`)
  return value
}

function gumroadProductId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 160 ||
    !/^[a-z0-9_-]+={0,2}$/iu.test(value)
  ) {
    throw new Error('Invalid Gumroad product ID')
  }
  return value
}

function gumroadCheckoutUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new Error('Invalid Gumroad checkout URL')
  }
  const parsed = new URL(value)
  const match = /^\/l\/([a-z0-9_-]{3,128})\/?$/iu.exec(parsed.pathname)
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== CHECKOUT_HOST ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !match
  ) {
    throw new Error('Invalid Gumroad checkout URL')
  }
  const normalized = new URL(`https://${CHECKOUT_HOST}/l/${match[1]}`)
  if (parsed.searchParams.get('wanted') === 'true') normalized.searchParams.set('wanted', 'true')
  return normalized.toString()
}

function offerConfig(
  value: unknown,
  plan: OrbitPlusCommercePlan,
  testMode: boolean
): GumroadOfferConfig {
  const input = record(value, `Gumroad ${plan} offer`)
  const billing = plan === 'annual' ? 'yearly' : 'one-time'
  if (input.currency !== 'EUR' || input.billing !== billing) {
    throw new Error(`Invalid Gumroad ${plan} offer`)
  }
  return {
    plan,
    priceCents: positiveInteger(input.priceCents, `Gumroad ${plan} price`),
    currency: 'EUR',
    billing,
    testMode,
    available: false,
    checkoutUrl: gumroadCheckoutUrl(input.checkoutUrl),
    productId: gumroadProductId(input.productId)
  }
}

export function parseGumroadCommerceConfig(value: unknown): GumroadCommerceConfig | undefined {
  if (value === undefined || value === null) return undefined
  const input = record(value, 'Gumroad configuration')
  if (typeof input.enabled !== 'boolean') throw new Error('Invalid Gumroad rollout state')
  if (typeof input.testMode !== 'boolean') throw new Error('Invalid Gumroad test mode')
  const offers = record(input.offers, 'Gumroad offers')
  const annual = offerConfig(offers.annual, 'annual', input.testMode)
  const lifetime = offerConfig(offers.lifetime, 'lifetime', input.testMode)
  if (
    annual.productId === lifetime.productId ||
    annual.checkoutUrl === lifetime.checkoutUrl
  ) {
    throw new Error('Gumroad offers must use distinct products and checkout URLs')
  }
  return {
    enabled: input.enabled,
    testMode: input.testMode,
    offers: { annual, lifetime }
  }
}

export function publicGumroadOffers(
  config: GumroadCommerceConfig | undefined
): OrbitPlusCommerceOffer[] {
  if (!config) return []
  return COMMERCE_PLANS.map((plan) => {
    const { priceCents, currency, billing, testMode } = config.offers[plan]
    return { plan, priceCents, currency, billing, testMode, available: config.enabled }
  })
}

export function validatedGumroadLicenseKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid Gumroad license key')
  const normalized = value.trim()
  if (
    normalized.length < 16 ||
    normalized.length > 255 ||
    !/^[a-z0-9][a-z0-9_-]+$/iu.test(normalized)
  ) {
    throw new Error('Invalid Gumroad license key')
  }
  return normalized
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid Gumroad ${label}`)
  return value
}

function optionalExpiration(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`Invalid Gumroad ${label}`)
  const parsed = Date.parse(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid Gumroad ${label}`)
  return parsed
}

export function parseGumroadLicenseResponse(value: unknown): ParsedGumroadLicenseResponse {
  const input = record(value, 'Gumroad license response')
  if (typeof input.success !== 'boolean') throw new Error('Invalid Gumroad license result')
  if (!input.success) {
    return {
      succeeded: false,
      error: optionalShortString(input.message, 'license error'),
      testPurchase: false,
      refunded: false,
      disputed: false,
      chargebacked: false
    }
  }
  const purchase = record(input.purchase, 'Gumroad purchase')
  const expirationCandidates = [
    optionalExpiration(purchase.subscription_ended_at, 'subscription end'),
    optionalExpiration(purchase.subscription_cancelled_at, 'subscription cancellation'),
    optionalExpiration(purchase.subscription_failed_at, 'subscription failure')
  ].filter((timestamp): timestamp is number => timestamp !== undefined)
  return {
    succeeded: true,
    productId: gumroadProductId(purchase.product_id),
    licenseKey:
      purchase.license_key === undefined
        ? undefined
        : validatedGumroadLicenseKey(purchase.license_key),
    subscriptionId: optionalShortString(purchase.subscription_id, 'subscription ID'),
    recurrence: optionalShortString(purchase.recurrence, 'recurrence')?.toLowerCase(),
    expiresAt:
      expirationCandidates.length > 0 ? Math.min(...expirationCandidates) : undefined,
    testPurchase: booleanField(purchase.test ?? false, 'test purchase state'),
    refunded: booleanField(purchase.refunded ?? false, 'refund state'),
    disputed: booleanField(purchase.disputed ?? false, 'dispute state'),
    chargebacked: booleanField(purchase.chargebacked ?? false, 'chargeback state')
  }
}

export function matchingGumroadOffer(
  config: GumroadCommerceConfig,
  result: ParsedGumroadLicenseResponse
): GumroadOfferConfig | undefined {
  if (!result.succeeded || !result.productId) return undefined
  const offer = COMMERCE_PLANS.map((plan) => config.offers[plan]).find(
    (candidate) => candidate.productId === result.productId
  )
  if (!offer) return undefined
  if (offer.plan === 'annual') {
    return result.subscriptionId && result.recurrence && ANNUAL_RECURRENCES.has(result.recurrence)
      ? offer
      : undefined
  }
  return result.subscriptionId || result.recurrence ? undefined : offer
}

export function gumroadLicenseIssue(
  result: ParsedGumroadLicenseResponse,
  now = Date.now(),
  allowTestPurchases = false
): OrbitPlusIssue | undefined {
  if (!result.succeeded) return 'license-invalid'
  if (result.testPurchase && !allowTestPurchases) return 'license-test-purchase'
  if (result.refunded || result.disputed || result.chargebacked) return 'license-disabled'
  if (result.expiresAt !== undefined && result.expiresAt < now) return 'license-expired'
  return undefined
}
