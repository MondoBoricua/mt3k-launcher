import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Database,
  Image as ImageIcon,
  Info,
  Link2,
  ListChecks,
  Loader2,
  MonitorCog,
  Music2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Video,
  X
} from 'lucide-react'
import type {
  EditableGameMetadataKey,
  GameMetadataOverrides,
  GameMetadataSyncResult,
  GameMetadataUpdateInput,
  GameMediaLinkKind,
  ImageOrientation,
  ImageUpdate,
  LibraryGame,
  LibrarySnapshot
} from '@shared/ipc'
import { safeExternalHttpsUrl } from '@shared/externalUrl'
import { youtubeVideoIdFromUrl } from '@shared/gameTitleMusic'
import { patchesGameMetadataField } from '@shared/gameMetadataOverrides'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useT, type TFunction } from '@renderer/i18n/useT'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { GameImage } from './GameImage'
import { ArtworkPicker } from './ArtworkPicker'
import { MediaLinkSearchDialog } from './MediaLinkSearchDialog'

type SectionId = 'overview' | 'media' | 'facts' | 'system' | 'advanced'
type EditorState = 'idle' | 'saving' | 'syncing' | 'saved' | 'saved-sync-error' | 'error'
type MediaLinkFeedback = 'selected' | 'pasted' | 'empty' | 'invalid' | 'error'

type ValidationMessage =
  | 'metadata.validation.name'
  | 'metadata.validation.https'
  | 'metadata.validation.youtube'
  | 'metadata.validation.hltb'
  | 'metadata.validation.platforms'
  | 'metadata.validation.list'
  | 'metadata.validation.integer'
  | 'metadata.validation.hours'

interface DraftIssue {
  section: SectionId
  field: keyof Draft
  message: ValidationMessage
}

interface Props {
  game: LibraryGame
  onClose: () => void
}

interface Draft {
  name: string
  summary: string
  description: string
  genres: string
  features: string
  developers: string
  publishers: string
  releaseDateText: string
  comingSoon: '' | 'true' | 'false'
  criticScore: string
  recommendationCount: string
  requiredAge: string
  website: string
  storeUrl: string
  trailerUrl: string
  titleMusicUrl: string
  achievementsUrl: string
  languages: string
  controllerSupport: string
  platforms: string
  achievementCount: string
  contentDescriptorNotes: string
  minimumRequirements: string
  recommendedRequirements: string
  hltbUrl: string
  mainStoryHours: string
  mainExtraHours: string
  completionistHours: string
  allStylesHours: string
}

