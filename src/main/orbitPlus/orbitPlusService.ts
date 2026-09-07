import { app, safeStorage, shell } from 'electron'
import Store from 'electron-store'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  orbitPlusHasFeature,
  type OrbitPlusConnectionStatus,
  type OrbitPlusEntitlement,
  type OrbitPlusFeature,
  type OrbitPlusIssue,
  type OrbitPlusOwnerTestAccess,
  type OrbitPlusSnapshot
} from '@shared/ipc'
import { fetchWithElectronNet, type MainProcessFetch } from '../networkFetch'
import {
  cachedEntitlementIsUsable,
  freshEntitlementIsUsable,
  parseOrbitPlusEntitlement,
  parseOrbitPlusOwnerTestAccess,
  parseOrbitPlusPollResponse,
  parseOrbitPlusStartResponse,
  validatedOrbitPlusServiceUrl,
  validatedPatreonMembershipUrl
} from './orbitPlusPolicy'

const DEFAULT_PATREON_MEMBERSHIP_URL =
  'https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership'
const REQUEST_TIMEOUT_MS = 12_000
const FRESH_ENTITLEMENT_MS = 20 * 60_000

interface PublicOrbitPlusConfig {
  patreonMembershipUrl?: unknown
  serviceUrl?: unknown
}

interface StoredOrbitPlusSession {
  sessionToken: string
  accountName?: string
  entitlement?: OrbitPlusEntitlement
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

function loadConfig(): { purchaseUrl: string; serviceUrl?: string } {
  const config = readPublicConfig()
  let purchaseUrl = DEFAULT_PATREON_MEMBERSHIP_URL
  let serviceUrl: string | undefined
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
  return { purchaseUrl, serviceUrl }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid ORBIT Plus service response')
  }
  return value as Record<string, unknown>
}

function validatedStoredSession(value: unknown): StoredOrbitPlusSession {
  const input = jsonRecord(value)
  if (
    typeof input.sessionToken !== 'string' ||
    !input.sessionToken.trim() ||
    input.sessionToken.length > 8_192 ||
    typeof input.checkedAt !== 'number' ||
    !Number.isSafeInteger(input.checkedAt)
  ) {
    throw new Error('Invalid stored ORBIT Plus session')
  }
  const accountName =
    typeof input.accountName === 'string' && input.accountName.trim().length <= 160
      ? input.accountName.trim()
      : undefined
  return {
    sessionToken: input.sessionToken.trim(),
    accountName,
    entitlement:
      input.entitlement === undefined ? undefined : parseOrbitPlusEntitlement(input.entitlement),
    ownerTestAccess: parseOrbitPlusOwnerTestAccess(input.ownerTestAccess),
    checkedAt: input.checkedAt
  }
}

export class OrbitPlusService {
  private readonly dependencies: OrbitPlusServiceDependencies
  private readonly config = loadConfig()
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

