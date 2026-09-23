import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { attractDwellMs, nextAttractIndex, shouldStartAttractMode } from '@shared/attractModePolicy'
import { useAttractModeStore } from '@renderer/state/attractModeStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useT } from '@renderer/i18n/useT'
import { projectSteamSharedVisibility } from '@shared/steamLibraryAccess'
import { notify } from '@renderer/state/notificationStore'

/** Mounted only while enabled. The underlying view and focus never unmount. */
export function AttractMode({ launchPhase }: { launchPhase: string }): JSX.Element | null {
  const t = useT()
  const reducedMotion = useReducedMotion() === true
  const active = useAttractModeStore((s) => s.active)
  const touch = useAttractModeStore((s) => s.touch)
  const minutes = usePreferencesStore((s) => s.attractModeIdleMinutes)
  const view = useNavigationStore((s) => s.mainView)
  const [artwork, setArtwork] = useState<Record<string, string>>({})
  const showShared = usePreferencesStore((s) => s.showSteamSharedGames)
  const snapshot = useLibraryStore((s) => s.snapshot)
  const games = useMemo(() => {
    const excluded = new Set(snapshot.excludedGames.map((game) => game.id))
    return projectSteamSharedVisibility(snapshot.games, showShared).filter((game) => !excluded.has(game.id) && artwork[game.id])
  }, [snapshot, artwork, showShared])
  useEffect(() => {
    let cancelled = false
    void window.api.attract.artwork().then((images) => {
      if (!cancelled) setArtwork(images)
    }).catch((error) => {
      console.warn('[attract] Cannot load cached artwork', error)
      if (!cancelled) notify({ tone: 'error', titleKey: 'attract.title', messageKey: 'attract.error', force: true })
    })
    return () => { cancelled = true }
  }, [snapshot])
  const [index, setIndex] = useState(0)
  const slideStarted = useRef(0)
  useBackHandler(touch, active)

  useEffect(() => {
    touch()
    let suppressUntil = 0
    const wakingKeys = new Set<string>()
    const input = (event: Event): void => {
      const wasActive = useAttractModeStore.getState().active
      if (wasActive) {
        suppressUntil = Date.now() + 500
        if (event instanceof KeyboardEvent) wakingKeys.add(event.code || event.key)
      }
      const heldWakeKey = event instanceof KeyboardEvent && wakingKeys.has(event.code || event.key)
      if (wasActive || heldWakeKey || Date.now() < suppressUntil) {
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (event instanceof KeyboardEvent && event.type === 'keyup') wakingKeys.delete(event.code || event.key)
      touch()
    }
    const reset = (): void => touch()
    const events = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'pointermove', 'wheel', 'touchstart']
    for (const event of events) window.addEventListener(event, input, { capture: true, passive: false })
    window.addEventListener('blur', reset)
    window.addEventListener('focus', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      for (const event of events) window.removeEventListener(event, input, true)
      window.removeEventListener('blur', reset)
      window.removeEventListener('focus', reset)
      document.removeEventListener('visibilitychange', reset)
      touch()
    }
  }, [touch])

  useEffect(() => {
    const check = (): void => {
      const state = useAttractModeStore.getState()
      const dialogOpen = !!useGameDetailStore.getState().gameId || !!document.querySelector(
        '[role="dialog"], [role="alertdialog"], [data-focus-scope="active"]'
      )
      const allowed = shouldStartAttractMode({
        enabled: true, view, launchPhase, dialogOpen,
        visible: document.visibilityState === 'visible', focused: document.hasFocus(),
        gameCount: games.length, idleMs: Date.now() - state.lastInputAt, idleMinutes: minutes
      })
      if (!allowed) {
        // Blocking surfaces reset the clock so closing a dialog cannot immediately start a slide.
        if (dialogOpen || launchPhase !== 'idle' || !['home', 'library'].includes(view) ||
            !document.hasFocus() || document.visibilityState !== 'visible') touch()
        else if (state.active) useAttractModeStore.setState({ active: false })
        return
      }
      if (!state.active || Date.now() - slideStarted.current >= attractDwellMs(reducedMotion)) {
        setIndex((current) => nextAttractIndex(games.length, state.active ? current : -1))
        slideStarted.current = Date.now()
        useAttractModeStore.setState({ active: true })
      }
    }
    check()
    const timer = window.setInterval(check, 500)
    return () => window.clearInterval(timer)
  }, [view, launchPhase, games, minutes, reducedMotion, touch])

  const game = games[index]
  if (!active || !game) return null
  return (
    <div data-attract-mode className="fixed inset-0 z-[120] overflow-hidden bg-black" aria-label={t('attract.title')}>
      <AnimatePresence initial={false}>
        <motion.div key={game.id} className="absolute inset-0"
          initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 1.2 }}>
          <img src={artwork[game.id]} alt="" className="h-full w-full object-cover" onError={() => {
            console.warn('[attract] Cached artwork unavailable', game.id)
            setArtwork((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== game.id)))
            touch()
            notify({ tone: 'error', titleKey: 'attract.title', messageKey: 'attract.error', force: true })
          }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
          <h1 className="absolute bottom-[14vh] left-[6vw] right-[6vw] text-[clamp(2rem,5vw,5rem)] font-black leading-tight text-white">{game.name}</h1>
        </motion.div>
      </AnimatePresence>
      <p className="absolute bottom-[6vh] left-[6vw] text-sm text-white/65">{t('attract.exit')}</p>
    </div>
  )
}
