import { app, safeStorage, shell } from 'electron'
import Store from 'electron-store'
import {
  ORBIT_PLUS_FEATURES,
  ORBIT_PLUS_LICENSE_REFRESH_INTERVAL_MS,
  ORBIT_PLUS_OFFLINE_ACCESS_MINIMUM_MS,
  type OrbitPlusAccessState,
  type OrbitPlusCommercePlan,
  type OrbitPlusEntitlement,
  type OrbitPlusIssue,
  type OrbitPlusLicenseSnapshot
} from '@shared/ipc'
import { fetchWithElectronNet, type MainProcessFetch } from '../networkFetch'
import {
  gumroadLicenseIssue,
  matchingGumroadOffer,
  parseGumroadLicenseResponse,
  publicGumroadOffers,
  validatedGumroadLicenseKey,
  type GumroadCommerceConfig,
  type GumroadOfferConfig,
  type ParsedGumroadLicenseResponse
} from './gumroadPolicy'

const LICENSE_API_URL = 'https://api.gumroad.com/v2/licenses/verify'
const REQUEST_TIMEOUT_MS = 12_000
const FRESH_LICENSE_MS = ORBIT_PLUS_LICENSE_REFRESH_INTERVAL_MS
const FORCED_REFRESH_COOLDOWN_MS = 30_000
const NEGATIVE_CONFIRMATION_DELAY_MS = 1_500
const ACTIVATION_ATTEMPT_WINDOW_MS = 60_000
const MAX_ACTIVATION_ATTEMPTS_PER_WINDOW = 5

type StoredLicenseState = 'active' | 'expired' | 'disabled'

interface StoredGumroadLicense {
  schemaVersion: 2
  key: string
  plan: OrbitPlusCommercePlan
  state: StoredLicenseState
  checkedAt: number
  expiresAt?: number
  offlineAccessUntil?: number
  testPurchase: boolean
}

interface EncryptedLicenseStore {
  payload?: string
}

interface GumroadLicenseDependencies {
  fetch: MainProcessFetch
  openExternal: (url: string) => Promise<void>
  now: () => number
  delay: (milliseconds: number) => Promise<void>
  allowTestPurchases: boolean
}

export interface GumroadProviderSnapshot {
  access: OrbitPlusAccessState
  accessUntil?: number
  entitlement?: OrbitPlusEntitlement
  license: OrbitPlusLicenseSnapshot
  issue?: OrbitPlusIssue
}

const licenseStore = new Store<EncryptedLicenseStore>({
  name: 'orbit-plus-gumroad-license',
  defaults: {}
})

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid stored ORBIT Plus license')
  }
  return value as Record<string, unknown>
}

