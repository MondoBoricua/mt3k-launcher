import { app, safeStorage, shell } from 'electron'
import Store from 'electron-store'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS,
  orbitPlusConfirmedOfflineAccessUntil,
  orbitPlusHasFeature,
  orbitPlusMembershipDecisionAccess,
  type OrbitPlusConnectionStatus,
  type OrbitPlusEntitlement,
  type OrbitPlusFeature,
  type OrbitPlusIssue,
  type OrbitPlusMembershipDecision,
  type OrbitPlusOwnerTestAccess,
  type OrbitPlusSnapshot
} from '@shared/ipc'
import { fetchWithElectronNet, type MainProcessFetch } from '../networkFetch'
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
  validatedPatreonMembershipUrl
} from './orbitPlusPolicy'
import { parseGumroadCommerceConfig, type GumroadCommerceConfig } from './gumroadPolicy'
import { GumroadLicenseService, type GumroadProviderSnapshot } from './gumroadLicenseService'
import { orbitPlusCommunitySnapshot, parseOrbitPlusCommunityEdition } from './orbitPlusPolicy'

const DEFAULT_PATREON_MEMBERSHIP_URL =
  'https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership'
const REQUEST_TIMEOUT_MS = 12_000
const FRESH_ENTITLEMENT_MS = 20 * 60_000
const MEMBERSHIP_END_CONFIRMATION_DELAY_MS = 1_500
const OFFLINE_RETRY_GRACE_MS = 24 * 60 * 60_000

interface PublicOrbitPlusConfig {
  patreonMembershipUrl?: unknown
  serviceUrl?: unknown
  gumroad?: unknown
  communityEdition?: unknown
}

interface StoredOrbitPlusSession {
  sessionToken?: string
  accountName?: string
  entitlement?: OrbitPlusEntitlement
  membership?: OrbitPlusMembershipDecision
  offlineAccessUntil?: number
  ownerTestAccess?: OrbitPlusOwnerTestAccess
  checkedAt: number
}

interface EncryptedSessionStore {
  payload?: string
}

interface OrbitPlusServiceDependencies {
  fetch: MainProcessFetch
  openExternal: (url: string) => Promise<void>
  now: () => number
  delay: (milliseconds: number) => Promise<void>
}

const sessionStore = new Store<EncryptedSessionStore>({
  name: 'orbit-plus-session',
  defaults: {}
})

function configPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'orbit-plus.json')
    : join(app.getAppPath(), 'resources', 'orbit-plus.json')
}

function readPublicConfig(): PublicOrbitPlusConfig {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as PublicOrbitPlusConfig
  } catch {
    return {}
  }
}

function loadConfig(): {
  purchaseUrl: string
  serviceUrl?: string
  gumroad?: GumroadCommerceConfig
  communityEdition: boolean
} {
  const config = readPublicConfig()
  const communityEdition = parseOrbitPlusCommunityEdition(config.communityEdition)
  let purchaseUrl = DEFAULT_PATREON_MEMBERSHIP_URL
  let serviceUrl: string | undefined
  let gumroad: GumroadCommerceConfig | undefined
  try {
    purchaseUrl = validatedPatreonMembershipUrl(
      process.env['ORBIT_PATREON_MEMBERSHIP_URL'] ?? config.patreonMembershipUrl ?? purchaseUrl
    )
  } catch {
    // The built-in official Patreon page remains the safe fallback.
  }
  try {
    serviceUrl = validatedOrbitPlusServiceUrl(
      process.env['ORBIT_PLUS_SERVICE_URL'] ?? config.serviceUrl,
      !app.isPackaged
    )
  } catch {
    serviceUrl = undefined
  }
  try {
    gumroad = parseGumroadCommerceConfig(config.gumroad)
  } catch {
    gumroad = undefined
  }
  // Community builds never contact the membership service or the license store.
  if (communityEdition) return { purchaseUrl, communityEdition }
  return { purchaseUrl, serviceUrl, gumroad, communityEdition }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid ORBIT Plus service response')
  }
  return value as Record<string, unknown>
}

