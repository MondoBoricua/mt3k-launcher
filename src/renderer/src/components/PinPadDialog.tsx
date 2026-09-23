import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Delete, Loader2, LockKeyhole, X } from 'lucide-react'
import type { GuestModeFailureReason, GuestModeVerifyResult } from '@shared/ipc'
import { GUEST_PIN_MAX_LENGTH, GUEST_PIN_MIN_LENGTH } from '@shared/guestModePolicy'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useFocusScope } from '@renderer/hooks/useFocusScope'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { useControllerButtonLabels } from '@renderer/state/controllerStore'
import { playUiSound } from '@renderer/lib/uiAudio'
import type { PinPadMode } from '@renderer/state/guestModeStore'

type PinPadError = GuestModeFailureReason | 'mismatch' | 'failed'

const ERROR_KEYS: Record<PinPadError, TranslationKey> = {
  'invalid-pin': 'guestMode.pin.error.invalid',
  'wrong-pin': 'guestMode.pin.error.wrong',
  'locked-out': 'guestMode.pin.error.lockedOut',
  'no-pin': 'guestMode.pin.error.noPin',
  'pin-exists': 'guestMode.pin.error.pinExists',
  'unknown-collection': 'guestMode.pin.error.unknownCollection',
  mismatch: 'guestMode.pin.error.mismatch',
  failed: 'guestMode.pin.error.failed'
}

const KEY_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['backspace', '0', 'confirm']
]

interface Props {
  titleKey: TranslationKey
  bodyKey: TranslationKey
  mode: PinPadMode
  lockedUntil?: number
  onSubmit: (pin: string) => Promise<GuestModeVerifyResult>
  onCancel: () => void
  onSuccess: () => void
}

function secondsLeft(lockedUntil: number | undefined, now: number): number {
  if (!lockedUntil) return 0
  return Math.max(0, Math.ceil((lockedUntil - now) / 1_000))
}

/**
 * Controller-first PIN entry: the d-pad moves across the 3×4 grid, A presses a
 * key, B removes the last digit (and cancels once the field is empty).
 * Digits are masked; the main process owns the lockout.
 */