function storedTimestamp(value: unknown, label: string, optional = false): number | undefined {
  if (optional && value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid stored ORBIT Plus license ${label}`)
  }
  return value
}

function validatedStoredLicense(value: unknown): StoredGumroadLicense {
  const input = record(value)
  if (input.plan !== 'annual' && input.plan !== 'lifetime') {
    throw new Error('Invalid stored ORBIT Plus license plan')
  }
  if (!['active', 'expired', 'disabled'].includes(String(input.state))) {
    throw new Error('Invalid stored ORBIT Plus license state')
  }
  const legacySession = input.schemaVersion !== 2
  if (!legacySession && typeof input.testPurchase !== 'boolean') {
    throw new Error('Invalid stored ORBIT Plus license test state')
  }
  return {
    schemaVersion: 2,
    key: validatedGumroadLicenseKey(input.key),
    plan: input.plan,
    state: input.state as StoredLicenseState,
    // Pre-hardening records did not persist Gumroad's test-purchase flag. Force
    // them through one authoritative check before granting permanent access.
    checkedAt: legacySession ? 1 : storedTimestamp(input.checkedAt, 'check time')!,
    expiresAt: storedTimestamp(input.expiresAt, 'expiration', true),
    offlineAccessUntil: storedTimestamp(input.offlineAccessUntil, 'offline deadline', true),
    testPurchase: legacySession ? false : input.testPurchase as boolean
  }
}

function responseRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export class GumroadLicenseService {
  private readonly config: GumroadCommerceConfig | undefined
  private readonly dependencies: GumroadLicenseDependencies
  private session: StoredGumroadLicense | undefined
  private sessionLoaded = false
  private operationGeneration = 0
  private activeRequest: AbortController | undefined
  private activationAttempts: number[] = []
  private lastRefreshAttemptAt = 0

  constructor(
    config: GumroadCommerceConfig | undefined,
    dependencies: Partial<GumroadLicenseDependencies> = {}
  ) {
    this.config = config
    this.dependencies = {
      fetch: dependencies.fetch ?? fetchWithElectronNet,
      openExternal: dependencies.openExternal ?? ((url) => shell.openExternal(url)),
      now: dependencies.now ?? Date.now,
      delay:
        dependencies.delay ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      allowTestPurchases: dependencies.allowTestPurchases ?? !app.isPackaged
    }
  }

  offers() {
    return publicGumroadOffers(this.config)
  }

  private secureStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private loadSession(): StoredGumroadLicense | undefined {
    if (this.sessionLoaded) return this.session
    this.sessionLoaded = true
    const payload = licenseStore.get('payload')
    if (!payload || !this.secureStorageAvailable()) return undefined
    try {
      this.session = validatedStoredLicense(
        JSON.parse(safeStorage.decryptString(Buffer.from(payload, 'base64')))
      )
      return this.session
    } catch {
      licenseStore.delete('payload')
      this.session = undefined
      return undefined
    }
  }

  private saveSession(session: StoredGumroadLicense): void {
    if (!this.secureStorageAvailable()) throw new Error('Secure credential storage is unavailable')
    const validated = validatedStoredLicense(session)
    licenseStore.set(
      'payload',
      safeStorage.encryptString(JSON.stringify(validated)).toString('base64')
    )
    this.session = validated
    this.sessionLoaded = true
  }

  private clearSession(): void {
    licenseStore.delete('payload')
    this.session = undefined
    this.sessionLoaded = true
  }

  private beginOperation(): number {
    this.activeRequest?.abort()
    this.activeRequest = undefined
    return ++this.operationGeneration
  }

  private async verify(
    offer: GumroadOfferConfig,
    key: string
  ): Promise<{ status: number; result: ParsedGumroadLicenseResponse }> {
    const request = new AbortController()
    this.activeRequest = request
    const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.dependencies.fetch(LICENSE_API_URL, {
        method: 'POST',
        signal: request.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          product_id: offer.productId,
          license_key: key,
          increment_uses_count: 'false'
        }).toString()
      })
      const contentType = response.headers.get('content-type')?.toLowerCase()
      if (!contentType?.includes('application/json')) {
        throw new Error('Unexpected Gumroad response type')
      }
      let body: Record<string, unknown> = {}
      try {
        body = responseRecord(await response.json())
      } catch {
        body = {}
      }
      return { status: response.status, result: parseGumroadLicenseResponse(body) }
    } finally {
      clearTimeout(timeout)
      if (this.activeRequest === request) this.activeRequest = undefined
    }
  }

  private sessionSnapshot(
    session: StoredGumroadLicense,
    issue?: OrbitPlusIssue
  ): GumroadProviderSnapshot {
    const now = this.dependencies.now()
    const permanent =
      session.plan === 'lifetime' &&
      session.state === 'active' &&
      session.expiresAt === undefined &&
      (!session.testPurchase || this.dependencies.allowTestPurchases)
    const testPurchaseLocked = session.testPurchase && !this.dependencies.allowTestPurchases
    const explicitlyLocked = session.state !== 'active' || testPurchaseLocked
    const knownExpired = session.expiresAt !== undefined && session.expiresAt < now
    const freshnessDeadline = session.checkedAt + FRESH_LICENSE_MS
    const offlineDeadline = session.offlineAccessUntil ?? 0
    const accessUntil = permanent
      ? Infinity
      : Math.min(session.expiresAt ?? Infinity, Math.max(freshnessDeadline, offlineDeadline))
    const access: OrbitPlusAccessState =
      explicitlyLocked || knownExpired || accessUntil < now
        ? 'locked'
        : permanent || freshnessDeadline >= now
          ? 'active'
          : 'grace'
    const source = session.plan === 'annual' ? 'annual-pass' : 'lifetime-key'
    const entitlement: OrbitPlusEntitlement | undefined =
      access === 'locked'
        ? undefined
        : {
            source,
            plan: session.plan,
            features: [...ORBIT_PLUS_FEATURES],
            verifiedAt: session.checkedAt,
            expiresAt: session.expiresAt,
            offlineUntil: permanent ? undefined : session.offlineAccessUntil
          }
    const state: OrbitPlusLicenseSnapshot['state'] =
      session.state === 'active'
        ? access === 'locked'
          ? 'verification-required'
          : access
        : session.state
    return {
      access,
      accessUntil: access === 'locked' || !Number.isFinite(accessUntil) ? undefined : accessUntil,
      entitlement,
      license: {
        state,
        configured: true,
        plan: session.plan,
        checkedAt: session.checkedAt,
        expiresAt: session.expiresAt,
        offlineAccessUntil: permanent ? undefined : session.offlineAccessUntil
      },
      issue: issue ?? (testPurchaseLocked ? 'license-test-purchase' : undefined)
    }
  }

  getSnapshot(issue?: OrbitPlusIssue): GumroadProviderSnapshot {
    const session = this.loadSession()
    if (session) return this.sessionSnapshot(session, issue)
    return {
      access: 'locked',
      license: { state: 'none', configured: false },
      issue
    }
  }

  private activationAttemptAllowed(now: number): boolean {
    this.activationAttempts = this.activationAttempts.filter(
      (attemptedAt) => attemptedAt + ACTIVATION_ATTEMPT_WINDOW_MS > now
    )
    if (this.activationAttempts.length >= MAX_ACTIVATION_ATTEMPTS_PER_WINDOW) return false
    this.activationAttempts.push(now)
    return true
  }

  private definitiveNegativeVerification(
    verified: { status: number; result: ParsedGumroadLicenseResponse }
  ): boolean {
    return (
      !verified.result.succeeded &&
      (verified.status === 400 || verified.status === 404)
    )
  }

  async openCheckout(planValue: unknown): Promise<void> {
    if (planValue !== 'annual' && planValue !== 'lifetime') {
      throw new Error('Invalid ORBIT Plus checkout plan')
    }
    const offer = this.config?.offers[planValue]
    if (!offer || !this.config?.enabled) throw new Error('ORBIT Plus checkout is not available')
    await this.dependencies.openExternal(offer.checkoutUrl)
  }

  async activate(keyValue: unknown): Promise<GumroadProviderSnapshot> {
    let key: string
    try {
      key = validatedGumroadLicenseKey(keyValue)
    } catch {
      return this.getSnapshot('license-invalid')
    }
    if (!this.config?.enabled) return this.getSnapshot('service-not-configured')
    if (!this.secureStorageAvailable()) return this.getSnapshot('secure-storage-unavailable')
    const attemptTime = this.dependencies.now()
    if (!this.activationAttemptAllowed(attemptTime)) {
      return this.getSnapshot('license-activation-limit')
    }
    const previous = this.loadSession()
    if (previous?.key === key && previous.state === 'active') return this.refresh(true)

    const generation = this.beginOperation()
    try {
      for (const plan of ['annual', 'lifetime'] as const) {
        const offer = this.config.offers[plan]
        const verified = await this.verify(offer, key)
        if (generation !== this.operationGeneration) return this.getSnapshot()
        if (
          verified.status >= 500 ||
          verified.status === 401 ||
          verified.status === 403 ||
          verified.status === 408 ||
          verified.status === 425 ||
          verified.status === 429
        ) {
          throw new Error('Gumroad unavailable')
        }
        if (!verified.result.succeeded) continue
        if (verified.status !== 200) throw new Error('Unexpected Gumroad status')
        if (verified.result.licenseKey && verified.result.licenseKey !== key) {
          return this.getSnapshot('license-invalid')
        }
        const matchedOffer = matchingGumroadOffer(this.config, verified.result)
        if (!matchedOffer || matchedOffer.plan !== plan) {
          return this.getSnapshot('license-product-mismatch')
        }
        const issue = gumroadLicenseIssue(
          verified.result,
          this.dependencies.now(),
          this.dependencies.allowTestPurchases
        )
        if (issue) return this.getSnapshot(issue)
        const now = this.dependencies.now()
        this.saveSession({
          schemaVersion: 2,
          key,
          plan,
          state: 'active',
          checkedAt: now,
          expiresAt: verified.result.expiresAt,
          offlineAccessUntil:
            plan === 'annual' ? now + ORBIT_PLUS_OFFLINE_ACCESS_MINIMUM_MS : undefined,
          testPurchase: verified.result.testPurchase
        })
        this.activationAttempts = []
        return this.getSnapshot()
      }
      return this.getSnapshot('license-invalid')
    } catch {
      if (generation !== this.operationGeneration) return this.getSnapshot()
      return this.getSnapshot(previous ? 'network-unavailable' : 'verification-failed')
    }
  }

  async refresh(force = false): Promise<GumroadProviderSnapshot> {
    const session = this.loadSession()
    if (!session) return this.getSnapshot()
    if (!this.config?.enabled) return this.getSnapshot('service-not-configured')
    const attemptTime = this.dependencies.now()
    if (
      !force &&
      session.state === 'active' &&
      session.checkedAt + ORBIT_PLUS_LICENSE_REFRESH_INTERVAL_MS > attemptTime
    ) {
      return this.getSnapshot()
    }
    if (this.lastRefreshAttemptAt + FORCED_REFRESH_COOLDOWN_MS > attemptTime) {
      return this.getSnapshot()
    }
    this.lastRefreshAttemptAt = attemptTime
    const generation = this.beginOperation()
    try {
      const offer = this.config.offers[session.plan]
      let verified = await this.verify(offer, session.key)
      if (generation !== this.operationGeneration) return this.getSnapshot()
      if (this.definitiveNegativeVerification(verified)) {
        await this.dependencies.delay(NEGATIVE_CONFIRMATION_DELAY_MS)
        if (generation !== this.operationGeneration) return this.getSnapshot()
        const confirmation = await this.verify(offer, session.key)
        if (generation !== this.operationGeneration) return this.getSnapshot()
        if (this.definitiveNegativeVerification(confirmation)) {
          this.saveSession({
            ...session,
            state: 'disabled',
            checkedAt: this.dependencies.now(),
            offlineAccessUntil: undefined
          })
          return this.getSnapshot('license-invalid')
        }
        verified = confirmation
      }
      if (verified.status !== 200 || !verified.result.succeeded) {
        throw new Error('Gumroad verification unavailable')
      }
      const matchedOffer = matchingGumroadOffer(this.config, verified.result)
      if (!matchedOffer || matchedOffer.plan !== session.plan) {
        return this.getSnapshot('license-product-mismatch')
      }
      const issue = gumroadLicenseIssue(
        verified.result,
        this.dependencies.now(),
        this.dependencies.allowTestPurchases
      )
      if (issue) {
        this.saveSession({
          ...session,
          state: issue === 'license-expired' ? 'expired' : 'disabled',
          checkedAt: this.dependencies.now(),
          expiresAt: verified.result.expiresAt,
          offlineAccessUntil: undefined,
          testPurchase: verified.result.testPurchase
        })
        return this.getSnapshot(issue)
      }
      const now = this.dependencies.now()
      this.saveSession({
        ...session,
        state: 'active',
        checkedAt: now,
        expiresAt: verified.result.expiresAt,
        offlineAccessUntil:
          session.plan === 'annual' ? now + ORBIT_PLUS_OFFLINE_ACCESS_MINIMUM_MS : undefined,
        testPurchase: verified.result.testPurchase
      })
      return this.getSnapshot()
    } catch {
      if (generation !== this.operationGeneration) return this.getSnapshot()
      return this.getSnapshot('network-unavailable')
    }
  }

  async deactivate(): Promise<GumroadProviderSnapshot> {
    this.beginOperation()
    this.clearSession()
    return this.getSnapshot()
  }

  dispose(): void {
    this.beginOperation()
  }
}
