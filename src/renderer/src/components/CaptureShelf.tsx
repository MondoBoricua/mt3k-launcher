import { useEffect, useMemo, useState } from 'react'
import { Film, ImageOff } from 'lucide-react'
import { matchCaptureGame, type CaptureItem } from '@shared/capturePolicy'
import { languageLocale } from '@shared/language'
import { useCapturesStore } from '@renderer/state/capturesStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useT } from '@renderer/i18n/useT'
import { FocusableButton } from './FocusableButton'

export function CaptureTile({ item }: { item: CaptureItem }): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((s) => s.language)
  const open = useCapturesStore((s) => s.open)
  const [failed, setFailed] = useState(false)
  const date = new Date(item.capturedAt).toLocaleString(languageLocale(language))
  return (
    <FocusableButton variant="ghost" onClick={() => void open(item.path)}
      aria-label={t('captures.openItem', { title: item.gameTitleGuess, date })}
      className="min-w-0 !rounded-2xl !p-0 overflow-hidden text-left data-[focused=true]:ring-2 data-[focused=true]:ring-accent">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black/50">
        {item.kind === 'image' && item.thumbnailUrl && !failed
          ? <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => {
              console.warn('[captures] Thumbnail failed', item.thumbnailUrl)
              setFailed(true)
            }} />
          : item.kind === 'video' ? <Film size={36} className="text-accent" /> : <ImageOff size={36} className="text-muted" />}
        <span className="absolute bottom-2 right-2 rounded-full bg-black/80 px-2 py-1 text-xs text-white">
          {t(failed ? 'captures.previewError' : item.kind === 'video' ? 'captures.video' : 'captures.image')}
        </span>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-bold text-white">{item.gameTitleGuess}</p>
        <p className="mt-1 text-xs text-white/60">{date}</p>
        <p className="mt-1 text-xs text-accent">{t('captures.open')}</p>
      </div>
    </FocusableButton>
  )
}

export function CaptureFeedback(): JSX.Element | null {
  const t = useT()
  const error = useCapturesStore((s) => s.error)
  return error ? <p role="alert" className="my-3 text-sm text-amber-200">{t('captures.error')}</p> : null
}

export function CaptureShelf({ gameId }: { gameId: string }): JSX.Element {
  const t = useT()
  const items = useCapturesStore((s) => s.items)
  const loading = useCapturesStore((s) => s.loading)
  const refresh = useCapturesStore((s) => s.refresh)
  const openFolder = useCapturesStore((s) => s.openFolder)
  const snapshot = useLibraryStore((s) => s.snapshot)
  const games = useMemo(() => [...snapshot.games, ...snapshot.excludedGames], [snapshot])
  const captures = useMemo(() => items.filter((item) => matchCaptureGame(item.gameTitleGuess, games)?.id === gameId), [items, games, gameId])
  useEffect(() => { void refresh() }, [refresh, gameId])
  return (
    <section data-capture-shelf className="my-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">{t('captures.title')}</h2>
        <FocusableButton variant="ghost" onClick={() => void openFolder()}>{t('captures.openFolder')}</FocusableButton>
      </div>
      <CaptureFeedback />
      {loading && <p role="status" className="my-3 text-sm text-muted">{t('captures.loading')}</p>}
      {!loading && captures.length === 0 && <p className="my-3 text-sm text-muted">{t('captures.empty')}</p>}
      <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
        {captures.map((item) => <CaptureTile key={item.path} item={item} />)}
      </div>
    </section>
  )
}
