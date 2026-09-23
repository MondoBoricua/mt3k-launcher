import type { BrowserWindow } from 'electron'
import {
  IPC,
  type GameCollection,
  type GuestModeFailureReason,
  type GuestModeStatus,
  type GuestModeVerifyResult
} from '@shared/ipc'
import {
  attemptsLeft,
  createLockoutState,
  isActionAllowed,
  isLockedOut,
  isValidGuestPin,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  settleLockout,
  type GuestModeAction,
  type GuestModeLockoutState
} from '@shared/guestModePolicy'
import { hashGuestPin, isGuestPinHash, verifyGuestPin } from './guestModePin'
import { readGuestModePinHash, settingsStore, writeGuestModePinHash } from './settingsStore'

const MAX_COLLECTION_ID_LENGTH = 128

class GuestModeError extends Error {
  constructor(readonly reason: GuestModeFailureReason) {
    super(`Guest mode: ${reason}`)
  }
}

/**
 * Owns the guest PIN, the failed-attempt lockout and the on/off switch.
 * Lockout state lives here (not in the renderer) so reloading the window
 * cannot reset it.
 */
export class GuestModeService {
  private lockout: GuestModeLockoutState = createLockoutState()
  private window: BrowserWindow | null = null

  attach(window: BrowserWindow): void {
    this.window = window
  }

  isActive(): boolean {
    return settingsStore.get('guestModeEnabled') === true
  }

  hasPin(): boolean {
    return isGuestPinHash(readGuestModePinHash())
  }

  status(now = Date.now()): GuestModeStatus {
    this.lockout = settleLockout(this.lockout, now)
    const allowedCollectionId = settingsStore.get('guestModeAllowedCollectionId')
    return {
      enabled: this.isActive(),
      hasPin: this.hasPin(),
      allowedCollectionId:
        typeof allowedCollectionId === 'string' && allowedCollectionId
          ? allowedCollectionId
          : undefined,
      lockedUntil: isLockedOut(this.lockout, now) ? this.lockout.lockedUntil ?? undefined : undefined,
      attemptsLeft: attemptsLeft(this.lockout)
    }
  }

  /** Throws when a guest-restricted IPC action is invoked while guest mode is active. */
  assertActionAllowed(action: GuestModeAction): void {
    if (!isActionAllowed(action, this.isActive())) {
      throw new Error('This action is locked while guest mode is active')
    }
  }

  verifyPin(pin: unknown, now = Date.now()): GuestModeVerifyResult {
    try {
      this.checkPin(pin, now)
      return { ok: true, status: this.status(now) }
    } catch (error) {
      return this.failure(error, now)
    }
  }

  /** First PIN creation needs no confirmation; changing it requires the current PIN. */
  setPin(pin: unknown, currentPin?: unknown, now = Date.now()): GuestModeVerifyResult {
    try {
      if (!isValidGuestPin(pin)) throw new GuestModeError('invalid-pin')
      if (this.hasPin()) {
        if (currentPin === undefined) throw new GuestModeError('pin-exists')
        this.checkPin(currentPin, now)
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
      return this.commit(now)
    } catch (error) {
      return this.failure(error, now)
    }
  }

  disable(pin: unknown, now = Date.now()): GuestModeVerifyResult {
    try {
      this.checkPin(pin, now)
      settingsStore.set('guestModeEnabled', false)
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
      if (this.isActive()) this.checkPin(pin, now)
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

  private checkPin(pin: unknown, now: number): void {
    this.lockout = settleLockout(this.lockout, now)
    if (isLockedOut(this.lockout, now)) throw new GuestModeError('locked-out')
    if (!isValidGuestPin(pin)) throw new GuestModeError('invalid-pin')
    const stored = readGuestModePinHash()
    if (!isGuestPinHash(stored)) throw new GuestModeError('no-pin')
    if (!verifyGuestPin(pin, stored)) {
      this.lockout = recordFailedAttempt(this.lockout, now)
      throw new GuestModeError(isLockedOut(this.lockout, now) ? 'locked-out' : 'wrong-pin')
    }
    this.lockout = recordSuccessfulAttempt()
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
