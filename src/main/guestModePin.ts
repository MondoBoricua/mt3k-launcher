import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { isValidGuestPin } from '../shared/guestModePolicy'

/**
 * Guest PIN hashing. Pure Node module (no Electron) so the verify script can
 * exercise the exact code path the launcher uses.
 *
 * Stored format: `scrypt$<salt hex>$<hash hex>`. The PIN itself is never stored.
 */

const HASH_PREFIX = 'scrypt'
const SALT_BYTES = 16
const KEY_BYTES = 32
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 } as const

export function hashGuestPin(pin: string): string {
  if (!isValidGuestPin(pin)) throw new Error('Invalid guest PIN')
  const salt = randomBytes(SALT_BYTES)
  const key = scryptSync(pin, salt, KEY_BYTES, SCRYPT_OPTIONS)
  return `${HASH_PREFIX}$${salt.toString('hex')}$${key.toString('hex')}`
}

export function isGuestPinHash(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = value.split('$')
  return (
    parts.length === 3 &&
    parts[0] === HASH_PREFIX &&
    /^[0-9a-f]{32}$/.test(parts[1]) &&
    /^[0-9a-f]{64}$/.test(parts[2])
  )
}

/** Constant-time comparison; malformed hashes and PINs never match. */
export function verifyGuestPin(pin: unknown, storedHash: unknown): boolean {
  if (!isValidGuestPin(pin) || !isGuestPinHash(storedHash)) return false
  const [, saltHex, keyHex] = storedHash.split('$')
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT_OPTIONS)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
