import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Database, Gamepad2, Loader2, Search, X } from 'lucide-react'
import {
  MAX_METADATA_SEARCH_QUERY_LENGTH,
  normalizeMetadataSearchQuery,
  type MetadataSearchCandidate,
  type MetadataSearchResult
} from '@shared/gameMetadataSearch'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { focusElement } from '@renderer/lib/spatialNavigation'

interface Props {
  gameId: string
  gameName: string
  onApply: (candidate: MetadataSearchCandidate) => void
  onClose: () => void
}

type LookupFailure = 'missing' | 'unavailable' | null

export function MetadataSearchDialog({ gameId, gameName, onApply, onClose }: Props): JSX.Element {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const lookupGenerationRef = useRef(0)
  const initialQuery = gameName.trim().slice(0, MAX_METADATA_SEARCH_QUERY_LENGTH)
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<MetadataSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [queryInvalid, setQueryInvalid] = useState(false)
  const [lookupAppId, setLookupAppId] = useState<number | null>(null)
  const [lookupFailure, setLookupFailure] = useState<LookupFailure>(null)

  const load = useCallback(
    (queryValue: string): void => {
      const normalized = normalizeMetadataSearchQuery(queryValue)
      if (!normalized) {
        setQueryInvalid(true)
        setResult(null)
        setLoading(false)
        return
      }
      const generation = ++generationRef.current
      lookupGenerationRef.current++
      setQuery(normalized)
      setQueryInvalid(false)
      setLookupAppId(null)
      setLookupFailure(null)
      setResult(null)
      setLoading(true)
      void window.api.library.metadata
        .searchStore(gameId, normalized)
        .then((nextResult) => {
          if (generationRef.current !== generation) return
          setResult(nextResult)
          setLoading(false)
        })
        .catch(() => {
          if (generationRef.current !== generation) return
          setResult({ state: 'unavailable', query: normalized, options: [] })
          setLoading(false)
        })
    },
    [gameId]
  )

  const choose = (appId: number): void => {
    if (lookupAppId !== null) return
    const generation = ++lookupGenerationRef.current
    setLookupAppId(appId)
    setLookupFailure(null)
    void window.api.library.metadata
      .lookupStore(gameId, appId)
      .then((lookup) => {
        if (lookupGenerationRef.current !== generation) return
        if (lookup.state === 'ready' && lookup.candidate) {
          onApply(lookup.candidate)
          return
        }
        setLookupAppId(null)
        setLookupFailure(lookup.state === 'missing' ? 'missing' : 'unavailable')
      })
      .catch(() => {
        if (lookupGenerationRef.current !== generation) return
        setLookupAppId(null)
        setLookupFailure('unavailable')
      })
  }

  useBackHandler(onClose)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => focusElement(inputRef.current, { ensureVisible: false }))
    load(initialQuery)
    return () => {
      generationRef.current++
      lookupGenerationRef.current++
      cancelAnimationFrame(frame)
      if (previousFocus?.isConnected) requestAnimationFrame(() => focusElement(previousFocus))
    }
  }, [initialQuery, load])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!loading) load(query)
  }

  const title = t('metadata.storeSearch.title')

  return createPortal(
    <AnimatePresence>
      <motion.div
        data-focus-scope="active"
        data-metadata-store-search="true"
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
          aria-busy={loading || lookupAppId !== null}
          className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-[clamp(1.25rem,2.5vw,2rem)] border border-white/10 bg-surface shadow-[0_38px_130px_rgba(0,0,0,0.82)]"
        >
          <header className="flex shrink-0 items-center gap-4 border-b border-white/[0.07] px-[clamp(1rem,2.5vw,1.75rem)] py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
              <Database size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold text-white">{title}</h2>
              <p className="mt-0.5 truncate text-xs text-white/40">
                {t('metadata.storeSearch.subtitle', { name: gameName })}
              </p>
            </div>
            <button
              data-focusable
              type="button"
              onClick={onClose}
              aria-label={t('metadata.storeSearch.close')}
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
                maxLength={MAX_METADATA_SEARCH_QUERY_LENGTH}
                aria-invalid={queryInvalid || undefined}
                aria-label={t('metadata.storeSearch.query')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (normalizeMetadataSearchQuery(event.target.value)) setQueryInvalid(false)
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
                {t('metadata.storeSearch.action')}
              </button>
            </form>
            {queryInvalid && (
              <p role="alert" className="text-xs font-medium text-amber-100">
                {t('metadata.storeSearch.queryInvalid')}
              </p>
            )}
            {lookupFailure && (
              <p role="alert" className="text-xs font-medium text-amber-100">
                {t(
                  lookupFailure === 'missing'
                    ? 'metadata.storeSearch.detailsMissing'
                    : 'metadata.storeSearch.detailsUnavailable'
                )}
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(1rem,2.5vw,1.75rem)] py-4">
            {loading ? (
              <div role="status" aria-live="polite" className="flex min-h-72 flex-col items-center justify-center gap-3 text-white/45">
                <Loader2 size={28} className="animate-spin text-accent" />
                <p className="text-sm">{t('metadata.storeSearch.loading')}</p>
              </div>
            ) : result?.state === 'ready' && result.options.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {result.options.map((option, index) => {
                  const pending = lookupAppId === option.appId
                  return (
                    <button
                      key={option.appId}
                      data-focusable
                      data-disabled={lookupAppId !== null ? 'true' : undefined}
                      type="button"
                      disabled={lookupAppId !== null && !pending}
                      aria-busy={pending || undefined}
                      onClick={() => choose(option.appId)}
                      aria-label={`${option.name}, ${t('metadata.storeSearch.use')}`}
                      className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-left transition-all hover:-translate-y-0.5 hover:border-white/25 disabled:opacity-45 data-[focused=true]:-translate-y-0.5 data-[focused=true]:border-accent data-[focused=true]:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.2)]"
                    >
                      <span className="relative block aspect-[231/87] overflow-hidden bg-black/40">
                        {option.imageUrl ? (
                          <img
                            src={option.imageUrl}
                            alt=""
                            loading={index < 6 ? 'eager' : 'lazy'}
                            referrerPolicy="no-referrer"
                            draggable={false}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025] group-data-[focused=true]:scale-[1.025]"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-white/25">
                            <Gamepad2 size={26} />
                          </span>
                        )}
                        {pending && (
                          <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/70 text-xs font-semibold text-white">
                            <Loader2 size={18} className="animate-spin text-accent" />
                            {t('metadata.storeSearch.applying')}
                          </span>
                        )}
                      </span>
                      <span className="flex min-h-16 items-start gap-3 px-3 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 block text-sm font-bold leading-snug text-white/88">{option.name}</span>
                          <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
                            Steam · {option.appId}
                          </span>
                        </span>
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/[0.12] text-accent opacity-60 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100">
                          <Check size={14} />
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : result ? (
              <div role="status" aria-live="polite" className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
                <Search size={28} className="text-white/25" />
                <p className="max-w-lg text-sm leading-relaxed text-white/48">
                  {result.state === 'missing'
                    ? t('metadata.storeSearch.missing')
                    : t('metadata.storeSearch.unavailable')}
                </p>
              </div>
            ) : null}
          </div>

          <footer className="shrink-0 border-t border-white/[0.06] px-5 py-2.5 text-center text-[11px] text-white/28">
            {t('metadata.storeSearch.footer')}
          </footer>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}