export function PinPadDialog({
  titleKey,
  bodyKey,
  mode,
  lockedUntil: initialLockedUntil,
  onSubmit,
  onCancel,
  onSuccess
}: Props): JSX.Element {
  const t = useT()
  const labels = useControllerButtonLabels()
  const reduceMotion = Boolean(useReducedMotion())
  const rootRef = useRef<HTMLDivElement>(null)
  const [digits, setDigits] = useState('')
  const [firstEntry, setFirstEntry] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ reason: PinPadError; attemptsLeft?: number } | null>(null)
  const [shakeCount, setShakeCount] = useState(0)
  const [lockedUntil, setLockedUntil] = useState<number | undefined>(initialLockedUntil)
  const [now, setNow] = useState(() => Date.now())
  const lockSeconds = secondsLeft(lockedUntil, now)
  const locked = lockSeconds > 0
  const confirming = mode === 'create' && firstEntry !== null
  const canConfirm = !busy && !locked && digits.length >= GUEST_PIN_MIN_LENGTH

  useEffect(() => {
    if (!locked) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [locked])

  useFocusScope({
    scopeRef: rootRef,
    resolveFocusTarget: () =>
      rootRef.current?.querySelector<HTMLElement>('[data-pin-key="5"]') ?? null
  })

  const fail = useCallback((reason: PinPadError, attemptsLeft?: number): void => {
    setError({ reason, attemptsLeft })
    setDigits('')
    setShakeCount((count) => count + 1)
    playUiSound('error')
  }, [])

  const pressDigit = useCallback(
    (digit: string): void => {
      if (busy || locked) return
      setError(null)
      setDigits((current) =>
        current.length >= GUEST_PIN_MAX_LENGTH ? current : `${current}${digit}`
      )
    },
    [busy, locked]
  )

  const backspace = useCallback((): void => {
    if (busy) return
    setError(null)
    setDigits((current) => current.slice(0, -1))
  }, [busy])

  const confirm = useCallback(async (): Promise<void> => {
    if (!canConfirm) return
    if (mode === 'create' && firstEntry === null) {
      setFirstEntry(digits)
      setDigits('')
      setError(null)
      return
    }
    if (mode === 'create' && firstEntry !== digits) {
      setFirstEntry(null)
      fail('mismatch')
      return
    }
    setBusy(true)
    try {
      const result = await onSubmit(digits)
      if (result.ok) {
        playUiSound('confirm')
        onSuccess()
        return
      }
      setLockedUntil(result.status.lockedUntil)
      setNow(Date.now())
      if (mode === 'create') setFirstEntry(null)
      fail(result.reason, result.status.attemptsLeft)
    } catch (caught) {
      console.warn('[guest-mode] PIN request failed', caught)
      if (mode === 'create') setFirstEntry(null)
      fail('failed')
    } finally {
      setBusy(false)
    }
  }, [canConfirm, digits, fail, firstEntry, mode, onSubmit, onSuccess])

  useBackHandler(() => {
    if (busy) return
    if (digits.length > 0) {
      backspace()
      return
    }
    onCancel()
  })

  // Backspace, Escape and Enter already reach the pad through the global
  // controller/keyboard navigation (back handler and focused-key activation).
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!/^[0-9]$/.test(event.key)) return
    event.preventDefault()
    pressDigit(event.key)
  }

  const errorText = error && (error.reason !== 'locked-out' || locked)
    ? t(ERROR_KEYS[error.reason], {
        attempts: error.attemptsLeft ?? 0,
        seconds: lockSeconds
      })
    : locked
      ? t('guestMode.pin.error.lockedOut', { seconds: lockSeconds })
      : ''

  return (
    <motion.div
      ref={rootRef}
      data-focus-scope="active"
      data-pin-pad-dialog="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-pad-title"
      aria-describedby="pin-pad-body"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (!busy && event.currentTarget === event.target) onCancel()
      }}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-6 backdrop-blur-md"
    >
      <motion.section
        key={shakeCount}
        initial={shakeCount === 0 ? { y: 24, opacity: 0, scale: 0.98 } : { x: 0 }}
        animate={
          shakeCount === 0 || reduceMotion
            ? { y: 0, x: 0, opacity: 1, scale: 1 }
            : { x: [0, -10, 10, -7, 7, -3, 3, 0], opacity: 1, scale: 1 }
        }
        exit={{ y: 18, opacity: 0, scale: 0.985 }}
        transition={
          shakeCount === 0
            ? { type: 'spring', stiffness: 330, damping: 29 }
            : { duration: 0.42, ease: 'easeOut' }
        }
        onPointerDown={(event) => event.stopPropagation()}
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-surface shadow-[0_32px_100px_rgba(0,0,0,0.7)]"
      >
        <header className="flex items-start gap-4 border-b border-white/[0.07] px-6 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
            <LockKeyhole size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="pin-pad-title" className="text-lg font-bold text-white">
              {t(confirming ? 'guestMode.pin.confirmTitle' : titleKey)}
            </h2>
            <p id="pin-pad-body" className="mt-1 text-xs leading-relaxed text-muted">
              {t(confirming ? 'guestMode.pin.confirmBody' : bodyKey)}
            </p>
          </div>
          <button
            data-focusable
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label={t('guestMode.pin.cancel')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-6 py-5">
          <div
            aria-label={t('guestMode.pin.enteredDigits', { count: digits.length })}
            role="status"
            className="flex items-center justify-center gap-3"
          >
            {Array.from({ length: GUEST_PIN_MAX_LENGTH }, (_, index) => {
              const filled = index < digits.length
              const required = index < GUEST_PIN_MIN_LENGTH
              return (
                <span
                  key={index}
                  aria-hidden="true"
                  className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                    filled
                      ? 'border-accent bg-accent'
                      : required
                        ? 'border-white/35 bg-transparent'
                        : 'border-white/15 bg-transparent'
                  }`}
                />
              )
            })}
          </div>

          <p
            aria-live="polite"
            className={`mt-3 min-h-5 text-center text-xs ${
              locked ? 'text-amber-200' : 'text-rose-200'
            }`}
          >
            {errorText}
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2" data-pin-pad-grid>
            {KEY_ROWS.flat().map((key) => {
              if (key === 'backspace') {
                return (
                  <button
                    key={key}
                    data-focusable
                    data-pin-key="backspace"
                    type="button"
                    disabled={busy || digits.length === 0}
                    onClick={backspace}
                    aria-label={t('guestMode.pin.backspace')}
                    className="flex h-14 items-center justify-center rounded-2xl border border-white/[0.07] bg-black/25 text-white/75 transition-colors hover:bg-white/10 disabled:opacity-35"
                  >
                    <Delete size={20} />
                  </button>
                )
              }
              if (key === 'confirm') {
                return (
                  <button
                    key={key}
                    data-focusable
                    data-pin-key="confirm"
                    type="button"
                    disabled={!canConfirm}
                    onClick={() => void confirm()}
                    aria-label={t('guestMode.pin.confirm')}
                    className="flex h-14 items-center justify-center rounded-2xl bg-accent text-black transition-colors disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {busy ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <Check size={22} strokeWidth={3} />
                    )}
                  </button>
                )
              }
              return (
                <button
                  key={key}
                  data-focusable
                  data-pin-key={key}
                  type="button"
                  disabled={busy || locked || digits.length >= GUEST_PIN_MAX_LENGTH}
                  onClick={() => pressDigit(key)}
                  className="h-14 rounded-2xl border border-white/[0.07] bg-black/25 text-xl font-bold text-white transition-colors hover:bg-white/10 disabled:opacity-35"
                >
                  {key}
                </button>
              )
            })}
          </div>

          <p className="mt-4 text-center text-[11px] text-white/45">
            {t('guestMode.pin.controllerHint', {
              confirm: labels.south,
              back: labels.east
            })}
          </p>
        </div>
      </motion.section>
    </motion.div>
  )
}
