import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  Dices,
  ExternalLink,
  Gauge,
  Loader2,
  RotateCw,
  Sparkles,
  Star,
  Timer,
  X
} from 'lucide-react'
import type { GameCompletionTimes, LibraryGame } from '@shared/ipc'
import { GameImage } from './GameImage'
import { LibraryProviderBadge } from './LibraryProviderBadge'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useFocusScope } from '@renderer/hooks/useFocusScope'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { playUiSound } from '@renderer/lib/uiAudio'
import {
  buildNextGameSpinSequence,
  chooseNextGame,
  gameCommitment,
  nextGameCandidates,
  nextGameReason,
  type NextGameSpinEntry
} from '@renderer/lib/nextGamePicker'

interface Props {
  games: readonly LibraryGame[]
  returnFocus: HTMLElement | null
  onClose: () => void
  onOpenGame: (game: LibraryGame) => void
}

type PickerPhase = 'spinning' | 'result' | 'empty'

const REASON_KEYS = {
  fresh: 'library.nextGame.reason.fresh',
  comeback: 'library.nextGame.reason.comeback',
  familiar: 'library.nextGame.reason.familiar',
  ready: 'library.nextGame.reason.ready',
  discovery: 'library.nextGame.reason.discovery'
} satisfies Record<ReturnType<typeof nextGameReason>['kind'], TranslationKey>

const COMMITMENT_KEYS = {
  compact: 'library.nextGame.commitment.compact',
  balanced: 'library.nextGame.commitment.balanced',
  long: 'library.nextGame.commitment.long'
} satisfies Record<NonNullable<ReturnType<typeof gameCommitment>>, TranslationKey>

