import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArchiveRestore, Check, Loader2, X } from 'lucide-react'
import { languageLocale } from '@shared/language'
import type { LocalGameBackupEntry } from '@shared/ipc'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { FocusableButton } from './FocusableButton'

interface Props {
  gameId: string
  gameName: string
  onClose: () => void
  onRestored: (result: { safetyBackupId?: string }) => void
  onRestoreFailed: (reason?: string) => void
}

function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const digits = unitIndex === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(size)} ${units[unitIndex]}`
}

export function SaveRestoreBackupDialog({
  gameId,
  gameName,
  onClose,
  onRestored,
  onRestoreFailed
}: Props): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((state) => state.language)
  const locale = languageLocale(language)
  const rootRef = useRef<HTMLDivElement>(null)
  const [backups, setBackups] = useState<LocalGameBackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useBackHandler(onClose)

  useEffect(() => {
    let cancelled = false
    void window.api.library.custom
      .listBackups(gameId)
      .then((entries) => {
        if (!cancelled) setBackups(entries)
      })
      .catch(() => {
        if (!cancelled) onRestoreFailed(undefined)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [gameId, onRestoreFailed])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector<HTMLElement>('[data-backup-choice]')
      focusElement(first ?? null)
    })
    return () => cancelAnimationFrame(frame)
  }, [loading, backups.length])

  useEffect(() => {
    if (!confirmId) return
    const timer = window.setTimeout(() => setConfirmId(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [confirmId])

  const handleRestore = async (entry: LocalGameBackupEntry): Promise<void> => {
    if (busyId) return
    if (confirmId !== entry.id) {
      setConfirmId(entry.id)
      return
    }
    setBusyId(entry.id)
    setConfirmId(null)
    try {
      const result = await window.api.library.custom.restoreBackup(gameId, entry.id)
      if (result.state === 'success') {
        onRestored({ safetyBackupId: result.safetyBackupId })
        onClose()
        return
      }
      onRestoreFailed(result.reason)
    } catch {
      onRestoreFailed(undefined)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <motion.div
      ref={rootRef}
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-label={t('saveRestore.dialog.title')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6 backdrop-blur-md"
    >
      <motion.section
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="flex max-h-[min(720px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-surface/95 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/45">
              {t('saveRestore.dialog.subtitle', { game: gameName })}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">{t('saveRestore.dialog.title')}</h2>
          </div>
          <FocusableButton variant="ghost" onClick={onClose} aria-label={t('metadata.close')}>
            <X size={18} />
          </FocusableButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-muted">
              <Loader2 className="animate-spin" size={18} />
              {t('saveRestore.dialog.loading')}
            </div>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted">{t('saveRestore.dialog.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {backups.map((entry) => {
                const dateLabel = new Intl.DateTimeFormat(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                }).format(entry.createdAt)
                const meta = t('saveRestore.dialog.entryMeta', {
                  date: dateLabel,
                  files: entry.fileCount,
                  size: formatBytes(entry.totalBytes, locale)
                })
                const confirming = confirmId === entry.id
                const busy = busyId === entry.id
                return (
                  <li key={entry.id}>
                    <FocusableButton
                      data-backup-choice
                      variant="ghost"
                      disabled={Boolean(busyId && busyId !== entry.id) || busy}
                      onClick={() => void handleRestore(entry)}
                      className="flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 px-4 py-3 text-left hover:border-white/20"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {confirming ? (
                          <Check size={18} className="shrink-0 text-warning" />
                        ) : (
                          <ArchiveRestore size={18} className="shrink-0 text-accent" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-white">{meta}</span>
                          {confirming ? (
                            <span className="mt-0.5 block text-xs text-warning">
                              {t('saveRestore.dialog.confirmHint')}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-white/50">
                        {busy
                          ? t('saveRestore.dialog.restoring')
                          : confirming
                            ? t('saveRestore.dialog.confirm')
                            : t('saveRestore.dialog.restore')}
                      </span>
                    </FocusableButton>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </motion.section>
    </motion.div>
  )
}
