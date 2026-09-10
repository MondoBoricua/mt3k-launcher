import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowDownToLine,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Info,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  TriangleAlert,
  X
} from 'lucide-react'
import type {
  LauncherDownloadActivity,
  LauncherDownloadControlAction,
  LauncherDownloadPhase
} from '@shared/ipc'
import {
  bytesPerSecondToMegabits,
  clampLauncherProgress,
  launcherDownloadControlActions,
  orderedLauncherDownloads
} from '@shared/launcherDownloads'
import {
  PROVIDER_INSTALLATION_CAPABILITIES,
  providerAutomationLevel,
  type ManagedGameInstallProvider,
  type ProviderAutomationLevel,
  type ProviderOperationMode
} from '@shared/gameInstallation'
import { languageLocale } from '@shared/language'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useFocusScope } from '@renderer/hooks/useFocusScope'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { useDownloadStore } from '@renderer/state/downloadStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { GameImage } from './GameImage'

const PHASE_KEYS: Record<LauncherDownloadPhase, TranslationKey> = {
  downloading: 'downloads.phase.downloading',
  updating: 'downloads.phase.updating',
  installing: 'downloads.phase.installing',
  verifying: 'downloads.phase.verifying',
  paused: 'downloads.phase.paused',
  completed: 'downloads.phase.completed',
  error: 'downloads.phase.error'
}

const AUTOMATION_LEVEL_KEYS: Record<ProviderAutomationLevel, TranslationKey> = {
  automatic: 'downloads.info.level.automatic',
  assisted: 'downloads.info.level.assisted',
  manual: 'downloads.info.level.manual'
}

const OPERATION_MODE_KEYS: Record<ProviderOperationMode, TranslationKey> = {
  automatic: 'downloads.info.mode.automatic',
  provider: 'downloads.info.mode.provider',
  unavailable: 'downloads.info.mode.unavailable'
}

const SIGNAL_KEYS: Record<LauncherDownloadActivity['confidence'], TranslationKey> = {
  exact: 'downloads.info.signal.exact',
  approximate: 'downloads.info.signal.approximate',
  heuristic: 'downloads.info.signal.heuristic'
}

const PROVIDER_OPERATION_KEYS = [
  ['install', 'downloads.info.operation.install'],
  ['progress', 'downloads.info.operation.progress'],
  ['controls', 'downloads.info.operation.controls'],
  ['uninstall', 'downloads.info.operation.uninstall']
] as const satisfies readonly [
  'install' | 'progress' | 'controls' | 'uninstall',
  TranslationKey
][]

function formatBytes(value: number | undefined, locale: string): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 || size >= 10 ? 0 : 1
  }).format(size)} ${units[unit]}`
}

function providerLabel(provider: ManagedGameInstallProvider): string {
  if (provider === 'xbox') return 'Xbox'
  if (provider === 'epic') return 'Epic Games'
  if (provider === 'ubisoft') return 'Ubisoft'
  return 'Steam'
}

function formatMegabitsPerSecond(
  bytesPerSecond: number | undefined,
  locale: string
): string | undefined {
  const megabits = bytesPerSecondToMegabits(bytesPerSecond)
  if (megabits === undefined) return undefined
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: megabits < 10 ? 1 : 0
  }).format(megabits)} Mbit/s`
}

function formatTimestamp(value: number, locale: string): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(value)
}

function phaseIcon(activity: LauncherDownloadActivity): JSX.Element {
  if (activity.phase === 'completed') return <CheckCircle2 size={18} />
  if (activity.phase === 'paused') return <Pause size={18} fill="currentColor" />
  if (activity.phase === 'error') return <TriangleAlert size={18} />
  return <ArrowDownToLine size={18} />
}