function formatHours(minutes: number | undefined, language: string): string {
  if (!minutes) return '—'
  const hours = minutes / 60
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: hours < 10 ? 1 : 0 }).format(hours)} h`
}

function formatCount(value: number | undefined, language: string): string {
  if (value === undefined) return '—'
  return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function criticSource(game: LibraryGame, fallback: string): string {
  const manuallyOverridden = Object.prototype.hasOwnProperty.call(
    game.metadataOverrides ?? {},
    'criticScore'
  )
  return game.provider === 'steam' && !manuallyOverridden ? 'Metacritic' : fallback
}

export function NextGamePickerDialog({
  games,
  returnFocus,
  onClose,
  onOpenGame
}: Props): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  const language = document.documentElement.lang || 'de'
  const scopeRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openGameRef = useRef<HTMLButtonElement>(null)
  const spinTimersRef = useRef<number[]>([])
  const spinGenerationRef = useRef(0)
  const metadataGenerationRef = useRef(0)
  const previousWinnerRef = useRef<string>()
  // Freeze the draw pool for the dialog lifetime. HLTB enrichment updates the
  // global library snapshot and must not silently restart an in-progress reel.
  const [pickerGames] = useState<readonly LibraryGame[]>(() => [...games])
  const [includeUninstalled, setIncludeUninstalled] = useState(true)
  const candidates = useMemo(
    () => nextGameCandidates(pickerGames, includeUninstalled),
    [includeUninstalled, pickerGames]
  )
  const uninstalledCandidateCount = useMemo(
    () => nextGameCandidates(pickerGames, true).filter((game) => !game.installed).length,
    [pickerGames]
  )
  const [phase, setPhase] = useState<PickerPhase>('spinning')
  const [reel, setReel] = useState<NextGameSpinEntry[]>([])
  const [activeIndex, setActiveIndex] = useState(2)
  const [winner, setWinner] = useState<LibraryGame | null>(null)
  const [completionTimes, setCompletionTimes] = useState<GameCompletionTimes | null>(null)
  const [loadingCompletionTimes, setLoadingCompletionTimes] = useState(false)

  const clearSpinTimers = useCallback((): void => {
    for (const timer of spinTimersRef.current) window.clearTimeout(timer)
    spinTimersRef.current = []
  }, [])

  const spin = useCallback((): void => {
    clearSpinTimers()
    const generation = ++spinGenerationRef.current
    metadataGenerationRef.current += 1
    const nextWinner = chooseNextGame(
      pickerGames,
      previousWinnerRef.current,
      Math.random,
      includeUninstalled
    )
    if (!nextWinner) {
      setWinner(null)
      setReel([])
      setPhase('empty')
      return
    }

    previousWinnerRef.current = nextWinner.id
    const nextReel = buildNextGameSpinSequence(
      pickerGames,
      nextWinner,
      Math.random,
      14,
      includeUninstalled
    )
    setWinner(null)
    setCompletionTimes(null)
    setLoadingCompletionTimes(false)
    setReel(nextReel.entries)
    setActiveIndex(2)
    setPhase('spinning')
    playUiSound('switch')

    if (reduceMotion) {
      const timer = window.setTimeout(() => {
        if (spinGenerationRef.current !== generation) return
        setActiveIndex(nextReel.winnerIndex)
        setWinner(nextWinner)
        setPhase('result')
        playUiSound('confirm')
      }, 180)
      spinTimersRef.current.push(timer)
      return
    }

    let elapsed = 0
    for (let index = 3; index <= nextReel.winnerIndex; index += 1) {
      const progress = (index - 2) / (nextReel.winnerIndex - 2)
      elapsed += 62 + Math.round(progress * progress * 150)
      const timer = window.setTimeout(() => {
        if (spinGenerationRef.current !== generation) return
        setActiveIndex(index)
        if (index === nextReel.winnerIndex) {
          setWinner(nextWinner)
          setPhase('result')
          playUiSound('confirm')
        }
      }, elapsed)
      spinTimersRef.current.push(timer)
    }
  }, [clearSpinTimers, includeUninstalled, pickerGames, reduceMotion])

  useEffect(() => {
    spin()
    return () => {
      spinGenerationRef.current += 1
      metadataGenerationRef.current += 1
      clearSpinTimers()
    }
  }, [clearSpinTimers, spin])

  useEffect(() => {
    if (!winner) return
    const generation = ++metadataGenerationRef.current
    const cached = winner.metadata.completionTimes ?? null
    setCompletionTimes(cached)
    setLoadingCompletionTimes(!cached)
    void window.api.game
      .resolveCompletionTimes(winner.id)
      .then((result) => {
        if (metadataGenerationRef.current === generation) setCompletionTimes(result)
      })
      .catch(() => undefined)
      .finally(() => {
        if (metadataGenerationRef.current === generation) setLoadingCompletionTimes(false)
      })
  }, [winner])

  useBackHandler(onClose)
  useFocusScope({
    scopeRef,
    returnFocus,
    resolveFocusTarget: () => closeRef.current
  })

  const visibleEntries = useMemo(
    () =>
      reel
        .map((entry, index) => ({ entry, offset: index - activeIndex }))
        .filter(({ offset }) => Math.abs(offset) <= 2),
    [activeIndex, reel]
  )
  const reason = winner ? nextGameReason(winner) : null
  const commitment = gameCommitment(completionTimes)
  const completionAvailable = completionTimes?.state === 'available'
  const genre = reason?.genre

  return createPortal(
    <motion.div
      ref={scopeRef}
      data-focus-scope="active"
      data-next-game-picker="true"
      data-next-game-candidate-count={candidates.length}
      role="dialog"
      aria-modal="true"
      aria-labelledby="next-game-picker-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center overflow-hidden bg-[#030507]/90 p-[clamp(0.6rem,2vw,1.5rem)] backdrop-blur-2xl"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
          className="absolute left-1/2 top-1/2 h-[72vw] w-[72vw] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/10 bg-[conic-gradient(from_90deg,transparent,rgb(var(--color-accent)/0.14),transparent_24%,transparent_70%,rgb(var(--color-accent)/0.08),transparent)] blur-2xl"
        />
        <div className="absolute inset-x-[12%] top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
      </div>

      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.975 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="relative flex max-h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-[clamp(1.1rem,2.2vw,2rem)] border border-white/10 bg-surface/95 shadow-[0_42px_150px_rgba(0,0,0,0.88),0_0_80px_rgb(var(--color-accent)/0.08)]"
      >
        <header className="flex shrink-0 items-center gap-3 px-[clamp(1rem,2.4vw,1.75rem)] py-3.5">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent shadow-[0_0_28px_rgb(var(--color-accent)/0.16)]">
            <span className="absolute inset-1 rounded-xl border border-white/5" />
            <Dices size={21} className="relative" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="next-game-picker-title" className="truncate text-lg font-black text-white sm:text-xl">
                {t('library.nextGame.title')}
              </h2>
              <span className="shrink-0 rounded-full border border-amber-200/25 bg-amber-200/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] text-amber-100">
                Plus
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-white/40">
              {t('library.nextGame.subtitle', { count: candidates.length })}
            </p>
          </div>
          <button
            ref={closeRef}
            data-focusable
            type="button"
            onClick={onClose}
            aria-label={t('library.nextGame.close')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/55 transition-colors hover:bg-white/12 hover:text-white data-[focused=true]:border-accent/60 data-[focused=true]:text-accent"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex shrink-0 justify-center border-y border-white/[0.07] bg-black/15 px-[clamp(1rem,2.4vw,1.75rem)] py-1.5">
          <button
            data-focusable
            data-next-game-include-uninstalled="true"
            type="button"
            role="switch"
            aria-checked={includeUninstalled}
            aria-label={t('library.nextGame.includeUninstalled')}
            title={t('library.nextGame.includeUninstalledHint')}
            onClick={() => setIncludeUninstalled((value) => !value)}
            className={
              'group flex min-h-9 items-center gap-3 rounded-xl px-3 py-1.5 text-[10px] font-black transition-colors data-[focused=true]:bg-white/[0.06] data-[focused=true]:shadow-[0_0_0_2px_rgb(var(--color-accent)/0.28)] ' +
              (includeUninstalled
                ? 'text-accent'
                : 'text-white/52 hover:bg-white/[0.04] hover:text-white/75')
            }
          >
            <span className="whitespace-nowrap">{t('library.nextGame.includeUninstalled')}</span>
            <span
              aria-hidden="true"
              className={
                'relative flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors ' +
                (includeUninstalled
                  ? 'border-accent/70 bg-accent/25 shadow-[0_0_18px_rgb(var(--color-accent)/0.16)]'
                  : 'border-white/15 bg-black/30')
              }
            >
              <motion.span
                animate={{ x: includeUninstalled ? 20 : 4 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 520, damping: 32 }
                }
                className={
                  'absolute left-0 top-1 h-4 w-4 rounded-full shadow-sm ' +
                  (includeUninstalled ? 'bg-accent' : 'bg-white/45')
                }
              />
            </span>
          </button>
        </div>

        {phase === 'empty' ? (
          <div className="flex min-h-[22rem] flex-1 flex-col items-center justify-center px-6 text-center">
            <Dices size={38} className="text-white/25" />
            <h3 className="mt-4 text-xl font-black text-white">{t('library.nextGame.emptyTitle')}</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/48">
              {t(
                !includeUninstalled && uninstalledCandidateCount > 0
                  ? 'library.nextGame.emptyInstalledBody'
                  : 'library.nextGame.emptyBody'
              )}
            </p>
          </div>
        ) : (
          <>
            <div
              className="relative h-[clamp(15rem,39vh,22rem)] shrink-0 overflow-hidden border-b border-white/[0.06] bg-black/25"
              style={{ perspective: '1200px' }}
            >
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(var(--color-accent)/0.14),transparent_58%)]" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-[8%] bottom-[8%] h-[32%] rounded-[50%] border border-accent/15 bg-accent/[0.025] shadow-[0_0_60px_rgb(var(--color-accent)/0.12)] [transform:rotateX(72deg)]" />

              <AnimatePresence initial={false}>
                {visibleEntries.map(({ entry, offset }) => {
                  const centered = offset === 0
                  return (
                    <motion.div
                      key={entry.key}
                      data-next-game-carousel-card={entry.game.id}
                      data-next-game-carousel-title={entry.game.name}
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{
                        x: `${offset * 105}%`,
                        y: centered ? '-50%' : '-42%',
                        rotateY: offset * -24,
                        rotateZ: offset * 1.5,
                        scale: centered ? 1 : Math.abs(offset) === 1 ? 0.78 : 0.6,
                        opacity: centered ? 1 : Math.abs(offset) === 1 ? 0.62 : 0.24,
                        filter: centered ? 'blur(0px)' : `blur(${Math.abs(offset) * 0.7}px)`,
                        zIndex: 10 - Math.abs(offset)
                      }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: phase === 'spinning' ? 420 : 280, damping: 32 }
                      }
                      style={{
                        left: '50%',
                        top: '50%',
                        width: 'clamp(7.4rem, 14vw, 10.5rem)',
                        marginLeft: 'calc(clamp(7.4rem, 14vw, 10.5rem) / -2)',
                        transformStyle: 'preserve-3d'
                      }}
                      className="absolute aspect-[2/3] overflow-hidden rounded-xl2 border border-white/15 bg-surface-2 shadow-[0_24px_70px_rgba(0,0,0,0.72)]"
                    >
                      <GameImage
                        gameId={entry.game.id}
                        name={entry.game.name}
                        orientation="vertical"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/5 to-transparent" />
                      <LibraryProviderBadge
                        provider={entry.game.provider}
                        size="compact"
                        className="absolute left-2 top-2"
                      />
                      <div className="absolute inset-x-0 bottom-0 p-2.5">
                        <p className="line-clamp-2 text-[clamp(0.7rem,1.15vw,0.9rem)] font-black leading-tight text-white">
                          {entry.game.name}
                        </p>
                      </div>
                      {centered && (
                        <motion.span
                          layoutId="next-game-focus-ring"
                          className="pointer-events-none absolute inset-0 rounded-xl2 border-2 border-accent shadow-[inset_0_0_24px_rgb(var(--color-accent)/0.12),0_0_34px_rgb(var(--color-accent)/0.38)]"
                        />
                      )}
                    </motion.div>
                  )
                })}
              </AnimatePresence>

              <div
                role="status"
                aria-live="polite"
                className="absolute inset-x-0 bottom-2 z-20 flex justify-center"
              >
                <span className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/60 backdrop-blur-md">
                  {phase === 'spinning' ? (
                    <>
                      <Loader2 size={12} className="animate-spin text-accent" />
                      {t('library.nextGame.spinning')}
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} className="text-accent" />
                      {t('library.nextGame.selected')}
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(1rem,2.4vw,1.75rem)] py-3.5">
              {winner ? (
                <motion.div
                  key={winner.id}
                  initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,0.72fr)]"
                >
                  <div className="min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-accent">
                          {t('library.nextGame.yourPick')}
                        </p>
                        <h3 className="mt-1 truncate text-xl font-black text-white">{winner.name}</h3>
                      </div>
                      {genre && (
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-[10px] font-bold text-white/55">
                          {genre}
                        </span>
                      )}
                    </div>
                    {reason && (
                      <p className="mt-2 text-sm leading-relaxed text-white/66">
                        {t(REASON_KEYS[reason.kind])}
                      </p>
                    )}
                    {commitment && (
                      <p className="mt-1.5 flex items-start gap-2 text-xs leading-relaxed text-accent/80">
                        <Sparkles size={13} className="mt-0.5 shrink-0" />
                        {t(COMMITMENT_KEYS[commitment])}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <article className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                      <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-white/38">
                        <Timer size={12} className="text-accent" /> HLTB
                      </p>
                      <p className="mt-1.5 text-lg font-black text-white">
                        {loadingCompletionTimes ? (
                          <Loader2 size={17} className="animate-spin text-accent" />
                        ) : completionAvailable ? (
                          formatHours(completionTimes.mainStoryMinutes ?? completionTimes.allStylesMinutes, language)
                        ) : (
                          '—'
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-white/35">
                        {t('library.nextGame.mainStory')}
                      </p>
                    </article>
                    <article className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                      <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-white/38">
                        <Gauge size={12} className="text-accent" /> {t('library.nextGame.rating')}
                      </p>
                      <p className="mt-1.5 text-lg font-black text-white">
                        {winner.metadata.criticScore ?? '—'}
                        {winner.metadata.criticScore !== undefined && <span className="text-xs text-white/35">/100</span>}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-white/35">
                        {criticSource(winner, t('library.nextGame.providerMetadata'))}
                      </p>
                    </article>
                    <article className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2.5">
                      <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-white/38">
                        <Star size={12} className="text-accent" /> {t('library.nextGame.community')}
                      </p>
                      <p className="mt-1.5 text-lg font-black text-white">
                        {formatCount(winner.metadata.recommendationCount, language)}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-white/35">
                        {t('library.nextGame.recommendations')}
                      </p>
                    </article>
                  </div>
                </motion.div>
              ) : (
                <div className="flex min-h-[7.5rem] items-center justify-center text-sm font-semibold text-white/38">
                  {t('library.nextGame.thinking')}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-[clamp(1rem,2.4vw,1.75rem)] py-3">
              <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-white/30">
                {t('library.nextGame.sourceHint')}
              </p>
              {winner && completionTimes?.sourceUrl && (
                <button
                  data-focusable
                  type="button"
                  onClick={() => void window.api.app.openExternal(completionTimes.sourceUrl as string)}
                  className="flex h-10 items-center gap-2 rounded-full px-3 text-xs font-bold text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white data-[focused=true]:bg-white/[0.08] data-[focused=true]:text-accent"
                >
                  HLTB <ExternalLink size={13} />
                </button>
              )}
              <button
                data-focusable
                type="button"
                disabled={phase === 'spinning'}
                data-disabled={phase === 'spinning' ? 'true' : undefined}
                onClick={spin}
                className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 text-xs font-bold text-white/65 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40 data-[focused=true]:border-accent/55 data-[focused=true]:text-white"
              >
                <RotateCw size={14} /> {t('library.nextGame.again')}
              </button>
              <button
                ref={openGameRef}
                data-focusable
                type="button"
                disabled={!winner || phase === 'spinning'}
                data-disabled={!winner || phase === 'spinning' ? 'true' : undefined}
                onClick={() => winner && onOpenGame(winner)}
                className="flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-xs font-black text-black shadow-[0_10px_30px_rgb(var(--color-accent)/0.2)] transition-transform hover:scale-[1.02] disabled:opacity-40 data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.28)]"
              >
                {t('library.nextGame.open')} <ArrowRight size={15} />
              </button>
            </footer>
          </>
        )}
      </motion.section>
    </motion.div>,
    document.body
  )
}
