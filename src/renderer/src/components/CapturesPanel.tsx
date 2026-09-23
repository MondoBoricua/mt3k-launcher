import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { matchCaptureGame, type CaptureItem } from '@shared/capturePolicy'
import { useCapturesStore } from '@renderer/state/capturesStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useFocusScope } from '@renderer/hooks/useFocusScope'
import { useT } from '@renderer/i18n/useT'
import { CaptureFeedback, CaptureTile } from './CaptureShelf'
import { FocusableButton } from './FocusableButton'
import { isGuestModeActive, useGuestModeStore } from '@renderer/state/guestModeStore'

export function CapturesPanel(): JSX.Element {
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const { items, loading, refresh, closePanel, openFolder } = useCapturesStore()
  const snapshot = useLibraryStore((s) => s.snapshot)
  const readOnly = useGuestModeStore(isGuestModeActive)
  useBackHandler(closePanel)
  useFocusScope({ scopeRef: root, resolveFocusTarget: () => closeButton.current })
  useEffect(() => { void refresh() }, [refresh])
  const groups = useMemo(() => {
    const result = new Map<string, { title: string; items: CaptureItem[] }>()
    for (const item of items) {
      const game = matchCaptureGame(item.gameTitleGuess, [...snapshot.games, ...snapshot.excludedGames])
      if (game && snapshot.excludedGames.some((hidden) => hidden.id === game.id)) continue
      const key = game?.id ?? 'other'
      const group = result.get(key) ?? { title: game?.name ?? t('captures.other'), items: [] }
      result.set(key, { ...group, items: [...group.items, item] })
    }
    return [...result.entries()]
  }, [items, snapshot, t])
  return createPortal(
    <div ref={root} data-focus-scope="active" data-captures-panel role="dialog" aria-modal="true"
      aria-label={t('captures.title')} className="fixed inset-0 z-[100] flex flex-col bg-surface p-[clamp(1rem,3vw,3rem)] text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-5">
        <div className="min-w-0 flex-1"><h1 className="text-3xl font-black">{t('captures.title')}</h1>
          <p className="mt-2 text-sm text-muted">{t('captures.body')}</p></div>
        <FocusableButton variant="ghost" disabled={loading} onClick={() => void refresh()}>{t('captures.refresh')}</FocusableButton>
        {!readOnly && <FocusableButton variant="ghost" onClick={() => void openFolder()}>{t('captures.openFolder')}</FocusableButton>}
        <FocusableButton ref={closeButton} onClick={closePanel}>{t('captures.close')}</FocusableButton>
      </header>
      <CaptureFeedback />
      <div className="min-h-0 flex-1 overflow-y-auto py-5">
        {loading && <p role="status">{t('captures.loading')}</p>}
        {!loading && groups.length === 0 && <p className="text-muted">{t('captures.empty')}</p>}
        {groups.map(([key, group]) => <section key={key} className="mb-8">
          <h2 className="mb-4 text-xl font-bold">{group.title}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {group.items.map((item) => <CaptureTile key={item.path} item={item} />)}
          </div>
        </section>)}
      </div>
    </div>, document.body
  )
}