const INPUT_CLASS =
  'w-full rounded-xl border border-white/10 bg-black/25 px-3.5 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-accent/65 focus:bg-black/35'
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-28 resize-y leading-relaxed`
const ARTWORK_ORIENTATIONS: readonly ImageOrientation[] = [
  'vertical',
  'horizontal',
  'logo',
  'icon'
]
const LIST_FIELDS: readonly (keyof Pick<
  Draft,
  'genres' | 'features' | 'developers' | 'publishers' | 'languages'
>)[] = ['genres', 'features', 'developers', 'publishers', 'languages']
const PLATFORM_VALUES = new Set(['windows', 'macos', 'linux'])

function text(value: string | undefined): string {
  return value ?? ''
}

function list(value: string[] | undefined): string {
  return value?.join(', ') ?? ''
}

function number(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

function hours(minutes: number | undefined): string {
  if (!minutes) return ''
  return String(Math.round((minutes / 60) * 10) / 10)
}

function draftFromGame(game: LibraryGame): Draft {
  const metadata = game.metadata
  const completion = metadata.completionTimes
  return {
    name: game.name,
    summary: text(metadata.summary),
    description: text(metadata.description),
    genres: list(metadata.genres),
    features: list(metadata.features),
    developers: list(metadata.developers),
    publishers: list(metadata.publishers),
    releaseDateText: text(metadata.releaseDateText),
    comingSoon: metadata.comingSoon === undefined ? '' : String(metadata.comingSoon) as 'true' | 'false',
    criticScore: number(metadata.criticScore),
    recommendationCount: number(metadata.recommendationCount),
    requiredAge: number(metadata.requiredAge),
    website: text(metadata.website),
    storeUrl: text(metadata.storeUrl),
    trailerUrl: text(metadata.trailerUrl),
    titleMusicUrl: text(metadata.titleMusicUrl),
    achievementsUrl: text(metadata.achievementsUrl),
    languages: list(metadata.languages),
    controllerSupport: text(metadata.controllerSupport),
    platforms: list(metadata.platforms),
    achievementCount: number(metadata.achievementCount),
    contentDescriptorNotes: text(metadata.contentDescriptorNotes),
    minimumRequirements: text(metadata.systemRequirements?.minimum),
    recommendedRequirements: text(metadata.systemRequirements?.recommended),
    hltbUrl: text(completion?.sourceUrl),
    mainStoryHours: hours(completion?.mainStoryMinutes),
    mainExtraHours: hours(completion?.mainExtraMinutes),
    completionistHours: hours(completion?.completionistMinutes),
    allStylesHours: hours(completion?.allStylesMinutes)
  }
}

function cleanList(value: string): string[] | null {
  const values = value
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length > 0 ? [...new Set(values)] : null
}

function cleanNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function minutes(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.round(parsed * 60)) : undefined
}

function validList(value: string): boolean {
  const values = value.split(/[,\n]/u).map((item) => item.trim()).filter(Boolean)
  return (
    values.length <= 64 &&
    values.every(
      (item) => item.length <= 160 && !/[\u0000-\u001f\u007f-\u009f]/u.test(item)
    )
  )
}

function validInteger(value: string, minimum: number, maximum: number): boolean {
  if (!value.trim()) return true
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
}

function validHours(value: string): boolean {
  if (!value.trim()) return true
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 10_000_000 / 60
}

function validHttps(value: string): boolean {
  return !value.trim() || Boolean(safeExternalHttpsUrl(value.trim()))
}

function findDraftIssue(draft: Draft, update: GameMetadataUpdateInput): DraftIssue | undefined {
  const changed = (key: EditableGameMetadataKey): boolean =>
    patchesGameMetadataField(update, key)
  if (!draft.name.trim()) {
    return { section: 'overview', field: 'name', message: 'metadata.validation.name' }
  }
  for (const field of ['website', 'storeUrl', 'trailerUrl', 'achievementsUrl'] as const) {
    if (changed(field) && !validHttps(draft[field])) {
      return { section: 'media', field, message: 'metadata.validation.https' }
    }
  }
  if (
    changed('titleMusicUrl') &&
    draft.titleMusicUrl.trim() &&
    !youtubeVideoIdFromUrl(draft.titleMusicUrl.trim())
  ) {
    return { section: 'media', field: 'titleMusicUrl', message: 'metadata.validation.youtube' }
  }
  const completionTimesChanged = changed('completionTimes')
  if (completionTimesChanged && draft.hltbUrl.trim()) {
    const safe = safeExternalHttpsUrl(draft.hltbUrl.trim())
    const host = safe ? new URL(safe).hostname.toLocaleLowerCase('en-US') : ''
    if (!safe || (host !== 'howlongtobeat.com' && !host.endsWith('.howlongtobeat.com'))) {
      return { section: 'media', field: 'hltbUrl', message: 'metadata.validation.hltb' }
    }
  }
  for (const field of [
    'mainStoryHours',
    'mainExtraHours',
    'completionistHours',
    'allStylesHours'
  ] as const) {
    if (completionTimesChanged && !validHours(draft[field])) {
      return { section: 'media', field, message: 'metadata.validation.hours' }
    }
  }
  for (const field of LIST_FIELDS) {
    if (changed(field) && !validList(draft[field])) {
      return { section: 'facts', field, message: 'metadata.validation.list' }
    }
  }
  if (changed('platforms') && !validList(draft.platforms)) {
    return { section: 'facts', field: 'platforms', message: 'metadata.validation.list' }
  }
  if (
    changed('platforms') &&
    cleanList(draft.platforms)?.some(
      (platform) => !PLATFORM_VALUES.has(platform.toLocaleLowerCase('en-US'))
    )
  ) {
    return { section: 'facts', field: 'platforms', message: 'metadata.validation.platforms' }
  }
  for (const [field, minimum, maximum] of [
    ['criticScore', 0, 100],
    ['recommendationCount', 0, 1_000_000_000],
    ['requiredAge', 0, 99],
    ['achievementCount', 0, 1_000_000]
  ] as const) {
    if (changed(field) && !validInteger(draft[field], minimum, maximum)) {
      return { section: 'facts', field, message: 'metadata.validation.integer' }
    }
  }
  return undefined
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buildUpdate(game: LibraryGame, draft: Draft): GameMetadataUpdateInput {
  const metadata: GameMetadataOverrides = {}
  const current = game.metadata
  const setText = (key: EditableGameMetadataKey, value: string, initial: string | undefined): void => {
    const next = value.trim() || null
    const previous = initial ?? null
    if (next !== previous) (metadata as Record<string, unknown>)[key] = next
  }
  const setList = (key: EditableGameMetadataKey, value: string, initial: string[] | undefined): void => {
    const next = cleanList(value)
    const previous = initial?.length ? initial : null
    if (!same(next, previous)) (metadata as Record<string, unknown>)[key] = next
  }
  const setNumber = (key: EditableGameMetadataKey, value: string, initial: number | undefined): void => {
    const next = cleanNumber(value)
    const previous = initial ?? null
    if (next !== previous) (metadata as Record<string, unknown>)[key] = next
  }

  setText('summary', draft.summary, current.summary)
  setText('description', draft.description, current.description)
  setList('genres', draft.genres, current.genres)
  setList('features', draft.features, current.features)
  setList('developers', draft.developers, current.developers)
  setList('publishers', draft.publishers, current.publishers)
  setText('releaseDateText', draft.releaseDateText, current.releaseDateText)
  const comingSoon = draft.comingSoon === '' ? null : draft.comingSoon === 'true'
  if (comingSoon !== (current.comingSoon ?? null)) metadata.comingSoon = comingSoon
  setNumber('criticScore', draft.criticScore, current.criticScore)
  setNumber('recommendationCount', draft.recommendationCount, current.recommendationCount)
  setNumber('requiredAge', draft.requiredAge, current.requiredAge)
  setText('website', draft.website, current.website)
  setText('storeUrl', draft.storeUrl, current.storeUrl)
  setText('trailerUrl', draft.trailerUrl, current.trailerUrl)
  setText('titleMusicUrl', draft.titleMusicUrl, current.titleMusicUrl)
  setText('achievementsUrl', draft.achievementsUrl, current.achievementsUrl)
  setList('languages', draft.languages, current.languages)
  setText('controllerSupport', draft.controllerSupport, current.controllerSupport)
  const nextPlatforms = cleanList(draft.platforms)?.map((platform) =>
    platform.toLocaleLowerCase('en-US')
  ) ?? null
  const previousPlatforms = current.platforms?.length ? current.platforms : null
  if (!same(nextPlatforms, previousPlatforms)) metadata.platforms = nextPlatforms as GameMetadataOverrides['platforms']
  setNumber('achievementCount', draft.achievementCount, current.achievementCount)
  setText('contentDescriptorNotes', draft.contentDescriptorNotes, current.contentDescriptorNotes)

  const requirements = {
    minimum: draft.minimumRequirements.trim() || undefined,
    recommended: draft.recommendedRequirements.trim() || undefined
  }
  const nextRequirements = requirements.minimum || requirements.recommended ? requirements : null
  const previousRequirements = current.systemRequirements ?? null
  if (!same(nextRequirements, previousRequirements)) metadata.systemRequirements = nextRequirements

  const completionChanged =
    draft.hltbUrl.trim() !== (current.completionTimes?.sourceUrl ?? '') ||
    draft.mainStoryHours !== hours(current.completionTimes?.mainStoryMinutes) ||
    draft.mainExtraHours !== hours(current.completionTimes?.mainExtraMinutes) ||
    draft.completionistHours !== hours(current.completionTimes?.completionistMinutes) ||
    draft.allStylesHours !== hours(current.completionTimes?.allStylesMinutes)
  if (completionChanged) {
    const mainStoryMinutes = minutes(draft.mainStoryHours)
    const mainExtraMinutes = minutes(draft.mainExtraHours)
    const completionistMinutes = minutes(draft.completionistHours)
    const allStylesMinutes = minutes(draft.allStylesHours)
    const sourceUrl = draft.hltbUrl.trim() || undefined
    metadata.completionTimes =
      sourceUrl || mainStoryMinutes || mainExtraMinutes || completionistMinutes || allStylesMinutes
        ? {
            state: 'available',
            provider: 'howlongtobeat',
            mainStoryMinutes,
            mainExtraMinutes,
            completionistMinutes,
            allStylesMinutes,
            sourceTitle: draft.name.trim() || game.name,
            sourceUrl,
            fetchedAt: Date.now()
          }
        : null
  }

  return {
    gameId: game.id,
    name: draft.name.trim() === game.name ? undefined : draft.name.trim(),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  }
}

function syncSummary(result: GameMetadataSyncResult | null): 'complete' | 'partial' | null {
  if (!result) return null
  return Object.values(result.stages).some((stage) => stage === 'failed') ? 'partial' : 'complete'
}

export function GameMetadataEditor({ game, onClose }: Props): JSX.Element {
  const t = useT()
  const reduceMotion = Boolean(useReducedMotion())
  const rootRef = useRef<HTMLDivElement>(null)
  const firstTabRef = useRef<HTMLButtonElement>(null)
  const [section, setSection] = useState<SectionId>('overview')
  const [draft, setDraft] = useState<Draft>(() => draftFromGame(game))
  const [state, setState] = useState<EditorState>('idle')
  const [validationAttempted, setValidationAttempted] = useState(false)
  const [syncResult, setSyncResult] = useState<GameMetadataSyncResult | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [artworkPicker, setArtworkPicker] = useState<ImageOrientation | null>(null)
  const [mediaSearchKind, setMediaSearchKind] = useState<GameMediaLinkKind | null>(null)
  const [mediaPasteBusy, setMediaPasteBusy] = useState<GameMediaLinkKind | null>(null)
  const [mediaFeedback, setMediaFeedback] = useState<{
    kind: GameMediaLinkKind
    state: MediaLinkFeedback
  } | null>(null)
  const [hasArtworkOverrides, setHasArtworkOverrides] = useState<Record<ImageOrientation, boolean>>({
    vertical: false,
    horizontal: false,
    logo: false,
    icon: false
  })

  const update = useMemo(() => buildUpdate(game, draft), [draft, game])
  const draftIssue = useMemo(() => findDraftIssue(draft, update), [draft, update])
  const dirty = Boolean(update.name !== undefined || update.metadata)
  const manualOverrideCount =
    Object.keys(game.metadataOverrides ?? {}).length + (game.nameOverride ? 1 : 0)
  const busy = state === 'saving' || state === 'syncing'

  const set = <Key extends keyof Draft>(key: Key, value: Draft[Key]): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setState('idle')
    setSyncResult(null)
    setConfirmClose(false)
    if (key === 'trailerUrl' || key === 'titleMusicUrl') setMediaFeedback(null)
  }

  const applyMediaLink = (
    kind: GameMediaLinkKind,
    url: string,
    feedback: Extract<MediaLinkFeedback, 'selected' | 'pasted'>
  ): void => {
    set(kind === 'trailer' ? 'trailerUrl' : 'titleMusicUrl', url)
    setMediaFeedback({ kind, state: feedback })
    setMediaSearchKind(null)
  }

  const pasteMediaLink = async (kind: GameMediaLinkKind): Promise<void> => {
    if (busy || mediaPasteBusy) return
    setMediaPasteBusy(kind)
    setMediaFeedback(null)
    try {
      const result = await window.api.library.metadata.pasteMediaLink(kind)
      if (result.state === 'ready' && result.url) applyMediaLink(kind, result.url, 'pasted')
      else setMediaFeedback({ kind, state: result.state === 'ready' ? 'invalid' : result.state })
    } catch {
      setMediaFeedback({ kind, state: 'error' })
    } finally {
      setMediaPasteBusy(null)
    }
  }

  const invalid = (field: keyof Draft): boolean =>
    validationAttempted && draftIssue?.field === field
  const inputClass = (field: keyof Draft, base = INPUT_CLASS): string =>
    `${base} ${invalid(field) ? 'border-rose-300/75 bg-rose-400/[0.08]' : ''}`
  const requestClose = (): void => {
    if (busy) return
    if (dirty && !confirmClose) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  useBackHandler(requestClose)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(firstTabRef.current, { ensureVisible: false }))
    return () => {
      cancelAnimationFrame(frame)
      if (previous?.isConnected) requestAnimationFrame(() => focusElement(previous))
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (artworkPicker || mediaSearchKind) root.setAttribute('inert', '')
    else root.removeAttribute('inert')
    return () => root.removeAttribute('inert')
  }, [artworkPicker, mediaSearchKind])

  useEffect(() => {
    let active = true
    const generations: Record<ImageOrientation, number> = { vertical: 0, horizontal: 0, logo: 0, icon: 0 }
    const refresh = (orientation: ImageOrientation): void => {
      const generation = ++generations[orientation]
      void window.api.image.hasCustom(game.id, orientation).then((hasCustom) => {
        if (active && generations[orientation] === generation) {
          setHasArtworkOverrides((current) => ({ ...current, [orientation]: hasCustom }))
        }
      }).catch(() => undefined)
    }
    ARTWORK_ORIENTATIONS.forEach(refresh)
    const dispose = window.api.image.onUpdated((image: ImageUpdate) => {
      if (image.gameId === game.id) refresh(image.orientation)
    })
    return () => {
      active = false
      dispose()
    }
  }, [game.id])

  const applySnapshot = (snapshot: LibrarySnapshot): void => {
    useLibraryStore.getState().applySnapshot(snapshot)
  }

  const syncGame = async (): Promise<GameMetadataSyncResult> => {
    setState('syncing')
    const result = await window.api.library.metadata.sync(game.id)
    applySnapshot(result.snapshot)
    const synchronizedGame =
      result.snapshot.games.find((candidate) => candidate.id === game.id) ??
      result.snapshot.providerGames.find((candidate) => candidate.id === game.id)
    if (synchronizedGame) setDraft(draftFromGame(synchronizedGame))
    setSyncResult(result)
    setState('saved')
    return result
  }

  const save = async (): Promise<void> => {
    if (busy) return
    if (draftIssue) {
      setValidationAttempted(true)
      setState('error')
      setSection(draftIssue.section)
      requestAnimationFrame(() => {
        const target = rootRef.current?.querySelector<HTMLElement>(
          `[data-metadata-field="${draftIssue.field}"]`
        )
        focusElement(target ?? null)
      })
      return
    }
    setValidationAttempted(false)
    setState('saving')
    let persisted = false
    try {
      if (dirty) {
        applySnapshot(await window.api.library.metadata.update(update))
        persisted = true
      }
      await syncGame()
    } catch {
      setState(persisted ? 'saved-sync-error' : 'error')
    }
  }

  const resetAll = async (): Promise<void> => {
    if (busy) return
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setState('saving')
    let persisted = false
    try {
      applySnapshot(
        await window.api.library.metadata.update({ gameId: game.id, resetAll: true })
      )
      persisted = true
      await syncGame()
      onClose()
    } catch {
      setState(persisted ? 'saved-sync-error' : 'error')
      setConfirmReset(false)
    }
  }

  const sections: Array<{ id: SectionId; icon: typeof Info; label: string }> = [
    { id: 'overview', icon: Info, label: t('metadata.section.overview') },
    { id: 'media', icon: ImageIcon, label: t('metadata.section.media') },
    { id: 'facts', icon: ListChecks, label: t('metadata.section.facts') },
    { id: 'system', icon: MonitorCog, label: t('metadata.section.system') },
    { id: 'advanced', icon: ShieldCheck, label: t('metadata.section.advanced') }
  ]

  const manual = (key: EditableGameMetadataKey): boolean =>
    Object.hasOwn(game.metadataOverrides ?? {}, key)

  const resultTone = syncSummary(syncResult)
  const previewGenres = cleanList(draft.genres)?.slice(0, 3) ?? []

  const editor = (
    <motion.div
      ref={rootRef}
      data-focus-scope={artworkPicker || mediaSearchKind ? undefined : 'active'}
      role="dialog"
      aria-modal="true"
      aria-label={t('metadata.title')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.1 : 0.2 }}
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/80 p-[clamp(0.5rem,1.5vw,1.5rem)] backdrop-blur-2xl"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <motion.section
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduceMotion ? { duration: 0.1 } : { type: 'spring', stiffness: 330, damping: 30 }}
        onPointerDown={(event) => event.stopPropagation()}
        className="metadata-editor grid h-full max-h-[96vh] w-full max-w-[112rem] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[clamp(1.25rem,2.4vw,2.25rem)] border border-white/10 bg-surface shadow-[0_38px_140px_rgba(0,0,0,0.82)]"
      >
        <header className="flex min-w-0 items-center gap-4 border-b border-white/[0.07] bg-white/[0.025] px-[clamp(1rem,2vw,2rem)] py-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
            <Database size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="truncate text-xl font-bold text-white">{draft.name || game.name}</h2>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                {game.provider}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-white/42">
              {t('metadata.subtitle', { count: manualOverrideCount })}
            </p>
          </div>
          {dirty && (
            <span className="hidden items-center gap-2 rounded-full border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 md:flex">
              <Sparkles size={14} /> {t('metadata.unsaved')}
            </span>
          )}
          <button
            data-focusable
            type="button"
            disabled={busy}
            onClick={requestClose}
            aria-label={t('metadata.close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/15 hover:text-white disabled:opacity-40"
          >
            <X size={19} />
          </button>
        </header>

        <div className="metadata-editor-body grid min-h-0 grid-cols-[13.5rem_minmax(24rem,1fr)_minmax(18rem,0.68fr)]">
          <nav aria-label={t('metadata.sections')} className="min-h-0 border-r border-white/[0.07] bg-black/15 p-3">
            <div className="space-y-1.5">
              {sections.map(({ id, icon: Icon, label }, index) => (
                <button
                  key={id}
                  ref={index === 0 ? firstTabRef : undefined}
                  data-focusable
                  type="button"
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => setSection(id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-colors ${
                    section === id
                      ? 'bg-accent text-black shadow-[0_10px_30px_rgb(var(--color-accent)/0.14)]'
                      : 'text-white/52 hover:bg-white/[0.07] hover:text-white'
                  }`}
                >
                  <Icon size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
                {t('metadata.overrideState')}
              </p>
              <p className="mt-2 text-2xl font-bold text-white">{manualOverrideCount}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/38">{t('metadata.overrideHint')}</p>
            </div>
          </nav>

          <main className="scrollbar-none min-h-0 overflow-y-auto overscroll-contain px-[clamp(1rem,2.2vw,2.25rem)] py-[clamp(1rem,2vh,1.75rem)]">
            {section === 'overview' && (
              <Section title={t('metadata.section.overview')} description={t('metadata.section.overviewBody')}>
                <Field label={t('metadata.name')} manual={Boolean(game.nameOverride)}>
                  <input data-focusable data-metadata-field="name" aria-invalid={invalid('name')} autoComplete="off" maxLength={160} value={draft.name} onChange={(event) => set('name', event.target.value)} className={inputClass('name')} />
                </Field>
                <Field label={t('metadata.summary')} manual={manual('summary')}>
                  <textarea data-focusable maxLength={2_000} value={draft.summary} onChange={(event) => set('summary', event.target.value)} className={`${TEXTAREA_CLASS} min-h-24`} />
                </Field>
                <Field label={t('metadata.description')} manual={manual('description')}>
                  <textarea data-focusable maxLength={24_000} value={draft.description} onChange={(event) => set('description', event.target.value)} className={`${TEXTAREA_CLASS} min-h-48`} />
                </Field>
              </Section>
            )}

            {section === 'media' && (
              <Section title={t('metadata.section.media')} description={t('metadata.section.mediaBody')}>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {ARTWORK_ORIENTATIONS.map((orientation) => (
                    <button
                      key={orientation}
                      data-focusable
                      type="button"
                      onClick={() => setArtworkPicker(orientation)}
                      className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left transition-all hover:border-accent/45 data-[focused=true]:border-accent"
                    >
                      <div className={`relative overflow-hidden bg-black/30 ${orientation === 'vertical' ? 'aspect-[2/3]' : orientation === 'logo' ? 'aspect-[3/1]' : orientation === 'icon' ? 'aspect-square' : 'aspect-video'}`}>
                        <GameImage gameId={game.id} name={draft.name || game.name} orientation={orientation} className={`h-full w-full ${orientation === 'logo' || orientation === 'icon' ? 'object-contain p-2' : 'object-cover'}`} />
                      </div>
                      <span className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-white/70">
                        {t(`artwork.${orientation === 'vertical' ? 'cover' : orientation === 'horizontal' ? 'background' : orientation}`)}
                        {hasArtworkOverrides[orientation] && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <MediaLinkField
                    id="metadata-trailer-url"
                    label={t('metadata.trailerUrl')}
                    manual={manual('trailerUrl')}
                    icon={<Video size={14} />}
                    hint={t('metadata.trailerHint')}
                    feedback={mediaLinkFeedbackText(t, mediaFeedback, 'trailer')}
                    actions={<>
                      <MediaLinkAction icon={<Search size={13} />} label={t('metadata.mediaSearch.action')} disabled={busy || Boolean(mediaPasteBusy)} onClick={() => setMediaSearchKind('trailer')} />
                      <MediaLinkAction icon={mediaPasteBusy === 'trailer' ? <Loader2 size={13} className="animate-spin" /> : <ClipboardPaste size={13} />} label={t('metadata.mediaPaste.action')} disabled={busy || Boolean(mediaPasteBusy)} onClick={() => void pasteMediaLink('trailer')} />
                    </>}
                  >
                    <input id="metadata-trailer-url" data-focusable data-metadata-field="trailerUrl" aria-invalid={invalid('trailerUrl')} type="url" maxLength={4_096} placeholder="https://…" value={draft.trailerUrl} onChange={(event) => set('trailerUrl', event.target.value)} className={inputClass('trailerUrl')} />
                  </MediaLinkField>
                  <MediaLinkField
                    id="metadata-title-music-url"
                    label={t('metadata.titleMusicUrl')}
                    manual={manual('titleMusicUrl')}
                    icon={<Music2 size={14} />}
                    hint={t('metadata.musicHint')}
                    feedback={mediaLinkFeedbackText(t, mediaFeedback, 'title-music')}
                    actions={<>
                      <MediaLinkAction icon={<Search size={13} />} label={t('metadata.mediaSearch.action')} disabled={busy || Boolean(mediaPasteBusy)} onClick={() => setMediaSearchKind('title-music')} />
                      <MediaLinkAction icon={mediaPasteBusy === 'title-music' ? <Loader2 size={13} className="animate-spin" /> : <ClipboardPaste size={13} />} label={t('metadata.mediaPaste.action')} disabled={busy || Boolean(mediaPasteBusy)} onClick={() => void pasteMediaLink('title-music')} />
                    </>}
                  >
                    <input id="metadata-title-music-url" data-focusable data-metadata-field="titleMusicUrl" aria-invalid={invalid('titleMusicUrl')} type="url" maxLength={4_096} placeholder="https://youtube.com/watch?v=…" value={draft.titleMusicUrl} onChange={(event) => set('titleMusicUrl', event.target.value)} className={inputClass('titleMusicUrl')} />
                  </MediaLinkField>
                  <Field label={t('metadata.website')} manual={manual('website')} icon={<Link2 size={14} />}>
                    <input data-focusable data-metadata-field="website" aria-invalid={invalid('website')} type="url" maxLength={4_096} placeholder="https://…" value={draft.website} onChange={(event) => set('website', event.target.value)} className={inputClass('website')} />
                  </Field>
                  <Field label={t('metadata.storeUrl')} manual={manual('storeUrl')} icon={<Link2 size={14} />}>
                    <input data-focusable data-metadata-field="storeUrl" aria-invalid={invalid('storeUrl')} type="url" maxLength={4_096} placeholder="https://…" value={draft.storeUrl} onChange={(event) => set('storeUrl', event.target.value)} className={inputClass('storeUrl')} />
                  </Field>
                  <Field label={t('metadata.achievementsUrl')} manual={manual('achievementsUrl')} icon={<Trophy size={14} />}>
                    <input data-focusable data-metadata-field="achievementsUrl" aria-invalid={invalid('achievementsUrl')} type="url" maxLength={4_096} placeholder="https://…" value={draft.achievementsUrl} onChange={(event) => set('achievementsUrl', event.target.value)} className={inputClass('achievementsUrl')} />
                  </Field>
                  <Field label={t('metadata.hltbUrl')} manual={manual('completionTimes')} icon={<Link2 size={14} />}>
                    <input data-focusable data-metadata-field="hltbUrl" aria-invalid={invalid('hltbUrl')} type="url" maxLength={4_096} placeholder="https://howlongtobeat.com/game/…" value={draft.hltbUrl} onChange={(event) => set('hltbUrl', event.target.value)} className={inputClass('hltbUrl')} />
                  </Field>
                </div>
                <div>
                  <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-white/42">{t('metadata.hltbTimes')}</p>
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <CompactNumber field="mainStoryHours" invalid={invalid('mainStoryHours')} label={t('details.mainStory')} value={draft.mainStoryHours} onChange={(value) => set('mainStoryHours', value)} suffix="h" />
                    <CompactNumber field="mainExtraHours" invalid={invalid('mainExtraHours')} label={t('details.mainExtra')} value={draft.mainExtraHours} onChange={(value) => set('mainExtraHours', value)} suffix="h" />
                    <CompactNumber field="completionistHours" invalid={invalid('completionistHours')} label={t('details.completionist')} value={draft.completionistHours} onChange={(value) => set('completionistHours', value)} suffix="h" />
                    <CompactNumber field="allStylesHours" invalid={invalid('allStylesHours')} label={t('metadata.allStyles')} value={draft.allStylesHours} onChange={(value) => set('allStylesHours', value)} suffix="h" />
                  </div>
                </div>
              </Section>
            )}

            {section === 'facts' && (
              <Section title={t('metadata.section.facts')} description={t('metadata.section.factsBody')}>
                <div className="grid gap-4 xl:grid-cols-2">
                  <Field label={t('metadata.genres')} manual={manual('genres')} hint={t('metadata.listHint')}><input data-focusable data-metadata-field="genres" aria-invalid={invalid('genres')} maxLength={10_304} value={draft.genres} onChange={(event) => set('genres', event.target.value)} className={inputClass('genres')} /></Field>
                  <Field label={t('metadata.features')} manual={manual('features')} hint={t('metadata.listHint')}><input data-focusable data-metadata-field="features" aria-invalid={invalid('features')} maxLength={10_304} value={draft.features} onChange={(event) => set('features', event.target.value)} className={inputClass('features')} /></Field>
                  <Field label={t('metadata.developers')} manual={manual('developers')} hint={t('metadata.listHint')}><input data-focusable data-metadata-field="developers" aria-invalid={invalid('developers')} maxLength={10_304} value={draft.developers} onChange={(event) => set('developers', event.target.value)} className={inputClass('developers')} /></Field>
                  <Field label={t('metadata.publishers')} manual={manual('publishers')} hint={t('metadata.listHint')}><input data-focusable data-metadata-field="publishers" aria-invalid={invalid('publishers')} maxLength={10_304} value={draft.publishers} onChange={(event) => set('publishers', event.target.value)} className={inputClass('publishers')} /></Field>
                  <Field label={t('metadata.languages')} manual={manual('languages')} hint={t('metadata.listHint')}><input data-focusable data-metadata-field="languages" aria-invalid={invalid('languages')} maxLength={10_304} value={draft.languages} onChange={(event) => set('languages', event.target.value)} className={inputClass('languages')} /></Field>
                  <Field label={t('metadata.platforms')} manual={manual('platforms')} hint={t('metadata.platformHint')}><input data-focusable data-metadata-field="platforms" aria-invalid={invalid('platforms')} maxLength={10_304} placeholder="windows, macos, linux" value={draft.platforms} onChange={(event) => set('platforms', event.target.value)} className={inputClass('platforms')} /></Field>
                  <Field label={t('metadata.releaseDate')} manual={manual('releaseDateText')}><input data-focusable maxLength={160} value={draft.releaseDateText} onChange={(event) => set('releaseDateText', event.target.value)} className={INPUT_CLASS} /></Field>
                  <Field label={t('metadata.controllerSupport')} manual={manual('controllerSupport')}><input data-focusable maxLength={240} value={draft.controllerSupport} onChange={(event) => set('controllerSupport', event.target.value)} className={INPUT_CLASS} /></Field>
                  <Field label={t('metadata.comingSoon')} manual={manual('comingSoon')}>
                    <select data-focusable value={draft.comingSoon} onChange={(event) => set('comingSoon', event.target.value as Draft['comingSoon'])} className={INPUT_CLASS}>
                      <option value="">{t('metadata.unknown')}</option>
                      <option value="false">{t('metadata.no')}</option>
                      <option value="true">{t('metadata.yes')}</option>
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <CompactNumber field="criticScore" invalid={invalid('criticScore')} label={t('metadata.criticScore')} value={draft.criticScore} onChange={(value) => set('criticScore', value)} max={100} />
                  <CompactNumber field="recommendationCount" invalid={invalid('recommendationCount')} label={t('metadata.recommendations')} value={draft.recommendationCount} onChange={(value) => set('recommendationCount', value)} max={1_000_000_000} />
                  <CompactNumber field="requiredAge" invalid={invalid('requiredAge')} label={t('metadata.requiredAge')} value={draft.requiredAge} onChange={(value) => set('requiredAge', value)} max={99} />
                  <CompactNumber field="achievementCount" invalid={invalid('achievementCount')} label={t('metadata.achievementCount')} value={draft.achievementCount} onChange={(value) => set('achievementCount', value)} max={1_000_000} />
                </div>
              </Section>
            )}

            {section === 'system' && (
              <Section title={t('metadata.section.system')} description={t('metadata.section.systemBody')}>
                <Field label={t('metadata.minimumRequirements')} manual={manual('systemRequirements')}><textarea data-focusable maxLength={20_000} value={draft.minimumRequirements} onChange={(event) => set('minimumRequirements', event.target.value)} className={`${TEXTAREA_CLASS} min-h-40`} /></Field>
                <Field label={t('metadata.recommendedRequirements')} manual={manual('systemRequirements')}><textarea data-focusable maxLength={20_000} value={draft.recommendedRequirements} onChange={(event) => set('recommendedRequirements', event.target.value)} className={`${TEXTAREA_CLASS} min-h-40`} /></Field>
                <Field label={t('metadata.contentDescriptor')} manual={manual('contentDescriptorNotes')}><textarea data-focusable maxLength={8_000} value={draft.contentDescriptorNotes} onChange={(event) => set('contentDescriptorNotes', event.target.value)} className={TEXTAREA_CLASS} /></Field>
              </Section>
            )}

            {section === 'advanced' && (
              <Section title={t('metadata.section.advanced')} description={t('metadata.section.advancedBody')}>
                <div className="grid gap-3 xl:grid-cols-2">
                  <ReadOnly label={t('metadata.provider')} value={game.provider} />
                  <ReadOnly label={t('metadata.providerGameId')} value={game.providerGameId} />
                  <ReadOnly label={t('metadata.metadataSource')} value={game.metadataSource ?? '—'} />
                  <ReadOnly label={t('metadata.metadataRevision')} value={String(game.metadataRevision)} />
                  <ReadOnly label={t('metadata.installDirectory')} value={game.installDir ?? '—'} />
                  <ReadOnly label={t('metadata.launchTarget')} value={game.metadata.launchUri ?? game.metadata.launchExecutable ?? '—'} />
                </div>
                <div className="rounded-2xl border border-amber-200/15 bg-amber-300/[0.06] p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber-100/75" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-white">{t('metadata.protectedTitle')}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-white/45">{t('metadata.protectedBody')}</p>
                    </div>
                  </div>
                </div>
                {manualOverrideCount > 0 && (
                  <button data-focusable type="button" disabled={busy} onClick={() => void resetAll()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200/20 bg-rose-300/[0.07] px-4 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-300/[0.12] disabled:opacity-45">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                    {confirmReset ? t('metadata.resetConfirm') : t('metadata.resetAll')}
                  </button>
                )}
              </Section>
            )}
          </main>

          <aside className="metadata-editor-preview min-h-0 overflow-y-auto border-l border-white/[0.07] bg-black/20 p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{t('metadata.livePreview')}</p>
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
              <GameImage gameId={game.id} name={draft.name || game.name} orientation="horizontal" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
              <GameImage gameId={game.id} name={draft.name || game.name} orientation="logo" className="absolute bottom-4 left-4 h-[28%] w-[58%] object-contain object-left-bottom drop-shadow-2xl" />
            </div>
            <div className="mt-4 flex items-start gap-3">
              <div className="relative aspect-[2/3] h-24 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                <GameImage gameId={game.id} name={draft.name || game.name} orientation="vertical" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">{game.provider}</p>
                <h3 className="mt-1 line-clamp-3 text-xl font-bold leading-tight text-white">{draft.name || game.name}</h3>
                {draft.releaseDateText && <p className="mt-1 text-xs text-white/40">{draft.releaseDateText}</p>}
              </div>
            </div>
            {draft.summary && <p className="mt-4 line-clamp-5 text-sm leading-relaxed text-white/52">{draft.summary}</p>}
            {previewGenres.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {previewGenres.map((genre) => <span key={genre} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold text-white/52">{genre}</span>)}
              </div>
            )}
            <div className="mt-5 space-y-2 border-t border-white/[0.07] pt-4 text-xs">
              <PreviewState icon={<Video size={14} />} label={t('metadata.trailerUrl')} active={Boolean(draft.trailerUrl)} />
              <PreviewState icon={<Music2 size={14} />} label={t('metadata.titleMusicUrl')} active={Boolean(draft.titleMusicUrl)} />
              <PreviewState icon={<Trophy size={14} />} label={t('metadata.achievements')} active={Boolean(draft.achievementCount || draft.achievementsUrl)} />
            </div>
          </aside>
        </div>

        <footer className="flex min-h-[4.5rem] flex-wrap items-center gap-3 border-t border-white/[0.07] bg-black/15 px-[clamp(1rem,2vw,2rem)] py-3">
          <div className="min-w-0 flex-1" role="status" aria-live="polite">
            {state === 'error' ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-rose-100"><AlertTriangle size={16} /> {t(validationAttempted && draftIssue ? draftIssue.message : 'metadata.saveError')}</p>
            ) : state === 'saved-sync-error' ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-100"><AlertTriangle size={16} /> {t('metadata.savedSyncError')}</p>
            ) : state === 'saved' ? (
              <p className={`flex items-center gap-2 text-sm font-semibold ${resultTone === 'partial' ? 'text-amber-100' : 'text-emerald-100'}`}>
                {resultTone === 'partial' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                {t(resultTone === 'partial' ? 'metadata.syncedPartial' : 'metadata.synced')}
              </p>
            ) : confirmClose ? (
              <p className="text-sm font-semibold text-amber-100">{t('metadata.discardPrompt')}</p>
            ) : (
              <p className="truncate text-xs text-white/35">{t('metadata.footerHint')}</p>
            )}
          </div>
          {confirmClose && (
            <button data-focusable type="button" onClick={() => setConfirmClose(false)} className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white">{t('metadata.keepEditing')}</button>
          )}
          <button data-focusable type="button" disabled={busy} onClick={requestClose} className={`rounded-full border px-4 py-2.5 text-sm font-semibold disabled:opacity-45 ${confirmClose ? 'border-rose-200/25 bg-rose-300/10 text-rose-100' : 'border-white/10 bg-white/[0.06] text-white/65'}`}>
            {confirmClose ? t('metadata.discard') : t('metadata.close')}
          </button>
          <button data-focusable type="button" disabled={busy || dirty} onClick={() => void syncGame().catch(() => setState('error'))} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-35">
            {state === 'syncing' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {t('metadata.syncOnly')}
          </button>
          <button data-focusable type="button" disabled={busy} onClick={() => void save()} className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-black shadow-[0_10px_30px_rgb(var(--color-accent)/0.16)] disabled:opacity-45">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
            {t(state === 'saving' ? 'metadata.saving' : state === 'syncing' ? 'metadata.syncing' : 'metadata.saveAndSync')}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  )

  return createPortal(
    <>
      {editor}
      {artworkPicker && (
        <ArtworkPicker
          gameId={game.id}
          gameName={draft.name || game.name}
          hasOverrides={hasArtworkOverrides}
          initialOrientation={artworkPicker}
          onApplied={(orientation) => setHasArtworkOverrides((current) => ({ ...current, [orientation]: true }))}
          onReset={(orientation) => setHasArtworkOverrides((current) => ({ ...current, [orientation]: false }))}
          onClose={() => setArtworkPicker(null)}
        />
      )}
      {mediaSearchKind && (
        <MediaLinkSearchDialog
          gameId={game.id}
          gameName={draft.name || game.name}
          kind={mediaSearchKind}
          onSelect={(url) => applyMediaLink(mediaSearchKind, url, 'selected')}
          onClose={() => setMediaSearchKind(null)}
        />
      )}
    </>,
    document.body
  )
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }): JSX.Element {
  return <section className="space-y-5">
    <div><h2 className="text-2xl font-bold tracking-[-0.02em] text-white">{title}</h2><p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-white/42">{description}</p></div>
    {children}
  </section>
}

function Field({ label, hint, manual, icon, children }: { label: string; hint?: string; manual?: boolean; icon?: ReactNode; children: ReactNode }): JSX.Element {
  const t = useT()
  return <label className="block">
    <span className="mb-2 flex items-center gap-2 text-xs font-bold text-white/58">{icon}<span>{label}</span>{manual && <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-accent">{t('metadata.manual')}</span>}</span>
    {children}
    {hint && <span className="mt-1.5 block text-[11px] leading-relaxed text-white/30">{hint}</span>}
  </label>
}

function MediaLinkField({
  id,
  label,
  hint,
  manual,
  icon,
  actions,
  feedback,
  children
}: {
  id: string
  label: string
  hint: string
  manual: boolean
  icon: ReactNode
  actions: ReactNode
  feedback?: { text: string; error: boolean }
  children: ReactNode
}): JSX.Element {
  const t = useT()
  return (
    <div className="block">
      <div className="mb-2 flex min-h-7 items-center gap-2">
        <label htmlFor={id} className="flex min-w-0 items-center gap-2 text-xs font-bold text-white/58">
          {icon}
          <span className="truncate">{label}</span>
          {manual && (
            <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-accent">
              {t('metadata.manual')}
            </span>
          )}
        </label>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</span>
      </div>
      {children}
      {feedback ? (
        <p
          role={feedback.error ? 'alert' : 'status'}
          aria-live="polite"
          className={`mt-1.5 text-[11px] font-medium ${feedback.error ? 'text-rose-200/85' : 'text-emerald-200/75'}`}
        >
          {feedback.text}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/30">{hint}</p>
      )}
    </div>
  )
}

function MediaLinkAction({
  icon,
  label,
  disabled,
  onClick
}: {
  icon: ReactNode
  label: string
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      data-focusable
      data-disabled={disabled ? 'true' : undefined}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-[10px] font-bold text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-40 data-[focused=true]:border-accent/60 data-[focused=true]:bg-accent/[0.12] data-[focused=true]:text-white"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function mediaLinkFeedbackText(
  t: TFunction,
  feedback: { kind: GameMediaLinkKind; state: MediaLinkFeedback } | null,
  kind: GameMediaLinkKind
): { text: string; error: boolean } | undefined {
  if (!feedback || feedback.kind !== kind) return undefined
  if (feedback.state === 'selected') {
    return { text: t('metadata.mediaLink.selected'), error: false }
  }
  if (feedback.state === 'pasted') {
    return { text: t('metadata.mediaLink.pasted'), error: false }
  }
  if (feedback.state === 'empty') {
    return { text: t('metadata.mediaLink.empty'), error: true }
  }
  if (feedback.state === 'invalid') {
    return { text: t('metadata.mediaLink.invalid'), error: true }
  }
  return { text: t('metadata.mediaLink.error'), error: true }
}

function CompactNumber({ field, invalid, label, value, onChange, suffix, max }: { field: keyof Draft; invalid: boolean; label: string; value: string; onChange: (value: string) => void; suffix?: string; max?: number }): JSX.Element {
  return <label className={`rounded-xl border p-3 ${invalid ? 'border-rose-300/75 bg-rose-400/[0.08]' : 'border-white/[0.08] bg-white/[0.035]'}`}>
    <span className="block truncate text-[10px] font-bold uppercase tracking-[0.11em] text-white/38">{label}</span>
    <span className="mt-2 flex items-center gap-2"><input data-focusable data-metadata-field={field} aria-invalid={invalid} type="number" min="0" max={max} step={suffix ? '0.1' : '1'} value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-lg font-bold text-white outline-none" />{suffix && <span className="text-sm text-white/35">{suffix}</span>}</span>
  </label>
}

function ReadOnly({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/30">{label}</p><p className="mt-1.5 break-all text-xs text-white/62">{value}</p></div>
}

function PreviewState({ icon, label, active }: { icon: ReactNode; label: string; active: boolean }): JSX.Element {
  const t = useT()
  return <div className="flex items-center gap-2.5 text-white/45"><span className={active ? 'text-accent' : 'text-white/25'}>{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span><span className={active ? 'text-emerald-200/70' : 'text-white/25'}>{t(active ? 'metadata.configured' : 'metadata.automatic')}</span></div>
}
