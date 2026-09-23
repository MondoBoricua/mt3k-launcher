/**
 * Guest / kid mode decision logic. Pure module: no Electron, no DOM, so the
 * main process, the renderer and the verify script share one implementation.
 *
 * Guest mode is a launcher-level restriction, not Windows security. It hides
 * everything outside an allowed collection and gates management actions
 * behind a controller PIN.
 */

export const GUEST_MODE_ACTIONS = [
  'open-settings',
  'open-store',
  'open-friends',
  'open-applications',
  'uninstall',
  'hide',
  'edit-metadata',
  'launch',
  'launch-application',
  'restore-backup',
  'open-backups',
  'open-captures',
  'change-settings',
  'edit-collections',
  'add-custom-game',
  'manage-retro'
] as const

export type GuestModeAction = (typeof GUEST_MODE_ACTIONS)[number]

export const GUEST_PIN_MIN_LENGTH = 4
export const GUEST_PIN_MAX_LENGTH = 6
export const GUEST_MODE_MAX_FAILED_ATTEMPTS = 5
export const GUEST_MODE_LOCKOUT_MS = 60_000
/** A Settings unlock issued by the main process lasts this long unless the renderer locks earlier. */
export const GUEST_SETTINGS_UNLOCK_TTL_MS = 10 * 60_000

const GUEST_PIN_PATTERN = /^[0-9]{4,6}$/

/** A PIN is 4 to 6 ASCII digits. Anything else (unicode digits, spaces) is rejected. */
export function isValidGuestPin(value: unknown): value is string {
  return typeof value === 'string' && GUEST_PIN_PATTERN.test(value)
}

/** Actions the guest may perform on their own; everything else needs the owner. */
const GUEST_ALLOWED_ACTIONS: ReadonlySet<GuestModeAction> = new Set<GuestModeAction>(['launch'])

/**
 * `unlocked` is the main-owned Settings unlock: while it is live the owner has
 * just proven the PIN, so every guarded action passes.
 */
export function isActionAllowed(action: GuestModeAction, active: boolean, unlocked = false): boolean {
  if (!active || unlocked) return true
  return GUEST_ALLOWED_ACTIONS.has(action)
}

/**
 * Returns the games a guest may see. An empty or missing allowed set shows
 * nothing: guest mode must never fall back to the full library.
 */
export function visibleGames<T extends { id: string }>(
  games: readonly T[],
  allowedIds: readonly string[] | null | undefined,
  active: boolean
): T[] {
  if (!active) return [...games]
  if (!allowedIds || allowedIds.length === 0) return []
  const allowed = new Set(allowedIds)
  return games.filter((game) => allowed.has(game.id))
}

/**
 * Resolves the allowed game IDs from the persisted collections without
 * trusting the renderer. Unknown or malformed collections yield an empty set.
 */
export function allowedGameIdsFromCollections(
  collections: unknown,
  allowedCollectionId: unknown
): string[] {
  if (typeof allowedCollectionId !== 'string' || !allowedCollectionId || !Array.isArray(collections)) {
    return []
  }
  const collection = collections.find(
    (candidate): candidate is { id: string; gameIds?: unknown } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === allowedCollectionId
  )
  if (!collection || !Array.isArray(collection.gameIds)) return []
  return collection.gameIds.filter(
    (gameId): gameId is string => typeof gameId === 'string' && Boolean(gameId)
  )
}

/** Launching is the one guest action, and only for games inside the allowed set. */
export function isLaunchAllowed(
  gameId: string,
  allowedIds: readonly string[],
  active: boolean,
  unlocked = false
): boolean {
  if (!active || unlocked) return true
  return allowedIds.includes(gameId)
}

export interface GuestModeLockoutState {
  failedAttempts: number
  /** Epoch milliseconds until which verification is refused. */
  lockedUntil: number | null
}

export function createLockoutState(): GuestModeLockoutState {
  return { failedAttempts: 0, lockedUntil: null }
}

/** Reads a persisted lockout; anything malformed counts as a clean state. */
export function normalizeLockoutState(value: unknown): GuestModeLockoutState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return createLockoutState()
  const candidate = value as Partial<GuestModeLockoutState>
  const failedAttempts =
    typeof candidate.failedAttempts === 'number' &&
    Number.isInteger(candidate.failedAttempts) &&
    candidate.failedAttempts >= 0
      ? candidate.failedAttempts
      : 0
  const lockedUntil =
    typeof candidate.lockedUntil === 'number' && Number.isFinite(candidate.lockedUntil)
      ? candidate.lockedUntil
      : null
  return { failedAttempts, lockedUntil }
}

export function isLockedOut(state: GuestModeLockoutState, now: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now
}

/** Expired lockouts reset the counter so the next window starts clean. */
export function settleLockout(state: GuestModeLockoutState, now: number): GuestModeLockoutState {
  if (state.lockedUntil !== null && state.lockedUntil <= now) return createLockoutState()
  return state
}

export function recordFailedAttempt(
  state: GuestModeLockoutState,
  now: number,
  options: { maxAttempts?: number; lockoutMs?: number } = {}
): GuestModeLockoutState {
  const maxAttempts = options.maxAttempts ?? GUEST_MODE_MAX_FAILED_ATTEMPTS
  const lockoutMs = options.lockoutMs ?? GUEST_MODE_LOCKOUT_MS
  const settled = settleLockout(state, now)
  const failedAttempts = settled.failedAttempts + 1
  if (failedAttempts >= maxAttempts) {
    return { failedAttempts, lockedUntil: now + lockoutMs }
  }
  return { failedAttempts, lockedUntil: null }
}

export function recordSuccessfulAttempt(): GuestModeLockoutState {
  return createLockoutState()
}

export function attemptsLeft(
  state: GuestModeLockoutState,
  maxAttempts = GUEST_MODE_MAX_FAILED_ATTEMPTS
): number {
  return Math.max(0, maxAttempts - state.failedAttempts)
}

export interface GuestSettingsUnlock {
  /** Random token held by the main process; never handed to the renderer. */
  token: string
  expiresAt: number
}

export function createSettingsUnlock(
  token: string,
  now: number,
  ttlMs = GUEST_SETTINGS_UNLOCK_TTL_MS
): GuestSettingsUnlock {
  return { token, expiresAt: now + ttlMs }
}

/** Live only while the token matches and the window has not expired. */
export function isSettingsUnlockLive(
  unlock: GuestSettingsUnlock | null,
  token: string | null,
  now: number
): boolean {
  if (!unlock || !token) return false
  return unlock.token === token && unlock.expiresAt > now
}
