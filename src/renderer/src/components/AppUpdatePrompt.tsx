import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DownloadCloud, Loader2, ShieldCheck, X } from 'lucide-react'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'

export function AppUpdatePrompt(): JSX.Element | null {
  const t = useT()
  const snapshot = useAppUpdateStore((state) => state.snapshot)
  const acceptPrompt = useAppUpdateStore((state) => state.acceptPrompt)
  const dismissPrompt = useAppUpdateStore((state) => state.dismissPrompt)
  const updateButtonRef = useRef<HTMLButtonElement>(null)
  const working = snapshot.stage === 'downloading' || snapshot.stage === 'verifying'
  const percent = Math.max(0, Math.min(100, Math.round(snapshot.percent ?? 0)))

  useBackHandler(dismissPrompt)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() =>
      focusElement(updateButtonRef.current, { ensureVisible: false })
    )
    return () => {
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [])

  return createPortal(
    <motion.div
      data-focus-scope="active"
      data-app-update-prompt="true"
      role="dialog"
      aria-modal="true"
      aria-label={t('appUpdate.prompt.title', { version: snapshot.targetVersion ?? '' })}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[105] flex items-center justify-center bg-black/80 p-[clamp(0.75rem,3vw,3rem)] backdrop-blur-2xl"
    >
      <motion.section
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        aria-busy={working}
        className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-[clamp(1.25rem,2.5vw,2rem)] border border-white/10 bg-surface shadow-[0_38px_130px_rgba(0,0,0,0.82)]"
      >
        <button
          data-focusable
          type="button"
          onClick={dismissPrompt}
          aria-label={t('appUpdate.prompt.close')}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/15 data-[focused=true]:border-accent/60 data-[focused=true]:text-accent"
        >
          <X size={18} />
        </button>

        <div className="px-[clamp(1.25rem,3vw,2.25rem)] pb-5 pt-[clamp(1.25rem,3vw,2.25rem)]">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
            <DownloadCloud size={26} />
          </span>
          <h2 className="mt-5 pr-12 text-[clamp(1.5rem,3vw,2.2rem)] font-black leading-tight tracking-[-0.03em] text-white">
            {t('appUpdate.prompt.title', { version: snapshot.targetVersion ?? '' })}
          </h2>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/35">
            {t('appUpdate.prompt.current', { version: snapshot.currentVersion })}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-white/60">{t('appUpdate.prompt.body')}</p>
        </div>

        {snapshot.releaseNotes && (
          <div className="mx-[clamp(1.25rem,3vw,2.25rem)] min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/25 px-4 py-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">
              {t('appUpdate.prompt.notes')}
            </h3>
            <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-white/60">
              {snapshot.releaseNotes}
            </p>
          </div>
        )}

        <div className="px-[clamp(1.25rem,3vw,2.25rem)] pb-[clamp(1.25rem,3vw,2rem)] pt-5">
          {working && (
            <div role="status" aria-live="polite" className="mb-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-white/70">
                {snapshot.stage === 'verifying' ? (
                  <ShieldCheck size={15} className="text-emerald-300" />
                ) : (
                  <Loader2 size={15} className="animate-spin text-accent" />
                )}
                {snapshot.stage === 'verifying'
                  ? t('appUpdate.prompt.verifying')
                  : t('appUpdate.prompt.downloading', { percent })}
              </p>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${snapshot.stage === 'verifying' ? 100 : Math.max(2, percent)}%` }}
                />
              </span>
            </div>
          )}
          <p className="mb-4 flex items-start gap-2 text-[11px] leading-relaxed text-white/35">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            {t('appUpdate.prompt.security')}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              data-focusable
              type="button"
              onClick={dismissPrompt}
              className="rounded-full border border-white/10 bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/10 data-[focused=true]:border-accent/60 data-[focused=true]:text-white"
            >
              {t('appUpdate.prompt.later')}
            </button>
            <button
              ref={updateButtonRef}
              data-focusable
              type="button"
              disabled={working}
              data-disabled={working ? 'true' : undefined}
              onClick={() => void acceptPrompt()}
              className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-60 data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.25)]"
            >
              {working ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />}
              {t('appUpdate.prompt.update')}
            </button>
          </div>
        </div>
      </motion.section>
    </motion.div>,
    document.body
  )
}
