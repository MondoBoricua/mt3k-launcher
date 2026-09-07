import {
  ORBIT_PLUS_FEATURES,
  type OrbitPlusAccessSource,
  type OrbitPlusEntitlement,
  type OrbitPlusFeature,
  type OrbitPlusOwnerTestAccess,
  type OrbitPlusPlan
} from '../../shared/ipc'

const ACCESS_SOURCES: readonly OrbitPlusAccessSource[] = [
  'patreon',
  'annual-pass',
  'lifetime-key'
]
const ACCESS_PLANS: readonly OrbitPlusPlan[] = ['monthly', 'annual', 'lifetime']
const MAX_SHORT_STRING = 512
const MAX_TOKEN_LENGTH = 8_192
const MAX_DEVICE_SESSION_TTL_MS = 15 * 60_000
const CLOCK_SKEW_TOLERANCE_MS = 60_000

export interface OrbitPlusStartResponse {
  sessionId: string
  authorizationUrl: string
  expiresAt: number
  pollIntervalMs: number
}

export type OrbitPlusPollResponse =
  | { state: 'pending' | 'verifying' }
  | { state: 'denied' | 'expired' | 'failed' }
  | {
      state: 'complete'
      sessionToken: string
      accountName?: string
      entitlement?: OrbitPlusEntitlement
      ownerTestAccess?: OrbitPlusOwnerTestAccess
    }

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function shortString(value: unknown, label: string, maxLength = MAX_SHORT_STRING): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${label}`)
  return normalized
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function optionalTimestamp(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : timestamp(value, label)
}

export function validatedPatreonMembershipUrl(value: unknown): string {
  const parsed = new URL(shortString(value, 'Patreon membership URL', 2_048))
  const hostname = parsed.hostname.toLowerCase()
  if (
    parsed.protocol !== 'https:' ||
    (hostname !== 'patreon.com' && !hostname.endsWith('.patreon.com'))
  ) {
    throw new Error('Invalid Patreon membership URL')
  }
  parsed.hash = ''
  return parsed.toString()
}

export function validatedOrbitPlusServiceUrl(
  value: unknown,
  allowLoopback: boolean
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = new URL(shortString(value, 'ORBIT Plus service URL', 2_048))
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (parsed.protocol !== 'https:' && !(allowLoopback && loopback && parsed.protocol === 'http:')) {
    throw new Error('Invalid ORBIT Plus service URL')
  }
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '')
  return parsed.toString().replace(/\/$/u, '')
}

export function validatedAuthorizationUrl(value: unknown, serviceUrl: string): string {
  const parsed = new URL(shortString(value, 'ORBIT Plus authorization URL', 2_048))
  const serviceHost = new URL(serviceUrl).host.toLowerCase()
  const hostname = parsed.hostname.toLowerCase()
  const trustedPatreonHost = hostname === 'patreon.com' || hostname.endsWith('.patreon.com')
  if (parsed.protocol !== 'https:' || (!trustedPatreonHost && parsed.host.toLowerCase() !== serviceHost)) {
    throw new Error('Invalid ORBIT Plus authorization URL')
  }
  return parsed.toString()
}

export function parseOrbitPlusEntitlement(value: unknown): OrbitPlusEntitlement {
  const input = record(value, 'ORBIT Plus entitlement')
  if (!ACCESS_SOURCES.includes(input.source as OrbitPlusAccessSource)) {
    throw new Error('Invalid ORBIT Plus entitlement source')
  }
  if (!ACCESS_PLANS.includes(input.plan as OrbitPlusPlan)) {
    throw new Error('Invalid ORBIT Plus plan')
  }
  if (
    (input.source === 'patreon' && input.plan !== 'monthly') ||
    (input.source === 'annual-pass' && input.plan !== 'annual') ||
    (input.source === 'lifetime-key' && input.plan !== 'lifetime')
  ) {
    throw new Error('Invalid ORBIT Plus source and plan combination')
  }
  if (
    !Array.isArray(input.features) ||
    input.features.length === 0 ||
    input.features.length > ORBIT_PLUS_FEATURES.length ||
    input.features.some(
      (feature) =>
        typeof feature !== 'string' ||
        !ORBIT_PLUS_FEATURES.includes(feature as OrbitPlusFeature)
    )
  ) {
    throw new Error('Invalid ORBIT Plus features')
  }
  const requestedFeatures = [...new Set(input.features)] as OrbitPlusFeature[]
  // `manual-audio` was the original Plus bundle marker. Existing verified grants
  // must receive later bundle additions without waiting for a new service response.
  const features = requestedFeatures.includes('manual-audio')
    ? [...ORBIT_PLUS_FEATURES]
    : requestedFeatures
  const verifiedAt = timestamp(input.verifiedAt, 'ORBIT Plus verification time')
  const expiresAt = optionalTimestamp(input.expiresAt, 'ORBIT Plus expiration')
  const offlineUntil = optionalTimestamp(input.offlineUntil, 'ORBIT Plus offline window')
  if (expiresAt !== undefined && expiresAt < verifiedAt) {
    throw new Error('Invalid ORBIT Plus expiration')
  }
  if (offlineUntil !== undefined && offlineUntil < verifiedAt) {
    throw new Error('Invalid ORBIT Plus offline window')
  }
  return {
    source: input.source as OrbitPlusAccessSource,
    plan: input.plan as OrbitPlusPlan,
    features,
    verifiedAt,
    expiresAt,
    offlineUntil
  }
}

export function parseOrbitPlusOwnerTestAccess(
  value: unknown
): OrbitPlusOwnerTestAccess | undefined {
  if (value === undefined) return undefined
  const input = record(value, 'ORBIT Plus owner test access')
  if (input.available !== true || typeof input.enabled !== 'boolean') {
    throw new Error('Invalid ORBIT Plus owner test access')
  }
  return { available: true, enabled: input.enabled }
}

export function parseOrbitPlusStartResponse(
  value: unknown,
  serviceUrl: string,
  now: number
): OrbitPlusStartResponse {
  const input = record(value, 'ORBIT Plus connection response')
  const expiresAt = timestamp(input.expiresAt, 'ORBIT Plus connection expiration')
  if (
    expiresAt <= now ||
    expiresAt > now + MAX_DEVICE_SESSION_TTL_MS + CLOCK_SKEW_TOLERANCE_MS
  ) {
    throw new Error('Invalid ORBIT Plus connection expiration')
  }
  const requestedPollInterval =
    typeof input.pollIntervalMs === 'number' && Number.isFinite(input.pollIntervalMs)
      ? input.pollIntervalMs
      : 1_500
  return {
    sessionId: shortString(input.sessionId, 'ORBIT Plus connection ID', 256),
    authorizationUrl: validatedAuthorizationUrl(input.authorizationUrl, serviceUrl),
    expiresAt,
    pollIntervalMs: Math.min(5_000, Math.max(1_000, Math.round(requestedPollInterval)))
  }
}

export function parseOrbitPlusPollResponse(value: unknown): OrbitPlusPollResponse {
  const input = record(value, 'ORBIT Plus connection status')
  if (
    input.state === 'pending' ||
    input.state === 'verifying' ||
    input.state === 'denied' ||
    input.state === 'expired' ||
    input.state === 'failed'
  ) {
    return { state: input.state }
  }
  if (input.state !== 'complete') throw new Error('Invalid ORBIT Plus connection state')
  const accountName =
    input.accountName === undefined
      ? undefined
      : shortString(input.accountName, 'Patreon account name', 160)
  return {
    state: 'complete',
    sessionToken: shortString(input.sessionToken, 'ORBIT Plus session token', MAX_TOKEN_LENGTH),
    accountName,
    entitlement:
      input.entitlement === undefined ? undefined : parseOrbitPlusEntitlement(input.entitlement),
    ownerTestAccess: parseOrbitPlusOwnerTestAccess(input.ownerTestAccess)
  }
}

export function cachedEntitlementIsUsable(
  entitlement: OrbitPlusEntitlement | undefined,
  now: number
): boolean {
  if (!freshEntitlementIsUsable(entitlement, now)) return false
  if (
    entitlement?.source === 'lifetime-key' &&
    entitlement.plan === 'lifetime' &&
    entitlement.expiresAt === undefined
  ) {
    return true
  }
  if (!entitlement?.offlineUntil || entitlement.offlineUntil < now) return false
  return entitlement.expiresAt === undefined || entitlement.expiresAt >= now
}

export function freshEntitlementIsUsable(
  entitlement: OrbitPlusEntitlement | undefined,
  now: number
): boolean {
  if (!entitlement || entitlement.verifiedAt > now + 5 * 60_000) return false
  return entitlement.expiresAt === undefined || entitlement.expiresAt >= now
}
