import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronRight, Crown, Loader2, Trophy, Youtube } from 'lucide-react'
import { type Language, languageLocale } from '@shared/language'
import type { GameAchievement } from '@shared/ipc'
import type { GameTrailer } from '@shared/gameTrailer'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useFocusScope } from '@renderer/hooks/useFocusScope'
import { useT } from '@renderer/i18n/useT'
import { GameTrailerInlinePlayer, GameTrailerPanelPlayer } from './GameTrailerPlayer'

export type AchievementGuideUiState = {
  achievementId: string
  state: 'loading' | 'missing' | 'unavailable' | 'locked'
}

interface Props {
  achievements: readonly GameAchievement[]
  unlocked: number
  total: number
  selectedAchievementId: string | null
  gameName: string
  language: Language
  guideUnlocked: boolean
  guideState: AchievementGuideUiState | null
  guideTrailer: { achievementId: string; trailer: GameTrailer } | null
  returnFocus: HTMLElement | null
  onSelect: (achievement: GameAchievement, trigger: HTMLElement) => void
  onGuideRetry: (achievement: GameAchievement) => void
  onClose: () => void
}

export function AchievementOverviewSheet({
  achievements,
  unlocked,
  total,
  selectedAchievementId,
  gameName,
  language,
  guideUnlocked,
  guideState,
  guideTrailer,
  returnFocus,
  onSelect,
  onGuideRetry,
  onClose
}: Props): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  const scopeRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const expandedVideoReturnFocusRef = useRef<HTMLElement | null>(null)
  const [videoExpanded, setVideoExpanded] = useState(false)
  const selectedIndex = achievements.findIndex(
    (achievement) => achievement.id === selectedAchievementId
  )
  const selected = selectedIndex >= 0 ? achievements[selectedIndex] : undefined
  const currentGuideState =
    selected && guideState?.achievementId === selected.id ? guideState.state : undefined
  const currentGuideTrailer =
    selected && guideTrailer?.achievementId === selected.id ? guideTrailer.trailer : undefined
  const effectiveGuideUnlocked = guideUnlocked && currentGuideState !== 'locked'
  const expandedGuideTrailer = videoExpanded ? currentGuideTrailer : undefined
  const percent = total > 0 ? Math.round((unlocked / total) * 100) : 0

  useBackHandler(onClose, !expandedGuideTrailer)
  useFocusScope({
    scopeRef,
    returnFocus,
    resolveFocusTarget: () => {
      const items = scopeRef.current?.querySelectorAll<HTMLElement>('[data-achievement-id]')
      return (
        Array.from(items ?? []).find(
          (item) => item.dataset.achievementId === selectedAchievementId
        ) ?? items?.[0] ?? closeRef.current
      )
    },
    ensureVisibleOnEntry: false
  })

  return (
    <motion.div
      ref={scopeRef}
      id="achievement-overview-sheet"
      data-achievement-sheet="overview"
      data-focus-scope="active"
      role="dialog"
      aria-modal="true"
      aria-labelledby="achievement-overview-title"
      initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
      animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
      transition={
        reduceMotion
          ? { duration: 0.12 }
          : { duration: 0.36, ease: [0.22, 1, 0.36, 1] }
      }
      className="absolute inset-0 z-40 flex min-h-0 flex-col overflow-hidden rounded-[inherit] bg-[#050608] shadow-[0_-32px_90px_rgba(0,0,0,0.72)]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_12%,rgb(var(--color-accent)/0.15),transparent_38%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(155deg,rgba(255,255,255,0.03),transparent_35%,rgba(0,0,0,0.44))]" />
        <div className="absolute inset-x-[8%] top-0 h-px bg-gradient-to-r from-transparent via-accent/65 to-transparent" />
      </div>

      <div aria-hidden="true" className="absolute left-1/2 top-2.5 h-1 w-14 -translate-x-1/2 rounded-full bg-white/[0.18]" />

      <header
        aria-hidden={Boolean(expandedGuideTrailer) || undefined}
        className="relative shrink-0 border-b border-white/[0.07] px-[clamp(1rem,2.5vw,2.5rem)] pb-3.5 pt-[clamp(1.15rem,2.6vh,1.75rem)]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent shadow-[0_0_28px_rgb(var(--color-accent)/0.12)]">
            <Trophy size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-3">
              <h2
                id="achievement-overview-title"
                className="truncate text-lg font-black tracking-[-0.02em] text-white"
              >
                {t('achievements.title')}
              </h2>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-[10px] font-black tabular-nums text-white/55">
                {unlocked}/{total}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs font-semibold text-white/42">{gameName}</p>
          </div>
          <span className="hidden text-xl font-black tabular-nums text-white sm:block">{percent}%</span>
          <button
            ref={closeRef}
            type="button"
            data-focusable
            data-achievement-sheet-close="true"
            onClick={onClose}
            aria-label={t('achievements.sheetClose')}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-4 text-xs font-bold text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronDown size={17} />
            <span className="hidden sm:inline">{t('achievements.sheetClose')}</span>
          </button>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: percent / 100 }}
            transition={{ duration: reduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="h-full origin-left rounded-full bg-gradient-to-r from-accent to-accent-2"
          />
        </div>
      </header>

      <main
        aria-hidden={Boolean(expandedGuideTrailer) || undefined}
        className="relative min-h-0 flex-1 overflow-hidden p-[clamp(0.75rem,2vw,1.5rem)]"
      >
        <div className={`grid h-full min-h-0 gap-[clamp(0.75rem,1.5vw,1.25rem)] ${
          selected
            ? 'grid-rows-[minmax(12rem,0.78fr)_minmax(16rem,1.22fr)] lg:grid-cols-[minmax(17rem,0.78fr)_minmax(0,1.22fr)] lg:grid-rows-1'
            : 'grid-cols-1'
        }`}>
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl2 border border-white/[0.08] bg-black/25">
            <div className="shrink-0 border-b border-white/[0.07] px-3.5 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/55">
                {t('achievements.overviewList', { total: achievements.length })}
              </p>
              <p className="mt-1 text-[10px] text-white/35">{t('achievements.overviewHint')}</p>
            </div>
            <div
              role="list"
              aria-label={t('achievements.title')}
              data-achievement-list="true"
              className={`scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 ${
                selected
                  ? 'space-y-2'
                  : 'grid content-start gap-2 sm:grid-cols-2'
              }`}
            >
              {achievements.map((achievement, index) => {
                const active = achievement.id === selectedAchievementId
                const iconUrl = achievement.unlocked
                  ? achievement.iconUrl
                  : achievement.lockedIconUrl
                return (
                  <div key={achievement.id} role="listitem">
                    <button
                      type="button"
                      data-focusable
                      data-achievement-id={achievement.id}
                      aria-pressed={active}
                      aria-controls={active ? 'achievement-selected-detail' : undefined}
                      onClick={(event) => onSelect(achievement, event.currentTarget)}
                      className={`flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-accent/55 bg-accent/[0.14]'
                          : achievement.unlocked
                            ? 'border-accent/15 bg-accent/[0.055] hover:bg-accent/[0.1]'
                            : 'border-white/[0.07] bg-white/[0.035] hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className={`h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/[0.07] bg-black/40 ${achievement.unlocked ? '' : 'opacity-60'}`}>
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt=""
                            loading="lazy"
                            className={`h-full w-full object-cover ${achievement.unlocked ? '' : 'grayscale'}`}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-white/25">
                            <Trophy size={18} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-white/85">{achievement.name}</p>
                        <p className="mt-1 truncate text-[10px] text-white/38">
                          {achievement.unlocked
                            ? t('achievements.unlocked')
                            : t('achievements.locked')}
                          <span className="px-1 text-white/20">·</span>
                          {index + 1}/{achievements.length}
                        </p>
                      </div>
                      <ChevronRight size={15} className={`shrink-0 ${active ? 'text-accent' : 'text-white/30'}`} />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>

          {selected && (
            <motion.section
              id="achievement-selected-detail"
              data-achievement-selected-detail={selected.id}
              aria-live="polite"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduceMotion ? 0.1 : 0.2 }}
              className="scrollbar-none min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-xl2 border border-white/[0.08] bg-black/25 p-[clamp(1rem,2vw,1.5rem)]"
            >
              <AchievementSelection
                achievement={selected}
                current={selectedIndex + 1}
                total={achievements.length}
                language={language}
                guideUnlocked={effectiveGuideUnlocked}
                guideState={currentGuideState}
                guideTrailer={currentGuideTrailer}
                guideExpanded={Boolean(expandedGuideTrailer)}
                onGuideRetry={() => onGuideRetry(selected)}
                onGuideExpand={(trigger) => {
                  expandedVideoReturnFocusRef.current = trigger
                  setVideoExpanded(true)
                }}
              />
            </motion.section>
          )}
        </div>
      </main>
      {expandedGuideTrailer && (
        <GameTrailerPanelPlayer
          trailer={expandedGuideTrailer}
          returnFocus={expandedVideoReturnFocusRef.current}
          onClose={() => setVideoExpanded(false)}
        />
      )}
    </motion.div>
  )
}

function AchievementSelection({
  achievement,
  current,
  total,
  language,
  guideUnlocked,
  guideState,
  guideTrailer,
  guideExpanded,
  onGuideRetry,
  onGuideExpand
}: {
  achievement: GameAchievement
  current: number
  total: number
  language: Language
  guideUnlocked: boolean
  guideState: AchievementGuideUiState['state'] | undefined
  guideTrailer: GameTrailer | undefined
  guideExpanded: boolean
  onGuideRetry: () => void
  onGuideExpand: (trigger: HTMLButtonElement) => void
}): JSX.Element {
  const t = useT()
  const iconUrl = achievement.unlocked ? achievement.iconUrl : achievement.lockedIconUrl
  const unlockedDate =
    achievement.unlockedAt === undefined ? undefined : new Date(achievement.unlockedAt)
  const formattedUnlockDate =
    unlockedDate && !Number.isNaN(unlockedDate.getTime())
      ? new Intl.DateTimeFormat(languageLocale(language), { dateStyle: 'long' }).format(
          unlockedDate
        )
      : undefined
  const progress =
    typeof achievement.progress === 'number' && Number.isFinite(achievement.progress)
      ? Math.round(Math.max(0, Math.min(100, achievement.progress)))
      : undefined
  const guideIssueKey =
    guideState === 'missing'
      ? 'achievements.guideMissing'
      : guideState === 'unavailable'
        ? 'achievements.guideUnavailable'
        : undefined

  return (
    <div className="flex min-h-full w-full flex-col">
      <div className="flex items-start gap-4">
        <div className={`h-[clamp(4.5rem,8vw,6.5rem)] w-[clamp(4.5rem,8vw,6.5rem)] shrink-0 overflow-hidden rounded-xl2 border border-white/10 bg-black/40 ${achievement.unlocked ? '' : 'opacity-65'}`}>
          {iconUrl ? (
            <img src={iconUrl} alt="" className={`h-full w-full object-cover ${achievement.unlocked ? '' : 'grayscale'}`} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/25">
              <Trophy size={34} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${
              achievement.unlocked
                ? 'border-emerald-200/25 bg-emerald-300/10 text-emerald-100'
                : 'border-white/10 bg-white/[0.05] text-white/48'
            }`}>
              {t(achievement.unlocked ? 'achievements.unlocked' : 'achievements.locked')}
            </span>
            <span className="text-[10px] font-bold tabular-nums text-white/35">{current}/{total}</span>
            {formattedUnlockDate && (
              <span className="text-[10px] font-semibold text-white/38">
                {t('achievements.unlockedAt', { date: formattedUnlockDate })}
              </span>
            )}
          </div>
          <h3 className="mt-2 text-[clamp(1.35rem,2.5vw,2.6rem)] font-black leading-tight tracking-[-0.035em] text-white">
            {achievement.name}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-white/58">
            {achievement.description ??
              t(
                achievement.hidden && !achievement.unlocked
                  ? 'achievements.hidden'
                  : achievement.unlocked
                    ? 'achievements.unlocked'
                    : 'achievements.locked'
              )}
          </p>
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] font-bold text-white/40">
            <span>{t('achievements.progressValue', { progress })}</span>
            <span className="tabular-nums text-white/65">{progress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              style={{ width: `${progress}%` }}
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
            />
          </div>
        </div>
      )}

      {guideUnlocked ? (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <p className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-amber-200/80">
            <Youtube size={14} /> {t('achievements.videoSolution')} · Plus
          </p>
          {guideTrailer ? (
            <GameTrailerInlinePlayer
              key={guideTrailer.youtubeVideoId}
              trailer={guideTrailer}
              suspended={guideExpanded}
              onExpand={onGuideExpand}
            />
          ) : guideState === 'loading' || guideState === undefined ? (
            <div
              data-achievement-video-state="loading"
              role="status"
              className="flex aspect-video items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-black/45 text-sm text-white/55"
            >
              <Loader2 size={18} className="animate-spin text-accent" />
              {t('achievements.guideLoading')}
            </div>
          ) : (
            <div
              data-achievement-video-state={guideState}
              className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-amber-200/15 bg-amber-200/[0.045] px-6 py-5 text-center"
            >
              <p role="status" className="text-sm text-amber-100/65">
                {guideIssueKey ? t(guideIssueKey) : t('achievements.guideUnavailable')}
              </p>
              <button
                type="button"
                data-focusable
                data-achievement-guide={achievement.id}
                onClick={onGuideRetry}
                className="mt-3 flex min-h-10 items-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/10 px-4 text-xs font-black text-amber-100 hover:bg-amber-200/20"
              >
                <Youtube size={15} /> {t('achievements.guideRetry')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-5 flex items-start gap-2 border-t border-white/[0.07] pt-4 text-xs leading-relaxed text-amber-100/50">
          <Crown size={14} className="mt-0.5 shrink-0 text-amber-200" />
          {t('achievements.guidePlus')}
        </p>
      )}
    </div>
  )
}
