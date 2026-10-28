/**
 * Confirmación para instalar o quitar FSR 4.1 Lite.
 * El mando cierra con Atrás, igual que el diálogo de copias de partida.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import type { LibraryGame } from '@shared/ipc'
import type { Fsr4GraphicsApi, Fsr4LiteEvent, Fsr4LiteGameView, Fsr4RenderScale } from '@shared/fsr4LitePolicy'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { notify } from '@renderer/state/notificationStore'
import { FocusableButton } from './FocusableButton'
import { Fsr4LiteOptions, fsr4LiteErrorCode, fsr4LiteErrorKey } from './Fsr4LiteGame'

interface Props {
  game: LibraryGame
  view: Fsr4LiteGameView | null
  onView: (next: Fsr4LiteGameView) => void
  onClose: () => void
}

function mega(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(1, Math.round(value / (1024 * 1024)))
}

export function Fsr4LiteDialog({ game, view, onView, onClose }: Props): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Extract<Fsr4LiteEvent, { kind: 'progress' }> | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  useBackHandler(() => {
    if (!busy) onClose()
  })

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      focusElement(document.querySelector<HTMLElement>('[data-fsr4-confirm]'))
    })
    return () => cancelAnimationFrame(frame)
  }, [view?.phase, busy])

  useEffect(() => window.api.fsr4Lite.onEvent((event) => {
    if (event.gameId !== game.id || event.kind !== 'progress') return
    setProgress(event)
  }), [game.id])

  const fail = (error: unknown): void => {
    const code = fsr4LiteErrorCode(error)
    setErrorCode(code)
    notify({
      tone: 'error',
      titleKey: 'fsr4Lite.title',
      messageKey: fsr4LiteErrorKey(code),
      vars: code === 'anti-cheat' ? { name: view?.antiCheat ?? '' } : undefined,
      force: true,
      replace: true
    })
  }

  const saveOptions = (next: { renderScale: Fsr4RenderScale, overlay: boolean, graphicsApi: Fsr4GraphicsApi }): void => {
    if (busy) return
    setBusy(true)
    void window.api.fsr4Lite.setOptions(game.id, next)
      .then((updated) => { onView(updated); setErrorCode(null) })
      .catch(fail)
      .finally(() => setBusy(false))
  }

  const run = (action: 'install' | 'uninstall'): void => {
    if (busy) return
    setBusy(true)
    setErrorCode(null)
    const request = action === 'install' ? window.api.fsr4Lite.install(game.id) : window.api.fsr4Lite.uninstall(game.id)
    void request
      .then((updated) => {
        onView(updated)
        if (updated.phase === 'installed' || updated.phase === 'ready' || updated.phase === 'widget') onClose()
      })
      .catch(fail)
      .finally(() => { setBusy(false); setProgress(null) })
  }

  const blocked = view?.phase === 'blocked'
  const widget = view?.phase === 'widget'
  const broken = view?.phase === 'broken'
  const installed = view?.phase === 'installed'
  const blockText = view?.block === 'anti-cheat'
    ? t('fsr4Lite.error.antiCheat', { name: view.antiCheat ?? '' })
    : view?.block
      ? t(fsr4LiteErrorKey(view.block))
      : null

  return (
    <motion.div
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-label={t(broken ? 'fsr4Lite.dialog.repairTitle' : installed ? 'fsr4Lite.dialog.removeTitle' : 'fsr4Lite.dialog.installTitle')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-md"
      onPointerDown={(event) => {
        if (!busy && event.currentTarget === event.target) onClose()
      }}
    >
      <motion.section
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex max-h-[min(720px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-surface/95 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div className="min-w-0">
            <p className="truncate text-xs uppercase tracking-[0.2em] text-white/45">{game.name}</p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {t(widget ? 'fsr4Lite.widgetInstalled' : broken ? 'fsr4Lite.dialog.repairTitle' : installed ? 'fsr4Lite.dialog.removeTitle' : 'fsr4Lite.dialog.installTitle')}
            </h2>
          </div>
          <FocusableButton variant="ghost" onClick={onClose} disabled={busy} aria-label={t('fsr4Lite.close')}>
            <X size={18} />
          </FocusableButton>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {!view ? (
            <p className="flex items-center gap-3 text-sm text-muted"><Loader2 className="animate-spin" size={18} />{t('fsr4Lite.busy')}</p>
          ) : widget ? (
            <p className="text-sm leading-relaxed text-white/75">{t('fsr4Lite.widgetInstalled')}</p>
          ) : blocked ? (
            <p className="text-sm leading-relaxed text-amber-100">{blockText ?? t('fsr4Lite.error.generic')}</p>
          ) : broken ? (
            <p className="text-sm leading-relaxed text-amber-100">{t('fsr4Lite.dialog.repairBody')}</p>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-white/75">
                {t(installed ? 'fsr4Lite.dialog.removeBody' : 'fsr4Lite.dialog.installBody')}
              </p>
              {installed ? <p className="text-sm text-white/60">{t('fsr4Lite.already')}</p> : null}
              <Fsr4LiteOptions view={view} busy={busy} onChange={saveOptions} />
            </>
          )}
          {errorCode ? (
            <p role="alert" className="text-sm text-amber-100">
              {t(fsr4LiteErrorKey(errorCode), errorCode === 'anti-cheat' ? { name: view?.antiCheat ?? '' } : undefined)}
            </p>
          ) : null}
          {progress ? (
            <p role="status" aria-live="polite" className="text-sm text-white/70">
              {progress.phase === 'copy'
                ? t('fsr4Lite.busy')
                : t('fsr4Lite.dialog.progress', { received: mega(progress.received), total: mega(progress.total) })}
            </p>
          ) : null}
        </div>
        <footer className="flex flex-wrap justify-end gap-3 border-t border-white/10 px-6 py-4">
          <FocusableButton variant="ghost" disabled={busy} onClick={onClose}>{t('fsr4Lite.cancel')}</FocusableButton>
          {widget ? (
            <FocusableButton data-fsr4-confirm variant="solid" disabled={busy} onClick={() => void window.api.fsr4Lite.openGameBar()}>
              {t('fsr4Lite.openGameBar')}
            </FocusableButton>
          ) : null}
          {view && !widget && !blocked && (view.phase === 'ready' || view.phase === 'installed' || broken) ? (
            <FocusableButton data-fsr4-confirm variant="solid" disabled={busy} onClick={() => run(broken || installed ? 'uninstall' : 'install')}>
              <span className="flex items-center gap-2">
                {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                {t(broken ? 'fsr4Lite.dialog.confirmRepair' : installed ? 'fsr4Lite.dialog.confirmRemove' : 'fsr4Lite.dialog.confirmInstall')}
              </span>
            </FocusableButton>
          ) : null}
        </footer>
      </motion.section>
    </motion.div>
  )
}