function validatedStoredSession(value: unknown): StoredOrbitPlusSession {
  const input = jsonRecord(value)
  if (typeof input.checkedAt !== 'number' || !Number.isSafeInteger(input.checkedAt)) {
    throw new Error('Invalid stored ORBIT Plus session')
  }
  if (
    input.sessionToken !== undefined &&
    (typeof input.sessionToken !== 'string' ||
      !input.sessionToken.trim() ||
      input.sessionToken.length > 8_192)
  ) {
    throw new Error('Invalid stored ORBIT Plus session')
  }
  const sessionToken =
    typeof input.sessionToken === 'string' ? input.sessionToken.trim() : undefined
  const accountName =
    typeof input.accountName === 'string' && input.accountName.trim().length <= 160
      ? input.accountName.trim()
      : undefined
  const entitlement =
    input.entitlement === undefined ? undefined : parseOrbitPlusEntitlement(input.entitlement)
  const membership =
    input.membership === undefined
      ? undefined
      : parseOrbitPlusMembershipDecision(input.membership, entitlement)
  if (
    input.offlineAccessUntil !== undefined &&
    (typeof input.offlineAccessUntil !== 'number' ||
      !Number.isSafeInteger(input.offlineAccessUntil) ||
      input.offlineAccessUntil <= 0)
  ) {
    throw new Error('Invalid stored ORBIT Plus session')
  }
  const offlineAccessUntil =
    typeof input.offlineAccessUntil === 'number' ? input.offlineAccessUntil : undefined
  if (!sessionToken && !entitlement) throw new Error('Invalid stored ORBIT Plus session')
  return {
    sessionToken,
    accountName,
    entitlement,
    membership,
    offlineAccessUntil,
    ownerTestAccess: parseOrbitPlusOwnerTestAccess(input.ownerTestAccess),
    checkedAt: input.checkedAt
  }
}

export class OrbitPlusService {
  private readonly dependencies: OrbitPlusServiceDependencies
  private readonly config = loadConfig()
  private readonly licenseService: GumroadLicenseService
  private session: StoredOrbitPlusSession | undefined
  private sessionLoaded = false
  private operationGeneration = 0
  private activeRequest: AbortController | undefined
  private connectionRunning = false

  constructor(
    dependencies: Partial<OrbitPlusServiceDependencies> = {}
  ) {
    this.dependencies = {
      fetch: dependencies.fetch ?? fetchWithElectronNet,
      openExternal: dependencies.openExternal ?? ((url) => shell.openExternal(url)),
      now: dependencies.now ?? Date.now,
      delay:
        dependencies.delay ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    }
    this.licenseService = new GumroadLicenseService(this.config.gumroad, {
      fetch: this.dependencies.fetch,
      openExternal: this.dependencies.openExternal,
      now: this.dependencies.now
    })
  }

  private secureStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private loadSession(): StoredOrbitPlusSession | undefined {
    if (this.sessionLoaded) return this.session
    this.sessionLoaded = true
    const payload = sessionStore.get('payload')
    if (!payload || !this.secureStorageAvailable()) return undefined
    try {
      this.session = validatedStoredSession(
        JSON.parse(safeStorage.decryptString(Buffer.from(payload, 'base64')))
      )
      return this.session
    } catch {
      sessionStore.delete('payload')
      this.session = undefined
      return undefined
    }
  }

  private saveSession(session: StoredOrbitPlusSession): void {
    if (!this.secureStorageAvailable()) {
      throw new Error('Secure credential storage is unavailable')
    }
    const validated = validatedStoredSession(session)
    sessionStore.set(
      'payload',
      safeStorage.encryptString(JSON.stringify(validated)).toString('base64')
    )
    this.session = validated
    this.sessionLoaded = true
  }

  private clearSession(): void {
    sessionStore.delete('payload')
    this.session = undefined
    this.sessionLoaded = true
  }

  private expireConnection(session: StoredOrbitPlusSession): void {
    if (!session.entitlement) {
      this.clearSession()
      return
    }
    this.saveSession({
      ...session,
      sessionToken: undefined,
      offlineAccessUntil: this.retryGraceUntil(session)
    })
  }

