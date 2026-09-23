import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, KeyRound, LibraryBig, Loader2, ShieldAlert } from 'lucide-react'
import type { GuestModeFailureReason, GuestModeVerifyResult } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { isGuestModeActive, useGuestModeStore } from '@renderer/state/guestModeStore'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'

type PanelFeedback = GuestModeFailureReason | 'failed' | null

const FEEDBACK_KEYS: Record<Exclude<PanelFeedback, null>, TranslationKey> = {
  'invalid-pin': 'guestMode.pin.error.invalid',
  'wrong-pin': 'guestMode.pin.error.wrong',
  'locked-out': 'guestMode.pin.error.lockedOut',
  'no-pin': 'guestMode.pin.error.noPin',
  'pin-exists': 'guestMode.pin.error.pinExists',
  'unknown-collection': 'guestMode.pin.error.unknownCollection',
  failed: 'guestMode.pin.error.failed'
}

/**
 * Settings → System → Guest mode. Every state change goes through the PIN pad
 * except the very first PIN creation. Selection stays controller-navigable:
 * plain focusable buttons, no hover-only affordances.
 */
export function GuestModePanel(): JSX.Element {
  const t = useT()
  const status = useGuestModeStore((state) => state.status)
  const hydrated = useGuestModeStore((state) => state.hydrated)
  const active = useGuestModeStore(isGuestModeActive)
  const requestPin = useGuestModeStore((state) => state.requestPin)
  const applyStatus = useGuestModeStore((state) => state.applyStatus)
  const unlockSettings = useGuestModeStore((state) => state.unlockSettings)
  const collections = useLibraryCollectionsStore((state) => state.collections)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<PanelFeedback>(null)
  const allowedCollection = collections.find(
    (collection) => collection.id === status.allowedCollectionId
  )
  const allowedIsEmpty = !allowedCollection || allowedCollection.gameIds.length === 0

  const withStatus = async (
    run: () => Promise<GuestModeVerifyResult>
  ): Promise<GuestModeVerifyResult> => {
    const result = await run()
    applyStatus(result.status)
    return result
  }

  const toggleEnabled = async (): Promise<void> => {
    if (busy || !hydrated) return
    setFeedback(null)
    if (status.enabled) {
      await requestPin({
        titleKey: 'guestMode.pin.disableTitle',
        bodyKey: 'guestMode.pin.disableBody',
        mode: 'enter',
        submit: (pin) => withStatus(() => window.api.guestMode.disable(pin))
      })
      return
    }
    const ok = status.hasPin
      ? await requestPin({
          titleKey: 'guestMode.pin.enableTitle',
          bodyKey: 'guestMode.pin.enableBody',
          mode: 'enter',
          submit: (pin) => withStatus(() => window.api.guestMode.enable(pin))
        })
      : await requestPin({
          titleKey: 'guestMode.pin.createTitle',
          bodyKey: 'guestMode.pin.createBody',
          mode: 'create',
          submit: (pin) =>
            withStatus(async () => {
              const created = await window.api.guestMode.setup(pin)
              if (!created.ok) return created
              return window.api.guestMode.enable(pin)
            })
        })
    // The owner just proved the PIN: keep Settings open until they leave it.
    if (ok) unlockSettings()
  }

  const setPin = async (): Promise<void> => {
    if (busy || !hydrated) return
    setFeedback(null)
    if (!status.hasPin) {
      await requestPin({
        titleKey: 'guestMode.pin.createTitle',
        bodyKey: 'guestMode.pin.createBody',
        mode: 'create',
        submit: (pin) => withStatus(() => window.api.guestMode.setup(pin))
      })
      return
    }
    let currentPin: string | null = null
    const verified = await requestPin({
      titleKey: 'guestMode.pin.changeTitle',
      bodyKey: 'guestMode.pin.changeBody',
      mode: 'enter',
      submit: async (pin) => {
        const result = await withStatus(() => window.api.guestMode.verify(pin))
        if (result.ok) currentPin = pin
        return result
      }
    })
    if (!verified || currentPin === null) return
    const previousPin: string = currentPin
    await requestPin({
      titleKey: 'guestMode.pin.newTitle',
      bodyKey: 'guestMode.pin.newBody',
      mode: 'create',
      submit: (pin) => withStatus(() => window.api.guestMode.setup(pin, previousPin))
    })
  }

  const selectCollection = async (collectionId: string | null): Promise<void> => {
    if (busy || !hydrated) return
    if ((collectionId ?? undefined) === status.allowedCollectionId) return
    setFeedback(null)
    if (active) {
      await requestPin({
        titleKey: 'guestMode.pin.collectionTitle',
        bodyKey: 'guestMode.pin.collectionBody',
        mode: 'enter',
        submit: (pin) =>
          withStatus(() => window.api.guestMode.setAllowedCollection(collectionId, pin))
      })
      return
    }
    setBusy(true)
    try {
      const result = await withStatus(() =>
        window.api.guestMode.setAllowedCollection(collectionId)
      )
      if (!result.ok) setFeedback(result.reason)
    } catch (error) {
      console.warn('[guest-mode] could not change the allowed collection', error)
      setFeedback('failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4" data-guest-mode-panel>
      <p className="flex items-start gap-2 rounded-2xl border border-amber-100/15 bg-amber-100/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-100/85">
        <ShieldAlert size={15} className="mt-0.5 shrink-0" />
        <span>{t('guestMode.hint')}</span>
      </p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <motion.button
          data-focusable
          data-setting-toggle="guestModeEnabled"
          type="button"
          aria-pressed={status.enabled}
          disabled={!hydrated}
          onClick={() => void toggleEnabled()}
          whileHover={{ y: -2 }}
          className="flex items-center justify-between gap-5 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-left"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white/85">{t('guestMode.toggle.title')}</p>
              <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/40">
                {t('settings.defaultOff')}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t('guestMode.toggle.body')}</p>
          </div>
          <span
            className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
              status.enabled ? 'border-accent/60 bg-accent' : 'border-white/10 bg-white/10'
            }`}
          >
            <motion.span
              animate={{ x: status.enabled ? 22 : 3 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              className={`absolute top-1 h-5 w-5 rounded-full ${
                status.enabled ? 'bg-black' : 'bg-white/60'
              }`}
            />
          </span>
        </motion.button>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white/85">{t('guestMode.pin.title')}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {t(status.hasPin ? 'guestMode.pin.set' : 'guestMode.pin.notSet')}
            </p>
          </div>
          <button
            data-focusable
            type="button"
            disabled={!hydrated}
            onClick={() => void setPin()}
            className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/85 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            <KeyRound size={14} />
            {t(status.hasPin ? 'guestMode.pin.changeAction' : 'guestMode.pin.setAction')}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <p className="text-sm font-semibold text-white/85">{t('guestMode.collection.title')}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{t('guestMode.collection.body')}</p>
        {collections.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-white/10 px-4 py-4 text-center text-xs text-muted">
            {t('guestMode.collection.empty')}
          </p>
        ) : (
          <div role="radiogroup" aria-label={t('guestMode.collection.title')} className="mt-3 space-y-2">
            {collections.map((collection) => {
              const selected = collection.id === status.allowedCollectionId
              return (
                <button
                  key={collection.id}
                  data-focusable
                  data-guest-collection={collection.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy || !hydrated}
                  onClick={() => void selectCollection(collection.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                    selected ? 'bg-accent/12 text-white' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      selected ? 'bg-accent text-black' : 'bg-white/[0.07] text-white/45'
                    }`}
                  >
                    {busy && selected ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : selected ? (
                      <Check size={16} strokeWidth={3} />
                    ) : (
                      <LibraryBig size={15} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white/85">
                      {collection.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {t('guestMode.collection.gameCount', { count: collection.gameIds.length })}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <p aria-live="polite" className="mt-3 min-h-4 text-[11px] text-amber-200">
          {feedback
            ? t(FEEDBACK_KEYS[feedback], { attempts: status.attemptsLeft, seconds: 60 })
            : allowedIsEmpty
              ? t('guestMode.collection.warningEmpty')
              : ''}
        </p>
      </div>
    </div>
  )
}