  private snapshot(issue?: OrbitPlusIssue): OrbitPlusSnapshot {
    const now = this.dependencies.now()
    const session = this.loadSession()
    const ownerDisabled = session?.ownerTestAccess?.enabled === false
    const entitlementNotExpired = !ownerDisabled && freshEntitlementIsUsable(session?.entitlement, now)
    const freshlyVerified =
      entitlementNotExpired &&
      session !== undefined &&
      session.checkedAt + FRESH_ENTITLEMENT_MS >= now
    const cachedAccess = !ownerDisabled && cachedEntitlementIsUsable(session?.entitlement, now)
    const entitlement = session?.entitlement
    const permanent = entitlement?.source === 'lifetime-key' && entitlement.expiresAt === undefined
    const accessUntil = Math.min(
      entitlement?.expiresAt ?? Infinity,
      Math.max(
        (session?.checkedAt ?? 0) + FRESH_ENTITLEMENT_MS,
        permanent ? Infinity : entitlement?.offlineUntil ?? 0
      )
    )
    return {
      access: freshlyVerified ? 'active' : cachedAccess ? 'grace' : 'locked',
      accessUntil: (freshlyVerified || cachedAccess) && Number.isFinite(accessUntil) ? accessUntil : undefined,
      connected: Boolean(session),
      serviceAvailable: Boolean(this.config.serviceUrl),
      secureStorageAvailable: this.secureStorageAvailable(),
      purchaseUrl: this.config.purchaseUrl,
      accountName: session?.accountName,
      entitlement: freshlyVerified || cachedAccess ? session?.entitlement : undefined,
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
    const session = this.loadSession()
    if (!session) return this.snapshot()
    return this.refresh()
  }

  async refresh(): Promise<OrbitPlusSnapshot> {
    if (this.connectionRunning) return this.snapshot()
    const session = this.loadSession()
    if (!session) return this.snapshot()
    if (!this.config.serviceUrl) return this.snapshot('service-not-configured')
    const generation = this.beginOperation()
    try {
      const { response, body } = await this.requestJson('/v1/entitlements/orbit-plus', {
        headers: { authorization: `Bearer ${session.sessionToken}` }
      }, [200, 401])
      if (generation !== this.operationGeneration) return this.snapshot()
      if (response.status === 401) {
        this.clearSession()
        return this.snapshot('session-expired')
      }
      if (response.status !== 200) throw new Error('ORBIT Plus refresh failed')
      const accountName =
        typeof body.accountName === 'string' && body.accountName.trim().length <= 160
          ? body.accountName.trim()
          : session.accountName
      const parsedEntitlement =
        body.entitlement === undefined ? undefined : parseOrbitPlusEntitlement(body.entitlement)
      const ownerTestAccess = parseOrbitPlusOwnerTestAccess(body.ownerTestAccess)
      const entitlement = freshEntitlementIsUsable(parsedEntitlement, this.dependencies.now())
        ? parsedEntitlement
        : undefined
      const checkedAt = this.dependencies.now()
      this.saveSession({
        sessionToken: session.sessionToken,
        accountName,
        entitlement,
        ownerTestAccess,
        checkedAt
      })
      if (!entitlement) {
        return this.snapshot(
          ownerTestAccess && !ownerTestAccess.enabled
            ? 'owner-test-disabled'
            : 'membership-required'
        )
      }
      return this.snapshot()
    } catch {
      if (generation !== this.operationGeneration) return this.snapshot()
      return this.snapshot('network-unavailable')
    }
  }

  async startPatreonConnection(
    sendStatus: (status: OrbitPlusConnectionStatus) => void
  ): Promise<OrbitPlusSnapshot> {
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
          const issue: OrbitPlusIssue =
            status.state === 'expired' ? 'session-expired' : 'verification-failed'
          const snapshot = this.snapshot(issue)
          sendStatus({ state: 'error', issue, snapshot })
          return snapshot
        }

        const entitlement = freshEntitlementIsUsable(
          status.entitlement,
          this.dependencies.now()
        )
          ? status.entitlement
          : undefined
        this.saveSession({
          sessionToken: status.sessionToken,
          accountName: status.accountName,
          entitlement,
          ownerTestAccess: status.ownerTestAccess,
          checkedAt: this.dependencies.now()
        })
        const snapshot = entitlement
          ? this.snapshot()
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

  async setOwnerTestAccess(enabled: unknown): Promise<OrbitPlusSnapshot> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid owner test access state')
    if (this.connectionRunning) return this.snapshot()
    const session = this.loadSession()
    if (!session || !session.ownerTestAccess?.available) {
      return this.snapshot('verification-failed')
    }
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
        this.clearSession()
        return this.snapshot('session-expired')
      }
      if (response.status !== 200) return this.snapshot('verification-failed')

      const ownerTestAccess = parseOrbitPlusOwnerTestAccess(body.ownerTestAccess)
      if (!ownerTestAccess || ownerTestAccess.enabled !== enabled) {
        return this.snapshot('verification-failed')
      }
      const entitlement =
        body.entitlement === undefined ? undefined : parseOrbitPlusEntitlement(body.entitlement)
      const accountName =
        typeof body.accountName === 'string' && body.accountName.trim().length <= 160
          ? body.accountName.trim()
          : session.accountName
      this.saveSession({
        sessionToken: session.sessionToken,
        accountName,
        entitlement,
        ownerTestAccess,
        checkedAt: this.dependencies.now()
      })
      if (!enabled) return this.snapshot('owner-test-disabled')
      if (!freshEntitlementIsUsable(entitlement, this.dependencies.now())) {
        return this.snapshot('verification-failed')
      }
      return this.snapshot()
    } catch {
      if (generation !== this.operationGeneration) return this.snapshot()
      return this.snapshot('network-unavailable')
    }
  }

  async disconnect(): Promise<OrbitPlusSnapshot> {
    const session = this.loadSession()
    this.cancelPatreonConnection()
    this.clearSession()
    if (session && this.config.serviceUrl) {
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
}

export const orbitPlusService = new OrbitPlusService()
