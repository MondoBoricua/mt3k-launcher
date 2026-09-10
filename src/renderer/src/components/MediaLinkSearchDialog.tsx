import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Clock3, ExternalLink, Loader2, Music2, Search, Video, X } from 'lucide-react'
import {
  MAX_MEDIA_SEARCH_QUERY_LENGTH,
  mediaLinkSearchSuggestions,
  normalizeMediaSearchQuery,
  youtubeSearchUrl,
  type GameMediaLinkKind,
  type MediaLinkSearchResult
} from '@shared/mediaLinkSearch'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'

interface Props {
  gameId: string
  gameName: string
  kind: GameMediaLinkKind
  onSelect: (url: string) => void
  onClose: () => void
}

const SUGGESTION_LABELS = {
  trailer: [
    'metadata.mediaSearch.suggestion.trailer.1',
    'metadata.mediaSearch.suggestion.trailer.2',
    'metadata.mediaSearch.suggestion.trailer.3'
  ],
  'title-music': [
    'metadata.mediaSearch.suggestion.music.1',
    'metadata.mediaSearch.suggestion.music.2',
    'metadata.mediaSearch.suggestion.music.3'
  ]
} as const

export function MediaLinkSearchDialog({
  gameId,
  gameName,
  kind,
  onSelect,
  onClose
}: Props): JSX.Element {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const suggestions = useMemo(() => mediaLinkSearchSuggestions(gameName, kind), [gameName, kind])
  const [query, setQuery] = useState(suggestions[0] ?? gameName)
  const [result, setResult] = useState<MediaLinkSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [queryInvalid, setQueryInvalid] = useState(false)

  const load = useCallback(
    (queryValue: string): void => {
      const normalized = normalizeMediaSearchQuery(queryValue)
      if (!normalized) {
        setQueryInvalid(true)
        setResult(null)
        setLoading(false)
        return
      }
      const generation = ++generationRef.current
      setQuery(normalized)
      setQueryInvalid(false)
      setResult(null)
      setLoading(true)
      void window.api.library.metadata
        .searchMedia(gameId, kind, normalized)
        .then((nextResult) => {
          if (generationRef.current === generation) {
            setResult(nextResult)
            setLoading(false)
          }
        })
        .catch(() => {
          if (generationRef.current === generation) {
            setResult({ state: 'unavailable', query: normalized, options: [] })
            setLoading(false)
          }
        })
    },
    [gameId, kind]
  )

  useBackHandler(onClose)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(inputRef.current, { ensureVisible: false }))
    load(suggestions[0] ?? gameName)
    return () => {
      generationRef.current++
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [gameName, load, suggestions])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!loading) load(query)
  }

  const openYouTube = (): void => {
    const url = youtubeSearchUrl(query)
    if (url) void window.api.app.openExternal(url)
    else setQueryInvalid(true)
  }

  const title = kind === 'trailer' ? t('metadata.mediaSearch.trailer') : t('metadata.mediaSearch.music')

  return createPortal(
    <AnimatePresence>
      <motion.div
        data-focus-scope="active"
        data-media-link-search="true"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-[clamp(0.65rem,2.5vw,2.5rem)] backdrop-blur-2xl"
      >
        <motion.section
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.985 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-busy={loading}
          className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-[clamp(1.25rem,2.5vw,2rem)] border border-white/10 bg-surface shadow-[0_38px_130px_rgba(0,0,0,0.82)]"
        >
          <header className="flex shrink-0 items-center gap-4 border-b border-white/[0.07] px-[clamp(1rem,2.5vw,1.75rem)] py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
              {kind === 'trailer' ? <Video size={21} /> : <Music2 size={21} />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold text-white">{title}</h2>
              <p className="mt-0.5 truncate text-xs text-white/40">{gameName} · YouTube</p>
            </div>
            <button
              data-focusable
              type="button"
              onClick={onClose}
              aria-label={t('metadata.mediaSearch.close')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/55 hover:bg-white/15 data-[focused=true]:border-accent/60 data-[focused=true]:text-accent"
            >
              <X size={18} />
            </button>
          </header>

          <div className="shrink-0 space-y-3 border-b border-white/[0.07] px-[clamp(1rem,2.5vw,1.75rem)] py-4">
            <form role="search" onSubmit={submit} className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-black/25 p-1 pl-4 focus-within:border-accent/55">
              <Search size={17} className="shrink-0 text-white/35" />
              <input
                ref={inputRef}
                data-focusable
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                maxLength={MAX_MEDIA_SEARCH_QUERY_LENGTH}
                aria-invalid={queryInvalid || undefined}
                aria-label={t('metadata.mediaSearch.query')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (normalizeMediaSearchQuery(event.target.value)) setQueryInvalid(false)
                }}
                className="min-w-0 flex-1 bg-transparent px-1 py-2.5 text-sm font-semibold text-white outline-none placeholder:text-white/25"
              />
              <button
                data-focusable
                data-disabled={loading ? 'true' : undefined}
                type="submit"
                disabled={loading}
                className="flex shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-45 data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.25)]"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                {t('metadata.mediaSearch.action')}
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
                {t('metadata.mediaSearch.suggestions')}
              </span>
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion}
                  data-focusable
                  type="button"
                  disabled={loading && query === suggestion}
                  data-disabled={loading && query === suggestion ? 'true' : undefined}
                  onClick={() => load(suggestion)}
                  className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-semibold text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-45 data-[focused=true]:border-accent/60 data-[focused=true]:bg-accent/[0.12] data-[focused=true]:text-white"
                >
                  {t(SUGGESTION_LABELS[kind][index] ?? SUGGESTION_LABELS[kind][0])}
                </button>
              ))}
              <button
                data-focusable
                type="button"
                onClick={openYouTube}
                className="ml-auto flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-white/42 hover:bg-white/[0.06] hover:text-white data-[focused=true]:bg-white/[0.08] data-[focused=true]:text-accent"
              >
                <ExternalLink size={14} />
                {t('metadata.mediaSearch.external')}
              </button>
            </div>
            {queryInvalid && (
              <p role="alert" className="text-xs font-medium text-amber-100">
                {t('metadata.mediaSearch.queryInvalid')}
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(1rem,2.5vw,1.75rem)] py-4">
            {loading ? (
              <div role="status" aria-live="polite" className="flex min-h-72 flex-col items-center justify-center gap-3 text-white/45">
                <Loader2 size={28} className="animate-spin text-accent" />
                <p className="text-sm">{t('metadata.mediaSearch.loading')}</p>
              </div>
            ) : result?.state === 'ready' && result.options.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {result.options.map((option, index) => (
                  <button
                    key={option.videoId}
                    data-focusable
                    type="button"
                    onClick={() => onSelect(option.url)}
                    aria-label={`${option.title}, ${t('metadata.mediaSearch.use')}`}
                    className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left transition-all hover:-translate-y-0.5 hover:border-white/25 data-[focused=true]:-translate-y-0.5 data-[focused=true]:border-accent data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.2)]"
                  >
                    <span className="relative block aspect-video overflow-hidden bg-black/40">
                      <img
                        src={option.thumbnailUrl}
                        alt=""
                        loading={index < 6 ? 'eager' : 'lazy'}
                        referrerPolicy="no-referrer"
                        draggable={false}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025] group-data-[focused=true]:scale-[1.025]"
                      />
                      {option.durationSeconds && (
                        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/80 px-2 py-1 text-[10px] font-bold text-white/85">
                          <Clock3 size={11} /> {formatDuration(option.durationSeconds)}
                        </span>
                      )}
                    </span>
                    <span className="flex min-h-20 items-start gap-3 px-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-sm font-bold leading-snug text-white/88">{option.title}</span>
                        {option.author && <span className="mt-1 block truncate text-xs text-white/38">{option.author}</span>}
                      </span>
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/[0.12] text-accent opacity-60 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100">
                        <Check size={14} />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : result ? (
              <div role="status" aria-live="polite" className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
                <Search size={28} className="text-white/25" />
                <p className="max-w-lg text-sm leading-relaxed text-white/48">
                  {result.state === 'missing'
                    ? t('metadata.mediaSearch.missing')
                    : t('metadata.mediaSearch.unavailable')}
                </p>
                <button
                  data-focusable
                  type="button"
                  onClick={openYouTube}
                  className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-semibold text-white data-[focused=true]:border-accent/60 data-[focused=true]:bg-accent/[0.12]"
                >
                  <ExternalLink size={15} /> {t('metadata.mediaSearch.external')}
                </button>
              </div>
            ) : null}
          </div>

          <footer className="shrink-0 border-t border-white/[0.06] px-5 py-2.5 text-center text-[11px] text-white/28">
            {t('metadata.mediaSearch.footer')}
          </footer>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

function formatDuration(secondsValue: number): string {
  const seconds = Math.max(0, Math.round(secondsValue))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`
}