  private retryGraceUntil(session: StoredOrbitPlusSession): number | undefined {
    if (!session.entitlement || session.membership?.state === 'inactive') return undefined
    const confirmedMinimum = orbitPlusConfirmedOfflineAccessUntil(
      session.entitlement,
      session.membership,
      session.checkedAt
    )
    return Math.max(
      session.offlineAccessUntil ?? confirmedMinimum ?? 0,
      this.dependencies.now() + OFFLINE_RETRY_GRACE_MS
    )
  }

  private preserveAccessForRetry(session: StoredOrbitPlusSession): void {
    if (!session.entitlement || session.membership?.state === 'inactive') return
    try {
      this.saveSession({ ...session, offlineAccessUntil: this.retryGraceUntil(session) })
    } catch {
      // A failed retry must not turn a temporary storage problem into revocation.
    }
  }

  private snapshot(
    issue?: OrbitPlusIssue,
    licenseSnapshot: GumroadProviderSnapshot = this.licenseService.getSnapshot()
  ): OrbitPlusSnapshot {
    if (this.config.communityEdition) {
      return orbitPlusCommunitySnapshot(this.dependencies.now(), this.config.purchaseUrl)
    }
    const now = this.dependencies.now()
    const session = this.loadSession()
    const ownerDisabled = session?.ownerTestAccess?.enabled === false
    const entitlementNotExpired = freshEntitlementIsUsable(session?.entitlement, now)
    const freshlyVerified =
      entitlementNotExpired &&
      session !== undefined &&
      session.checkedAt + FRESH_ENTITLEMENT_MS >= now
    const cachedAccess = cachedEntitlementIsUsable(session?.entitlement, now)
    const entitlement = session?.entitlement
    const offlineAccessUntil = session
      ? session.offlineAccessUntil ??
        orbitPlusConfirmedOfflineAccessUntil(entitlement, session.membership, session.checkedAt)
      : undefined
    const offlineAccess =
      entitlement !== undefined &&
      offlineAccessUntil !== undefined &&
      offlineAccessUntil >= now
    const permanent = entitlement?.source === 'lifetime-key' && entitlement.expiresAt === undefined
    const legacyAccessUntil = Math.max(
      Math.min(
        entitlement?.expiresAt ?? Infinity,
        Math.max(
          (session?.checkedAt ?? 0) + FRESH_ENTITLEMENT_MS,
          permanent ? Infinity : entitlement?.offlineUntil ?? 0
        )
      ),
      offlineAccessUntil ?? 0
    )
    const decisionAccess = session?.membership
      ? orbitPlusMembershipDecisionAccess(
          session.membership,
          entitlement,
          now,
          offlineAccessUntil
        )
      : undefined
    const access = ownerDisabled
      ? 'locked'
      : decisionAccess?.access ??
        (freshlyVerified ? 'active' : cachedAccess || offlineAccess ? 'grace' : 'locked')
    const accessUntil = decisionAccess?.accessUntil ??
      ((freshlyVerified || cachedAccess || offlineAccess) && Number.isFinite(legacyAccessUntil)
        ? legacyAccessUntil
        : undefined)
    const accessGranted = access === 'active' || access === 'grace'
    const patreonSnapshot: OrbitPlusSnapshot = {
      access,
      accessUntil: accessGranted ? accessUntil : undefined,
      connected: Boolean(session?.sessionToken),
      serviceAvailable: Boolean(this.config.serviceUrl),
      secureStorageAvailable: this.secureStorageAvailable(),
      purchaseUrl: this.config.purchaseUrl,
      accountName: session?.accountName,
      entitlement: accessGranted ? entitlement : undefined,
      membership: session?.membership,
      offlineAccessUntil,
      ownerTestAccess: session?.ownerTestAccess,
      checkedAt: session?.checkedAt,
      issue:
        issue ??
        (!this.config.serviceUrl
          ? 'service-not-configured'
          : !this.secureStorageAvailable()
            ? 'secure-storage-unavailable'
            : undefined)
    }
    const patreonGranted =
      patreonSnapshot.access !== 'locked' && patreonSnapshot.entitlement !== undefined
    const licenseGranted =
      licenseSnapshot.access !== 'locked' && licenseSnapshot.entitlement !== undefined
    const licenseWins =
      licenseGranted &&
      (!patreonGranted ||
        (licenseSnapshot.access === 'active' && patreonSnapshot.access === 'grace') ||
        licenseSnapshot.entitlement?.plan === 'lifetime')
    return {
      ...patreonSnapshot,
      ...(licenseWins
        ? {
            access: licenseSnapshot.access,
            accessUntil: licenseSnapshot.accessUntil,
            offlineAccessUntil: licenseSnapshot.license.offlineAccessUntil,
            entitlement: licenseSnapshot.entitlement,
            membership: undefined,
            accountName: undefined
          }
        : {}),
      offers: this.licenseService.offers(),
      license: licenseSnapshot.license,
      activeSources: [
        ...(patreonGranted ? (['patreon'] as const) : []),
        ...(licenseGranted && licenseSnapshot.entitlement
          ? [licenseSnapshot.entitlement.source]
          : [])
      ],
      issue: issue ?? licenseSnapshot.issue ?? patreonSnapshot.issue
    }
  }

