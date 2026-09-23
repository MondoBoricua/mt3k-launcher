import { randomBytes } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  IPC,
  type GameCollection,
  type GuestModeFailureReason,
  type GuestModeStatus,
  type GuestModeVerifyResult
} from '@shared/ipc'
import {
  allowedGameIdsFromCollections,
  attemptsLeft,
  createSettingsUnlock,
  isActionAllowed,
  isLaunchAllowed,
  isLockedOut,
  isSettingsUnlockLive,
  isValidGuestPin,
  normalizeLockoutState,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  settleLockout,
  type GuestModeAction,
  type GuestModeLockoutState,
  type GuestSettingsUnlock
} from '@shared/guestModePolicy'
import { hashGuestPin, isGuestPinHash, verifyGuestPin } from './guestModePin'
import {
  readGuestModeLockout,
  readGuestModePinHash,
  settingsStore,
  writeGuestModeLockout,
  writeGuestModePinHash
} from './settingsStore'

const MAX_COLLECTION_ID_LENGTH = 128
const UNLOCK_TOKEN_BYTES = 32

class GuestModeError extends Error {
  constructor(readonly reason: GuestModeFailureReason) {
    super(`Guest mode: ${reason}`)
  }
}

/**
 * Owns the guest PIN, the failed-attempt lockout, the on/off switch and the
 * Settings unlock. The lockout is persisted in the settings store (under a key
 * the renderer cannot write) so force-closing the launcher never grants fresh
 * attempts; the unlock token only ever lives in this process.
 */
export class GuestModeService {
  private window: BrowserWindow | null = null
  private unlock: GuestSettingsUnlock | null = null

  attach(window: BrowserWindow): void {
    this.window = window
  }

  isActive(): boolean {
    return settingsStore.get('guestModeEnabled') === true
  }

  hasPin(): boolean {
    return isGuestPinHash(readGuestModePinHash())
  }

  /** True while the owner's main-issued Settings unlock is live. */
  isSettingsUnlocked(now = Date.now()): boolean {
    if (!isSettingsUnlockLive(this.unlock, this.unlock?.token ?? null, now)) {
      this.unlock = null
      return false
    }
    return true
  }

  status(now = Date.now()): GuestModeStatus {
    const lockout = this.readLockout(now)
    const allowedCollectionId = settingsStore.get('guestModeAllowedCollectionId')
    const unlocked = this.isSettingsUnlocked(now)
    return {
      enabled: this.isActive(),
      hasPin: this.hasPin(),
      allowedCollectionId:
        typeof allowedCollectionId === 'string' && allowedCollectionId
          ? allowedCollectionId
          : undefined,
      lockedUntil: isLockedOut(lockout, now) ? lockout.lockedUntil ?? undefined : undefined,
      attemptsLeft: attemptsLeft(lockout),
      settingsUnlockedUntil: unlocked ? this.unlock?.expiresAt : undefined
    }
  }

  /** Throws when a guest-restricted IPC action is invoked while guest mode is active. */
  assertActionAllowed(action: GuestModeAction): void {
    if (!isActionAllowed(action, this.isActive(), this.isSettingsUnlocked())) {
      throw new Error('This action is locked while guest mode is active')
    }
  }

  /** Game launches are resolved against the persisted collection, never renderer input. */
  assertLaunchAllowed(gameId: string): void {
    const allowed = allowedGameIdsFromCollections(
      settingsStore.get('customLibraries'),
      settingsStore.get('guestModeAllowedCollectionId')
    )
    if (!isLaunchAllowed(gameId, allowed, this.isActive(), this.isSettingsUnlocked())) {
      throw new Error('This game is not available while guest mode is active')
    }
  }

  verifyPin(pin: unknown, now = Date.now()): GuestModeVerifyResult {
    try {
      this.checkPin(pin, now)
      this.refreshUnlock(now)
      return this.commit(now)
    } catch (error) {
      return this.failure(error, now)
    }
  }

  /** The renderer reports leaving Settings; any later mutation needs the PIN again. */
  lockSettings(now = Date.now()): GuestModeStatus {
    this.unlock = null
    const status = this.status(now)
    this.broadcast(status)
    return status
  }