export function DownloadCenterPanel(): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((state) => state.language)
  const locale = languageLocale(language)
  const reduceMotion = Boolean(useReducedMotion())
  const snapshot = useDownloadStore((state) => state.snapshot)
  const refreshDownloads = useDownloadStore((state) => state.refresh)
  const selectedActivityId = useDownloadStore((state) => state.selectedActivityId)
  const selectActivity = useDownloadStore((state) => state.selectActivity)
  const closeCenter = useDownloadStore((state) => state.closeCenter)
  const openGame = useGameDetailStore((state) => state.openGame)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const infoTriggerRef = useRef<HTMLButtonElement>(null)
  const infoCloseRef = useRef<HTMLButtonElement>(null)
  const [busyAction, setBusyAction] = useState<LauncherDownloadControlAction | null>(null)
  const [controlError, setControlError] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const activities = useMemo(
    () => orderedLauncherDownloads(snapshot.activities),
    [snapshot.activities]
  )
  const selected =
    activities.find((activity) => activity.id === selectedActivityId) ?? activities[0]
  const progress = clampLauncherProgress(selected?.progress)
  const percentage = progress === undefined ? undefined : Math.round(progress * 100)
  const controls = selected ? launcherDownloadControlActions(selected) : []
  const throughput = formatMegabitsPerSecond(selected?.bytesPerSecond, locale)
  const checkedAt = formatTimestamp(snapshot.checkedAt, locale)
  const changedAt = selected ? formatTimestamp(selected.updatedAt, locale) : undefined

  const closeInfo = (): void => {
    setInfoOpen(false)
    requestAnimationFrame(() => focusElement(infoTriggerRef.current))
  }

  useBackHandler(() => {
    if (infoOpen) closeInfo()
    else closeCenter()
  })
  useFocusScope({
    scopeRef: rootRef,
    resolveFocusTarget: () =>
      rootRef.current?.querySelector<HTMLElement>('[data-download-primary-action="true"]') ??
      closeRef.current
  })

  useEffect(() => {
    setBusyAction(null)
    setControlError(false)
    setConfirmCancel(false)
  }, [selected?.id])

  useEffect(() => {
    if (!confirmCancel) return
    const timer = window.setTimeout(() => setConfirmCancel(false), 4_000)
    return () => window.clearTimeout(timer)
  }, [confirmCancel])

  useEffect(() => {
    if (!infoOpen) return
    void refreshDownloads()
    const timer = window.setInterval(() => void refreshDownloads(), 2_000)
    return () => window.clearInterval(timer)
  }, [infoOpen, refreshDownloads])

  useEffect(() => {
    if (!infoOpen) return
    const frame = requestAnimationFrame(() => focusElement(infoCloseRef.current))
    return () => cancelAnimationFrame(frame)
  }, [infoOpen])

  const runControl = async (action: LauncherDownloadControlAction): Promise<void> => {
    if (!selected || busyAction) return
    if (action === 'cancel' && !confirmCancel) {
      setConfirmCancel(true)
      return
    }
    setBusyAction(action)
    setControlError(false)
    try {
      const result = await window.api.downloads.control(selected.id, action)
      if (result.state === 'unsupported') setControlError(true)
      if (action === 'cancel') setConfirmCancel(false)
    } catch {
      setControlError(true)
    } finally {
      setBusyAction(null)
    }
  }

  const openSelectedGame = (): void => {
    if (!selected?.gameId) return
    closeCenter()
    openGame(selected.gameId)
  }

  return (
    <motion.div
      id="orbit-download-center"
      ref={rootRef}
      data-focus-scope="active"
      data-download-center="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-center-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeCenter()
      }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-[clamp(0.75rem,3vw,3rem)] py-[clamp(0.75rem,4vh,2.75rem)] backdrop-blur-md"
    >
      <motion.section
        initial={reduceMotion ? false : { y: 26, scale: 0.975 }}
        animate={{ y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { y: 18, scale: 0.985, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 390, damping: 34 }}
        className="relative flex h-full max-h-[54rem] w-full max-w-[92rem] overflow-hidden rounded-[calc(var(--radius-card)*0.55)] border border-white/12 bg-base shadow-[0_28px_90px_rgba(0,0,0,0.58)]"
      >
        <span aria-hidden="true" className="absolute inset-x-0 top-0 z-40 h-px bg-gradient-to-r from-transparent via-accent/85 to-transparent" />
        <span aria-hidden="true" className="absolute left-0 top-0 z-40 h-12 w-px bg-accent" />
        <span aria-hidden="true" className="absolute right-0 top-0 z-40 h-12 w-px bg-accent" />
        <aside className="flex w-[clamp(15rem,23vw,20rem)] shrink-0 flex-col border-r border-white/[0.1] bg-[rgb(var(--color-surface)/0.7)]">
          <header className="flex min-h-20 items-center justify-between gap-3 border-b border-white/[0.1] px-5">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-accent">
                ORBIT // TRANSFER
              </p>
              <h2 id="download-center-title" className="truncate text-lg font-black text-white">
                {t('downloads.center.title')}
              </h2>
            </div>
            <span className="border-l border-white/15 pl-3 font-mono text-xs font-bold tabular-nums text-white/48">
              {String(activities.length).padStart(2, '0')}
            </span>
          </header>

          <div className="scrollbar-none flex-1 overflow-y-auto px-3 py-2">
            {activities.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center text-white/45">
                <CheckCircle2 size={30} className="mb-3 text-emerald-300/70" />
                <p className="font-bold text-white/75">{t('downloads.center.empty')}</p>
                <p className="mt-1.5 text-xs leading-relaxed">{t('downloads.center.emptyBody')}</p>
              </div>
            ) : (
              activities.map((activity, index) => {
                const itemProgress = clampLauncherProgress(activity.progress)
                const active = activity.id === selected?.id
                return (
                  <button
                    key={activity.id}
                    data-focusable
                    data-download-queue-item="true"
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectActivity(activity.id)}
                    className="relative flex w-full gap-3 overflow-hidden border-b border-l-2 border-b-white/[0.07] border-l-transparent bg-transparent px-2 py-3 text-left transition-colors hover:bg-white/[0.04] data-[focused=true]:border-l-accent data-[focused=true]:bg-accent/[0.08] aria-pressed:border-l-accent aria-pressed:bg-[linear-gradient(90deg,rgb(var(--color-accent)/0.1),transparent)]"
                  >
                    <span className="w-5 shrink-0 pt-1 font-mono text-[9px] font-bold tabular-nums text-white/25">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[calc(var(--radius-card)*0.2)] border border-white/[0.08] bg-black/25 text-accent">
                      {phaseIcon(activity)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-white">
                        {activity.title}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-white/45">
                        <span>{providerLabel(activity.provider)}</span>
                        <span>
                          {itemProgress === undefined ? t(PHASE_KEYS[activity.phase]) : `${Math.round(itemProgress * 100)}%`}
                        </span>
                      </span>
                    </span>
                    <span className="absolute bottom-0 left-2 right-2 h-px overflow-hidden bg-white/10">
                      {itemProgress !== undefined && (
                        <span className="block h-full origin-left bg-accent" style={{ transform: `scaleX(${itemProgress})` }} />
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <div className="relative min-w-0 flex-1 overflow-hidden">
          {selected?.gameId && (
            <GameImage
              gameId={selected.gameId}
              name={selected.title}
              orientation="horizontal"
              fit="cover"
              className="absolute inset-0 h-full w-full object-cover opacity-30 saturate-75"
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(3,5,9,0.985)_10%,rgba(3,5,9,0.82)_58%,rgba(3,5,9,0.96))]" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-[15%] top-[12%] aspect-square w-[62%] rounded-[50%] border border-accent/[0.08]" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-[4%] top-[27%] aspect-square w-[38%] rounded-[50%] border border-white/[0.045]" />
          <div className="relative z-10 flex h-full flex-col">
            <header className="flex min-h-20 items-center justify-between gap-3 border-b border-white/[0.07] px-5">
              <button
                ref={infoTriggerRef}
                data-focusable
                type="button"
                aria-controls="download-center-info-panel"
                aria-expanded={infoOpen}
                onClick={() => setInfoOpen(true)}
                className="flex min-h-10 items-center gap-2 rounded-[calc(var(--radius-card)*0.25)] border border-white/12 bg-black/20 px-3 text-sm font-bold text-white/70 hover:border-accent/35 hover:text-white"
              >
                <Info size={17} />
                {t('downloads.info.open')}
              </button>
              <button
                ref={closeRef}
                data-focusable
                type="button"
                onClick={closeCenter}
                aria-label={t('downloads.center.close')}
                className="flex h-10 w-10 items-center justify-center rounded-[calc(var(--radius-card)*0.25)] border border-white/12 bg-black/20 text-white/65 hover:border-accent/35 hover:text-white"
              >
                <X size={18} />
              </button>
            </header>

            {selected ? (
              <div className="flex flex-1 flex-col justify-end overflow-y-auto px-[clamp(1.5rem,4vw,4rem)] pb-[clamp(1.5rem,5vh,3.5rem)] pt-6">
                <div className="max-w-3xl">
                  <div className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-accent">
                    <span>{providerLabel(selected.provider)}</span>
                    <span className="text-white/25">•</span>
                    <span>{t(PHASE_KEYS[selected.phase])}</span>
                  </div>
                  <h3 className="max-w-[18ch] text-[clamp(2rem,3.7vw,4.25rem)] font-black leading-[0.94] tracking-[-0.045em] text-white">
                    {selected.title}
                  </h3>

                  <div className="relative mt-[clamp(2rem,6vh,4.5rem)] border-y border-white/12 bg-[linear-gradient(90deg,rgb(var(--color-accent)/0.055),transparent_52%)] px-1 py-[clamp(1rem,2vw,1.4rem)]">
                    <span aria-hidden="true" className="absolute -left-px top-0 h-5 w-px bg-accent" />
                    <div className="flex items-end justify-between gap-6">
                      <div>
                        <p className="text-sm font-bold text-white">
                          {selected.confidence === 'heuristic' && selected.phase === 'downloading'
                            ? t('downloads.phase.detected')
                            : t(PHASE_KEYS[selected.phase])}
                        </p>
                        <p className="mt-1 text-xs text-white/45">
                          {selected.bytesDownloaded !== undefined && selected.bytesTotal !== undefined
                            ? t('downloads.center.bytes', {
                                current: formatBytes(selected.bytesDownloaded, locale) ?? '—',
                                total: formatBytes(selected.bytesTotal, locale) ?? '—'
                              })
                            : t('downloads.center.progressPending')}
                        </p>
                      </div>
                      <span className="text-3xl font-black tabular-nums text-white">
                        {percentage === undefined ? '—' : `${percentage}%`}
                      </span>
                    </div>
                    <div className="relative mt-4 h-2 overflow-hidden bg-white/10">
                      {progress === undefined ? (
                        <motion.span
                          className="block h-full w-1/3 bg-accent"
                          animate={reduceMotion || selected.phase === 'paused' ? undefined : { x: ['-120%', '320%'] }}
                          transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      ) : (
                        <motion.span
                          className="block h-full origin-left bg-accent"
                          initial={false}
                          animate={{ scaleX: progress }}
                          transition={{ duration: reduceMotion ? 0 : 0.3 }}
                        />
                      )}
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0,transparent_calc(10%_-_1px),rgba(3,5,9,0.7)_calc(10%_-_1px),rgba(3,5,9,0.7)_10%)]" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/50">
                      {throughput && (
                        <span className="flex items-center gap-1.5">
                          <Gauge size={13} />
                          <strong data-download-throughput className="font-bold text-white/75">
                            {throughput}
                          </strong>
                          <span className="text-white/30">·</span>
                          <span>{formatBytes(selected.bytesPerSecond, locale)}/s</span>
                        </span>
                      )}
                      {selected.etaSeconds !== undefined && (
                        <span>{t('downloads.center.eta', { minutes: Math.max(1, Math.ceil(selected.etaSeconds / 60)) })}</span>
                      )}
                    </div>
                  </div>

                  {controlError && (
                    <p className="mt-3 text-sm font-semibold text-amber-200" role="alert">
                      {t('downloads.center.controlError')}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2.5">
                    {controls.includes('pause') && (
                      <ControlButton
                        primary
                        busy={busyAction === 'pause'}
                        icon={<Pause size={17} fill="currentColor" />}
                        label={t('downloads.center.pause')}
                        onClick={() => void runControl('pause')}
                      />
                    )}
                    {controls.includes('resume') && (
                      <ControlButton
                        primary
                        busy={busyAction === 'resume'}
                        icon={<Play size={17} fill="currentColor" />}
                        label={t('downloads.center.resume')}
                        onClick={() => void runControl('resume')}
                      />
                    )}
                    {controls.includes('cancel') && (
                      <ControlButton
                        busy={busyAction === 'cancel'}
                        danger={confirmCancel}
                        icon={<Square size={15} fill="currentColor" />}
                        label={t(confirmCancel ? 'downloads.center.stopConfirm' : 'downloads.center.stop')}
                        onClick={() => void runControl('cancel')}
                      />
                    )}
                    {controls.includes('open-provider') && (
                      <ControlButton
                        primary={
                          !controls.includes('pause') && !controls.includes('resume')
                        }
                        busy={busyAction === 'open-provider'}
                        icon={<ExternalLink size={17} />}
                        label={t('downloads.center.openProvider', { provider: providerLabel(selected.provider) })}
                        onClick={() => void runControl('open-provider')}
                      />
                    )}
                    {selected.gameId && (
                      <ControlButton
                        primary={controls.length === 0}
                        icon={<RotateCcw size={17} />}
                        label={t('downloads.center.openGame')}
                        onClick={openSelectedGame}
                      />
                    )}
                  </div>
                  {selected.provider === 'steam' && selected.phase !== 'completed' && (
                    <p className="mt-3 max-w-2xl text-xs leading-relaxed text-white/38">
                      {t('downloads.center.steamHint')}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-center">
                <div>
                  <CheckCircle2 size={44} className="mx-auto text-emerald-300/70" />
                  <p className="mt-4 text-xl font-black text-white">{t('downloads.center.empty')}</p>
                  <p className="mt-2 text-sm text-white/45">{t('downloads.center.emptyBody')}</p>
                </div>
              </div>
            )}
          </div>
          <AnimatePresence>
            {infoOpen && (
              <motion.aside
                id="download-center-info-panel"
                data-download-info-panel="true"
                role="complementary"
                aria-label={t('downloads.info.title')}
                initial={reduceMotion ? false : { x: '100%' }}
                animate={{ x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
                transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                className="absolute inset-y-0 right-0 z-30 flex w-[clamp(19rem,34vw,27rem)] flex-col border-l border-accent/25 bg-[rgb(var(--color-surface)/0.985)] shadow-[-18px_0_55px_rgba(0,0,0,0.42)]"
              >
                <header className="relative flex min-h-20 items-center justify-between gap-3 border-b border-white/[0.1] px-5">
                  <span aria-hidden="true" className="absolute bottom-0 left-0 h-px w-16 bg-accent" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-accent">
                      {t('downloads.info.eyebrow')}
                    </p>
                    <h3 className="truncate text-lg font-black text-white">
                      {t('downloads.info.title')}
                    </h3>
                  </div>
                  <button
                    ref={infoCloseRef}
                    data-focusable
                    type="button"
                    onClick={closeInfo}
                    aria-label={t('downloads.info.close')}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[calc(var(--radius-card)*0.25)] border border-white/12 bg-black/20 text-white/65 hover:border-accent/35 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </header>

                <div className="scrollbar-none flex-1 space-y-8 overflow-y-auto px-5 py-6">
                  <section aria-labelledby="download-live-info-title">
                    <h4
                      id="download-live-info-title"
                      className="text-xs font-black uppercase tracking-[0.14em] text-white/45"
                    >
                      {t('downloads.info.live')}
                    </h4>
                    <dl className="mt-3 border-y border-white/[0.09]">
                      <InfoMetric
                        metric="speed"
                        label={t('downloads.info.speed')}
                        value={throughput ?? t('downloads.info.notReported')}
                        accent={Boolean(throughput)}
                      />
                      <InfoMetric
                        metric="progress"
                        label={t('downloads.info.progress')}
                        value={percentage === undefined ? '—' : `${percentage}%`}
                      />
                      <InfoMetric
                        metric="status"
                        label={t('downloads.info.status')}
                        value={selected ? t(PHASE_KEYS[selected.phase]) : '—'}
                      />
                      <InfoMetric
                        metric="signal"
                        label={t('downloads.info.signal')}
                        value={
                          selected
                            ? t(SIGNAL_KEYS[selected.confidence])
                            : '—'
                        }
                      />
                      <InfoMetric
                        metric="checked-at"
                        label={t('downloads.info.checkedAt')}
                        value={checkedAt ?? '—'}
                      />
                      <InfoMetric
                        metric="changed-at"
                        label={t('downloads.info.changedAt')}
                        value={changedAt ?? '—'}
                      />
                    </dl>
                  </section>

                  <section aria-labelledby="download-provider-info-title">
                    <div>
                      <h4
                        id="download-provider-info-title"
                        className="text-xs font-black uppercase tracking-[0.14em] text-white/45"
                      >
                        {t('downloads.info.providers')}
                      </h4>
                      <p className="mt-1.5 text-xs leading-relaxed text-white/38">
                        {t('downloads.info.providersBody')}
                      </p>
                    </div>
                    <div className="mt-3 border-y border-white/[0.09]">
                      {PROVIDER_INSTALLATION_CAPABILITIES.map((capability) => {
                        const level = providerAutomationLevel(capability)
                        return (
                          <article
                            key={capability.provider}
                            data-provider-automation={capability.provider}
                            data-automation-level={level}
                            className="border-b border-white/[0.08] px-1 py-4 last:border-b-0"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <h5 className="font-black text-white">
                                {providerLabel(capability.provider)}
                              </h5>
                              <span className={`flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.13em] ${
                                level === 'automatic'
                                  ? 'text-emerald-200'
                                  : level === 'assisted'
                                    ? 'text-accent'
                                    : 'text-white/45'
                              }`}>
                                <span
                                  aria-hidden="true"
                                  className={`h-1.5 w-1.5 ${
                                    level === 'automatic'
                                      ? 'bg-emerald-300'
                                      : level === 'assisted'
                                        ? 'bg-accent'
                                        : 'bg-white/30'
                                  }`}
                                />
                                {t(AUTOMATION_LEVEL_KEYS[level])}
                              </span>
                            </div>
                            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2">
                              {PROVIDER_OPERATION_KEYS.map(([operation, labelKey]) => {
                                const mode = capability[operation]
                                return (
                                  <div
                                    key={operation}
                                    className="min-w-0 border-l border-white/[0.09] pl-2 text-xs"
                                  >
                                    <dt className="truncate text-[9px] font-bold uppercase tracking-[0.08em] text-white/35">{t(labelKey)}</dt>
                                    <dd
                                      className={`mt-0.5 truncate ${
                                        mode === 'automatic'
                                          ? 'font-bold text-emerald-200'
                                          : mode === 'provider'
                                            ? 'font-semibold text-white/70'
                                            : 'font-semibold text-white/32'
                                      }`}
                                    >
                                      {t(OPERATION_MODE_KEYS[mode])}
                                    </dd>
                                  </div>
                                )
                              })}
                            </dl>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </motion.div>
  )
}

function InfoMetric({
  metric,
  label,
  value,
  accent = false
}: {
  metric: string
  label: string
  value: string
  accent?: boolean
}): JSX.Element {
  return (
    <div
      data-download-info-metric={metric}
      className="flex min-h-12 items-center justify-between gap-4 border-b border-white/[0.07] px-1 py-2.5 last:border-b-0"
    >
      <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/38">
        {label}
      </dt>
      <dd className={`min-w-0 truncate text-right font-mono text-sm font-bold tabular-nums ${accent ? 'text-accent' : 'text-white/82'}`}>
        {value}
      </dd>
    </div>
  )
}

function ControlButton({
  primary = false,
  danger = false,
  busy = false,
  icon,
  label,
  onClick
}: {
  primary?: boolean
  danger?: boolean
  busy?: boolean
  icon: JSX.Element
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      data-focusable
      data-download-primary-action={primary ? 'true' : undefined}
      data-disabled={busy ? 'true' : undefined}
      disabled={busy}
      type="button"
      onClick={onClick}
      className={`flex min-h-11 items-center gap-2 rounded-[calc(var(--radius-card)*0.28)] border px-4 text-sm font-bold transition-colors ${
        danger
          ? 'border-rose-200/30 bg-rose-300/15 text-rose-100'
          : primary
            ? 'border-transparent bg-accent text-black shadow-[0_10px_30px_rgb(var(--color-accent)/0.2)]'
            : 'border-white/12 bg-white/[0.07] text-white hover:bg-white/[0.12]'
      }`}
    >
      {busy ? <Loader2 size={17} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}