  getSnapshot(): OrbitPlusSnapshot {
    return this.snapshot()
  }

  hasFeature(feature: OrbitPlusFeature): boolean {
    return orbitPlusHasFeature(this.snapshot(), feature, this.dependencies.now())
  }

  requireFeature(feature: OrbitPlusFeature): void {
    if (!this.hasFeature(feature)) throw new Error(`ORBIT Plus required: ${feature}`)
  }

  private beginOperation(): number {
    this.activeRequest?.abort()
    this.activeRequest = undefined
    return ++this.operationGeneration
  }

  private async requestJson(
    path: string,
    init: RequestInit = {},
    acceptedStatuses: readonly number[] = [200]
  ): Promise<{ response: Response; body: Record<string, unknown> }> {
    if (!this.config.serviceUrl) throw new Error('ORBIT Plus service is not configured')
    const request = new AbortController()
    this.activeRequest = request
    const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.dependencies.fetch(`${this.config.serviceUrl}${path}`, {
        ...init,
        signal: request.signal,
        headers: {
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers
        }
      })
      if (!acceptedStatuses.includes(response.status)) {
        return { response, body: {} }
      }
      if (response.status === 204) return { response, body: {} }
      return { response, body: jsonRecord(await response.json()) }
    } finally {
      clearTimeout(timeout)
      if (this.activeRequest === request) this.activeRequest = undefined
    }
  }

  async restore(): Promise<OrbitPlusSnapshot> {
    return this.refresh(false)
  }

  private async refreshPatreon(force = false): Promise<OrbitPlusSnapshot> {
    if (this.connectionRunning) return this.snapshot()
    const session = this.loadSession()
    if (!session) return this.snapshot()
    if (
      !force &&
      session.checkedAt + ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS > this.dependencies.now()
    ) {
      return this.snapshot()
    }
    if (!session.sessionToken) {
      this.preserveAccessForRetry(session)
      return this.snapshot('session-expired')
    }
    if (!this.config.serviceUrl) {
      this.preserveAccessForRetry(session)
      return this.snapshot('service-not-configured')
    }
    const generation = this.beginOperation()
    try {
      const readMembership = () => this.requestJson('/v1/entitlements/orbit-plus', {
        headers: { authorization: `Bearer ${session.sessionToken}` }
      }, [200, 401])
      let { response, body } = await readMembership()
      if (generation !== this.operationGeneration) return this.snapshot()
      if (response.status === 401) {
        this.expireConnection(session)
        return this.snapshot('session-expired')
      }
      if (response.status !== 200) throw new Error('ORBIT Plus refresh failed')
      const parseMembership = (value: Record<string, unknown>) => {
        const parsedEntitlement =
          value.entitlement === undefined
            ? undefined
            : parseOrbitPlusEntitlement(value.entitlement)
        const membership =
          value.membership === undefined
            ? undefined
            : parseOrbitPlusMembershipDecision(value.membership, parsedEntitlement)
        return {
          entitlement:
            membership || freshEntitlementIsUsable(parsedEntitlement, this.dependencies.now())
              ? parsedEntitlement
              : undefined,
          membership,
          ownerTestAccess: parseOrbitPlusOwnerTestAccess(value.ownerTestAccess)
        }
      }
      let parsed = parseMembership(body)
      if (orbitPlusMembershipDecisionIsStale(session.membership, parsed.membership)) {
        this.preserveAccessForRetry(session)
        return this.snapshot('verification-failed')
      }
      if (
        parsed.membership === undefined &&
        orbitPlusMembershipEndNeedsConfirmation(
          session.entitlement,
          parsed.entitlement,
          parsed.ownerTestAccess
        )
      ) {
        await this.dependencies.delay(MEMBERSHIP_END_CONFIRMATION_DELAY_MS)
        if (generation !== this.operationGeneration) return this.snapshot()
        const confirmation = await readMembership()
        if (generation !== this.operationGeneration) return this.snapshot()
        if (confirmation.response.status === 401) {
          this.expireConnection(session)
          return this.snapshot('session-expired')
        }
        if (confirmation.response.status !== 200) {
          throw new Error('ORBIT Plus membership-end confirmation failed')
        }
        body = confirmation.body
        parsed = parseMembership(body)
        if (orbitPlusMembershipDecisionIsStale(session.membership, parsed.membership)) {
          this.preserveAccessForRetry(session)
          return this.snapshot('verification-failed')
        }
      }
      const accountName =
        typeof body.accountName === 'string' && body.accountName.trim().length <= 160
          ? body.accountName.trim()
          : session.accountName
      const checkedAt = this.dependencies.now()
      this.saveSession({
        sessionToken: session.sessionToken,
        accountName,
        entitlement: parsed.entitlement,
        membership: parsed.membership,
        offlineAccessUntil: orbitPlusConfirmedOfflineAccessUntil(
          parsed.entitlement,
          parsed.membership,
          checkedAt
        ),
        ownerTestAccess: parsed.ownerTestAccess,
        checkedAt
      })
      if (!parsed.entitlement) {
        return this.snapshot(
          parsed.ownerTestAccess && !parsed.ownerTestAccess.enabled
            ? 'owner-test-disabled'
            : 'membership-required'
        )
      }
      return this.snapshot()
    } catch {
      if (generation !== this.operationGeneration) return this.snapshot()
      this.preserveAccessForRetry(this.loadSession() ?? session)
      return this.snapshot('network-unavailable')
    }
  }

  async refresh(forceValue: unknown = false): Promise<OrbitPlusSnapshot> {
    if (typeof forceValue !== 'boolean') throw new Error('Invalid ORBIT Plus refresh mode')
    if (this.config.communityEdition) return this.snapshot()
    const licenseSnapshot = await this.licenseService.refresh(forceValue)
    const patreonSnapshot = await this.refreshPatreon(forceValue)
    return this.snapshot(patreonSnapshot.issue ?? licenseSnapshot.issue, licenseSnapshot)
  }

  async startPatreonConnection(
    sendStatus: (status: OrbitPlusConnectionStatus) => void
  ): Promise<OrbitPlusSnapshot> {
    if (this.config.communityEdition) {
      const snapshot = this.snapshot()
      sendStatus({ state: 'success', snapshot })
      return snapshot
    }
    if (this.connectionRunning) {
      const snapshot = this.snapshot()
      sendStatus({ state: 'waiting-for-browser', snapshot })
      return snapshot
    }
    if (!this.config.serviceUrl) {
      const snapshot = this.snapshot('service-not-configured')
      sendStatus({ state: 'error', issue: 'service-not-configured', snapshot })
      return snapshot
    }
    if (!this.secureStorageAvailable()) {
      const snapshot = this.snapshot('secure-storage-unavailable')
      sendStatus({ state: 'error', issue: 'secure-storage-unavailable', snapshot })
      return snapshot
    }

    const generation = this.beginOperation()
    this.connectionRunning = true
    try {
      sendStatus({ state: 'opening-browser', snapshot: this.snapshot() })
      const deviceVerifier = randomBytes(32).toString('base64url')
      const deviceChallenge = createHash('sha256').update(deviceVerifier).digest('base64url')
      const { response, body } = await this.requestJson(
        '/v1/patreon/device-sessions',
        {
          method: 'POST',
          body: JSON.stringify({
            clientVersion: app.getVersion(),
            platform: process.platform,
            deviceChallenge
          })
        },
        [201]
      )
      if (generation !== this.operationGeneration) return this.snapshot()
      if (response.status !== 201) throw new Error('Could not start ORBIT Plus connection')
      const started = parseOrbitPlusStartResponse(
        body,
        this.config.serviceUrl,
        this.dependencies.now()
      )
      await this.dependencies.openExternal(started.authorizationUrl)
      if (generation !== this.operationGeneration) return this.snapshot()
      sendStatus({ state: 'waiting-for-browser', snapshot: this.snapshot() })

      while (this.dependencies.now() < started.expiresAt) {
        await this.dependencies.delay(started.pollIntervalMs)
        if (generation !== this.operationGeneration) return this.snapshot()
        const { response: pollResponse, body: pollBody } = await this.requestJson(
          `/v1/patreon/device-sessions/${encodeURIComponent(started.sessionId)}`,
          { headers: { 'x-orbit-device-verifier': deviceVerifier } },
          [200, 410]
        )
        if (generation !== this.operationGeneration) return this.snapshot()
        if (pollResponse.status === 410) {
          const existingSession = this.loadSession()
          if (existingSession) this.preserveAccessForRetry(existingSession)
          const snapshot = this.snapshot('session-expired')
          sendStatus({ state: 'error', issue: 'session-expired', snapshot })
          return snapshot
        }
        const status = parseOrbitPlusPollResponse(pollBody)
        if (status.state === 'pending') continue
        if (status.state === 'verifying') {
          sendStatus({ state: 'verifying', snapshot: this.snapshot() })
          continue
        }
        if (status.state !== 'complete') {
          const existingSession = this.loadSession()
          if (existingSession) this.preserveAccessForRetry(existingSession)
          const issue: OrbitPlusIssue =
            status.state === 'expired' ? 'session-expired' : 'verification-failed'
          const snapshot = this.snapshot(issue)
          sendStatus({ state: 'error', issue, snapshot })
          return snapshot
        }

        const entitlement =
          status.membership || freshEntitlementIsUsable(status.entitlement, this.dependencies.now())
            ? status.entitlement
            : undefined
        const checkedAt = this.dependencies.now()
        this.saveSession({
          sessionToken: status.sessionToken,
          accountName: status.accountName,
          entitlement,
          membership: status.membership,
          offlineAccessUntil: orbitPlusConfirmedOfflineAccessUntil(
            entitlement,
            status.membership,
            checkedAt
          ),
          ownerTestAccess: status.ownerTestAccess,
          checkedAt
        })
        const current = this.snapshot()
        const snapshot = current.access !== 'locked'
          ? current
          : this.snapshot(
              status.ownerTestAccess && !status.ownerTestAccess.enabled
                ? 'owner-test-disabled'
                : 'membership-required'
            )
        sendStatus({ state: 'success', snapshot })
        return snapshot
      }
      const snapshot = this.snapshot('session-expired')
      sendStatus({ state: 'error', issue: 'session-expired', snapshot })
      return snapshot
    } catch {
      if (generation !== this.operationGeneration) return this.snapshot()
      const existingSession = this.loadSession()
      if (existingSession) this.preserveAccessForRetry(existingSession)
      const snapshot = this.snapshot('network-unavailable')
      sendStatus({ state: 'error', issue: 'network-unavailable', snapshot })
      return snapshot
    } finally {
      if (generation === this.operationGeneration) {
        this.activeRequest = undefined
        this.connectionRunning = false
      }
    }
  }

  cancelPatreonConnection(): OrbitPlusSnapshot {
    this.beginOperation()
    this.connectionRunning = false
    return this.snapshot('cancelled')
  }

  async openCheckout(plan: unknown): Promise<void> {
    if (this.config.communityEdition) return
    await this.licenseService.openCheckout(plan)
  }

  async activateLicense(key: unknown): Promise<OrbitPlusSnapshot> {
    if (this.config.communityEdition) return this.snapshot()
    const licenseSnapshot = await this.licenseService.activate(key)
    return this.snapshot(licenseSnapshot.issue, licenseSnapshot)
  }

  async deactivateLicense(): Promise<OrbitPlusSnapshot> {
    if (this.config.communityEdition) return this.snapshot()
    const licenseSnapshot = await this.licenseService.deactivate()
    return this.snapshot(licenseSnapshot.issue, licenseSnapshot)
  }

  async setOwnerTestAccess(enabled: unknown): Promise<OrbitPlusSnapshot> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid owner test access state')
    if (this.config.communityEdition) return this.snapshot()
    if (this.connectionRunning) return this.snapshot()
    const session = this.loadSession()
    if (!session || !session.ownerTestAccess?.available) {
      return this.snapshot('verification-failed')
    }
    if (!session.sessionToken) return this.snapshot('session-expired')
    if (!this.config.serviceUrl) return this.snapshot('service-not-configured')

    const generation = this.beginOperation()
    try {
      const { response, body } = await this.requestJson(
        '/v1/entitlements/orbit-plus/owner-test',
        {
          method: 'PUT',
          headers: { authorization: `Bearer ${session.sessionToken}` },
          body: JSON.stringify({ enabled })
        },
        [200, 401, 404]
      )
      if (generation !== this.operationGeneration) return this.snapshot()
      if (response.status === 401) {
        this.expireConnection(session)
        return this.snapshot('session-expired')
      }
      if (response.status !== 200) return this.snapshot('verification-failed')

      const ownerTestAccess = parseOrbitPlusOwnerTestAccess(body.ownerTestAccess)
      if (!ownerTestAccess || ownerTestAccess.enabled !== enabled) {
        return this.snapshot('verification-failed')
      }
      const entitlement =
        body.entitlement === undefined ? undefined : parseOrbitPlusEntitlement(body.entitlement)
      const membership =
        body.membership === undefined
          ? undefined
          : parseOrbitPlusMembershipDecision(body.membership, entitlement)
      if (orbitPlusMembershipDecisionIsStale(session.membership, membership)) {
        this.preserveAccessForRetry(session)
        return this.snapshot('verification-failed')
      }
      const accountName =
        typeof body.accountName === 'string' && body.accountName.trim().length <= 160
          ? body.accountName.trim()
          : session.accountName
      const checkedAt = this.dependencies.now()
      this.saveSession({
        sessionToken: session.sessionToken,
        accountName,
        entitlement,
        membership,
        offlineAccessUntil: enabled
          ? orbitPlusConfirmedOfflineAccessUntil(entitlement, membership, checkedAt)
          : undefined,
        ownerTestAccess,
        checkedAt
      })
      if (!enabled) return this.snapshot('owner-test-disabled')
      if (this.snapshot().access === 'locked') {
        return this.snapshot('verification-failed')
      }
      return this.snapshot()
    } catch {
      if (generation !== this.operationGeneration) return this.snapshot()
      this.preserveAccessForRetry(this.loadSession() ?? session)
      return this.snapshot('network-unavailable')
    }
  }

  async disconnect(): Promise<OrbitPlusSnapshot> {
    if (this.config.communityEdition) return this.snapshot()
    const session = this.loadSession()
    this.cancelPatreonConnection()
    this.clearSession()
    if (session?.sessionToken && this.config.serviceUrl) {
      await this.requestJson(
        '/v1/sessions/current',
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${session.sessionToken}` }
        },
        [200, 204, 401]
      ).catch(() => undefined)
    }
    return this.snapshot()
  }

  dispose(): void {
    this.cancelPatreonConnection()
    this.licenseService.dispose()
  }
}

export const orbitPlusService = new OrbitPlusService()
