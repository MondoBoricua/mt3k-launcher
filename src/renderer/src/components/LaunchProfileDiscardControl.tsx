import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FocusableButton } from './FocusableButton'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'

/**
 * Botón del ajuste de perfiles para soltar un journal atorado.
 * Solo aparece si hay una restauración pendiente. El control lo puede
 * alcanzar, y no borra nada hasta que se confirma.
 */
export function LaunchProfileDiscardControl(): JSX.Element | null {
  const t = useT()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void window.api.launchProfiles.pending().then((value) => {
      if (active) setPending(value)
    }).catch((error: unknown) => {
      console.warn(
        `[launch-profiles] no se pudo leer la restauración pendiente: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      if (active) setFailure(t('launchProfiles.error'))
    })
    return () => {
      active = false
    }
  }, [t])

  useBackHandler(() => setConfirming(false), confirming)

  useEffect(() => {
    if (!confirming) return
    const previous = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(confirmRef.current))
    return () => {
      cancelAnimationFrame(frame)
      if (previous?.isConnected) focusElement(previous)
    }
  }, [confirming])

  const forget = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await window.api.launchProfiles.discard()
      if (result === 'busy') {
        setFailure(t('launchProfiles.forgetRestoreBusy'))
        return
      }
      if (result === 'forgotten') {
        setPending(false)
        setConfirming(false)
        return
      }
      setPending(false)
      setConfirming(false)
    } catch (error) {
      console.warn(
        `[launch-profiles] no se pudo olvidar la restauración: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      setFailure(t('launchProfiles.forgetRestoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!pending && !failure) return null

  return (
    <>
      {pending && (
        <FocusableButton
          variant="ghost"
          data-launch-profile-forget="true"
          onClick={() => setConfirming(true)}
          className="mt-3 w-full justify-start rounded-2xl px-5 py-4 text-left"
        >
          {t('launchProfiles.forgetRestore')}
        </FocusableButton>
      )}
      {failure && (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          {failure}
        </p>
      )}
      {confirming && createPortal(
        <div
          data-focus-scope="active"
          role="dialog"
          aria-modal="true"
          aria-labelledby="launch-profile-forget-title"
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-6 backdrop-blur-md"
        >
          <section className="w-full max-w-xl space-y-5 rounded-3xl border border-white/15 bg-base p-6 text-text">
            <h2 id="launch-profile-forget-title" className="text-xl font-bold">
              {t('launchProfiles.forgetRestoreTitle')}
            </h2>
            <p className="text-sm leading-relaxed text-muted">{t('launchProfiles.forgetRestoreBody')}</p>
            <div className="flex flex-wrap gap-3">
              <FocusableButton ref={confirmRef} variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                {t('launchProfiles.forgetRestoreCancel')}
              </FocusableButton>
              <FocusableButton disabled={busy} onClick={() => void forget()}>
                {t('launchProfiles.forgetRestoreConfirm')}
              </FocusableButton>
            </div>
          </section>
        </div>,
        document.body
      )}
    </>
  )
}