  /** First PIN creation needs no confirmation; changing it requires the current PIN. */
  setPin(pin: unknown, currentPin?: unknown, now = Date.now()): GuestModeVerifyResult {
    try {
      if (!isValidGuestPin(pin)) throw new GuestModeError('invalid-pin')
      if (this.hasPin()) {
        if (currentPin === undefined) throw new GuestModeError('pin-exists')
        this.checkPin(currentPin, now)
        this.refreshUnlock(now)
      }
      writeGuestModePinHash(hashGuestPin(pin))
      return this.commit(now)
    } catch (error) {
      return this.failure(error, now)
    }
  }

  enable(pin: unknown, now = Date.now()): GuestModeVerifyResult {
    try {
      this.checkPin(pin, now)
      settingsStore.set('guestModeEnabled', true)
      // The owner is still inside Settings; keep it usable until they leave.
      this.refreshUnlock(now)
      return this.commit(now)
    } catch (error) {
      return this.failure(error, now)
    }
  }

  disable(pin: unknown, now = Date.now()): GuestModeVerifyResult {
    try {
      this.checkPin(pin, now)
      settingsStore.set('guestModeEnabled', false)
      this.unlock = null
      return this.commit(now)
    } catch (error) {
      return this.failure(error, now)
    }
  }

  /** While guest mode is active the PIN is required to change the allowed set. */
  setAllowedCollection(
    collectionId: unknown,
    pin?: unknown,
    now = Date.now()
  ): GuestModeVerifyResult {
    try {
      if (this.isActive()) {
        this.checkPin(pin, now)
        this.refreshUnlock(now)
      }
      if (collectionId === null || collectionId === undefined || collectionId === '') {
        settingsStore.delete('guestModeAllowedCollectionId')
        return this.commit(now)
      }
      if (
        typeof collectionId !== 'string' ||
        collectionId.length > MAX_COLLECTION_ID_LENGTH ||
        !this.knownCollectionIds().has(collectionId)
      ) {
        throw new GuestModeError('unknown-collection')
      }
      settingsStore.set('guestModeAllowedCollectionId', collectionId)
      return this.commit(now)
    } catch (error) {
      return this.failure(error, now)
    }
  }

  private knownCollectionIds(): Set<string> {
    const collections = settingsStore.get('customLibraries')
    if (!Array.isArray(collections)) return new Set()
    return new Set(
      (collections as Partial<GameCollection>[])
        .map((collection) => collection?.id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id))
    )
  }

  private readLockout(now: number): GuestModeLockoutState {
    const stored = normalizeLockoutState(readGuestModeLockout())
    const settled = settleLockout(stored, now)
    if (settled !== stored) this.writeLockout(settled)
    return settled
  }

  private writeLockout(state: GuestModeLockoutState): void {
    try {
      writeGuestModeLockout(state)
    } catch (error) {
      console.warn('[guest-mode] could not persist the lockout state', error)
    }
  }

  private refreshUnlock(now: number): void {
    if (!this.isActive()) {
      this.unlock = null
      return
    }
    this.unlock = createSettingsUnlock(randomBytes(UNLOCK_TOKEN_BYTES).toString('hex'), now)
  }

  private checkPin(pin: unknown, now: number): void {
    const lockout = this.readLockout(now)
    if (isLockedOut(lockout, now)) throw new GuestModeError('locked-out')
    if (!isValidGuestPin(pin)) throw new GuestModeError('invalid-pin')
    const stored = readGuestModePinHash()
    if (!isGuestPinHash(stored)) throw new GuestModeError('no-pin')
    if (!verifyGuestPin(pin, stored)) {
      const failed = recordFailedAttempt(lockout, now)
      this.writeLockout(failed)
      throw new GuestModeError(isLockedOut(failed, now) ? 'locked-out' : 'wrong-pin')
    }
    this.writeLockout(recordSuccessfulAttempt())
  }

  private commit(now: number): GuestModeVerifyResult {
    const status = this.status(now)
    this.broadcast(status)
    return { ok: true, status }
  }

  private failure(error: unknown, now: number): GuestModeVerifyResult {
    const reason = error instanceof GuestModeError ? error.reason : 'invalid-pin'
    if (!(error instanceof GuestModeError)) {
      console.warn('[guest-mode] unexpected failure', error)
    }
    return { ok: false, reason, status: this.status(now) }
  }

  private broadcast(status: GuestModeStatus): void {
    const window = this.window
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send(IPC.guestModeStatusUpdated, status)
  }
}

export const guestModeService = new GuestModeService()
