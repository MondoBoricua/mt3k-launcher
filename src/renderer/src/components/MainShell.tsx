import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TopBar } from './TopBar'
import { HomeView } from '@renderer/views/Home/HomeView'
import {
  useNavigationStore,
  type MainView
} from '@renderer/state/navigationStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useSyncStore } from '@renderer/state/syncStore'
import { GameDetailPanel } from './GameDetailPanel'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { useStoreStore } from '@renderer/state/storeStore'
import { GameLaunchSplash } from './GameLaunchSplash'
import { SessionSummaryToast } from './SessionSummaryToast'
import { AppUpdateBanner } from './AppUpdateBanner'
import { AppUpdatePrompt } from './AppUpdatePrompt'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { BottomStatusHud } from './BottomStatusHud'
import type { GameLaunchStatus } from '@shared/ipc'
import { DiscordChatController } from './DiscordChatController'
import { mainViewLoaders } from '@renderer/lib/mainViewLoaders'
import { setOrbitPerformanceMode } from '@renderer/lib/performanceMode'
import { useGeForceNowStore } from '@renderer/state/geForceNowStore'
import { RunningGameProvider } from '@renderer/state/runningGameContext'
import { GameTitleMusic } from './GameTitleMusic'
import { LauncherBackgroundMusic } from './LauncherBackgroundMusic'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useTitleMusicStore } from '@renderer/state/titleMusicStore'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import { orbitPlusHasFeature } from '@shared/ipc'
import { useDownloadStore } from '@renderer/state/downloadStore'
import { DownloadCenterPanel } from './DownloadCenterPanel'
import { PinPadDialog } from './PinPadDialog'
import { useGuestModeStore } from '@renderer/state/guestModeStore'

const SESSION_SUMMARY_VISIBLE_MS = 6_000
const RENDERER_HIBERNATION_DELAY_MS = 1_500

const ApplicationsView = lazy(() =>
  mainViewLoaders.applications().then((module) => ({ default: module.ApplicationsView }))
)
const FriendsView = lazy(() =>
  mainViewLoaders.friends().then((module) => ({ default: module.FriendsView }))
)
const LibraryView = lazy(() =>
  mainViewLoaders.library().then((module) => ({ default: module.LibraryView }))
)
const StoreView = lazy(() =>
  mainViewLoaders.store().then((module) => ({ default: module.StoreView }))
)
const SettingsView = lazy(() =>
  mainViewLoaders.settings().then((module) => ({ default: module.SettingsView }))
)

export function MainShell(): JSX.Element {
  const mainView = useNavigationStore((s) => s.mainView)
  const mainViewDirection = useNavigationStore((s) => s.mainViewDirection)
  const setMainView = useNavigationStore((s) => s.setMainView)
  const initLibrary = useLibraryStore((s) => s.init)
  const scheduleLibraryRefresh = useLibraryStore((s) => s.scheduleRefresh)
  const initGeForceNow = useGeForceNowStore((s) => s.init)
  const initSync = useSyncStore((s) => s.init)
  const initStore = useStoreStore((s) => s.init)
  const initDownloads = useDownloadStore((state) => state.init)
  const downloadCenterOpen = useDownloadStore((state) => state.centerOpen)
  const initGuestMode = useGuestModeStore((state) => state.init)
  const pinRequest = useGuestModeStore((state) => state.pinRequest)
  const guestLockedUntil = useGuestModeStore((state) => state.status.lockedUntil)
  const resolvePinRequest = useGuestModeStore((state) => state.resolvePinRequest)
  const refreshStoreIfStale = useStoreStore((s) => s.refreshIfStale)
  const detailGameId = useGameDetailStore((s) => s.gameId)
  const launcherMusicEnabled = usePreferencesStore((state) => state.launcherMusic)
  const launcherMusicVolume = usePreferencesStore((state) => state.launcherMusicVolume)
  const configuredLauncherMusicSource = usePreferencesStore(
    (state) => state.launcherMusicSource
  )
  const customLauncherMusic = usePreferencesStore((state) => state.customLauncherMusic)
  const gameTitleMusicEnabled = usePreferencesStore((state) => state.gameTitleMusic)
  const gameTitleMusicVolume = usePreferencesStore((state) => state.gameTitleMusicVolume)
  const gameTitleMusicDelaySeconds = usePreferencesStore(
    (state) => state.gameTitleMusicDelaySeconds
  )
  const gameTitleMusicFadeSeconds = usePreferencesStore(
    (state) => state.gameTitleMusicFadeSeconds
  )
  const homeTitleMusicGameId = useTitleMusicStore((state) => state.homeGameId)
  const fullScreenTrailerGameId = useTitleMusicStore(
    (state) => state.fullScreenTrailerGameId
  )
  const playingTitleMusicGameId = useTitleMusicStore((state) => state.playingGameId)
  const orbitPlusSnapshot = useOrbitPlusStore((state) => state.snapshot)
  const [launchStatus, setLaunchStatus] = useState<GameLaunchStatus>({ phase: 'idle' })
  const [sessionSummary, setSessionSummary] = useState<GameLaunchStatus | null>(null)
  const [visualsHibernated, setVisualsHibernated] = useState(false)
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus())
  const updateStage = useAppUpdateStore((state) => state.snapshot.stage)
  const updateBannerVisible = useAppUpdateStore((state) => state.bannerVisible)
  const updatePromptVisible = useAppUpdateStore((state) => state.promptVisible)
  const pendingSessionSummaryRef = useRef<GameLaunchStatus | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const runningGameId = launchStatus.phase === 'running' ? launchStatus.gameId : undefined
  const titleMusicGameId =
    detailGameId ?? (mainView === 'home' ? homeTitleMusicGameId : null)
  const titleMusicActive =
    gameTitleMusicEnabled &&
    Boolean(titleMusicGameId) &&
    launchStatus.phase === 'idle' &&
    windowFocused
  const titleMusicSuspended = fullScreenTrailerGameId === titleMusicGameId
  const customLauncherMusicUnlocked = orbitPlusHasFeature(
    orbitPlusSnapshot,
    'manual-audio'
  )
  const launcherMusicSource =
    configuredLauncherMusicSource === 'custom' && customLauncherMusicUnlocked
      ? 'custom'
      : 'orbit'
  const launcherMusicActive =
    launcherMusicEnabled && launchStatus.phase === 'idle' && windowFocused
  const musicImmediateStop = !windowFocused || launchStatus.phase !== 'idle'
  const launcherMusicSuspended =
    Boolean(playingTitleMusicGameId) || Boolean(fullScreenTrailerGameId)
  const launchOverlayVisible =
    launchStatus.phase !== 'idle' && launchStatus.phase !== 'running'
  const detailGame = useLibraryStore((state) => {
    if (!detailGameId) return undefined
    return (
      state.snapshot.games.find((game) => game.id === detailGameId) ??
      state.snapshot.providerGames.find((game) => game.id === detailGameId)
    )
  })
  const titleMusicSelectionKey = useLibraryStore((state) => {
    if (!titleMusicGameId) return undefined
    const game = (
      state.snapshot.games.find((game) => game.id === titleMusicGameId) ??
      state.snapshot.providerGames.find((game) => game.id === titleMusicGameId)
    )
    return game ? `${game.name}\0${game.metadata.titleMusicUrl ?? ''}` : undefined
  })

  useEffect(() => {
    void initSync()
    void initStore()
    void initDownloads()
  }, [initDownloads, initStore, initSync])

  useEffect(() => {
    const handleFocus = (): void => setWindowFocused(true)
    const handleBlur = (): void => setWindowFocused(false)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useEffect(() => {
    let active = true
    const receiveLaunchStatus = (status: GameLaunchStatus): void => {
      if (!active) return
      setLaunchStatus(status)
      if (status.phase === 'returning' && (status.sessionDurationSeconds ?? 0) > 0) {
        pendingSessionSummaryRef.current = status
      }
      if (status.phase === 'idle' && pendingSessionSummaryRef.current) {
        setSessionSummary(pendingSessionSummaryRef.current)
        pendingSessionSummaryRef.current = null
      }
    }
    const unsubscribe = window.api.game.onLaunchStatus(receiveLaunchStatus)
    void window.api.game.getLaunchStatus().then(receiveLaunchStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const syncPerformanceMode = (): void => {
      setOrbitPerformanceMode(
        Boolean(runningGameId) && (document.hidden || !document.hasFocus())
      )
    }
    syncPerformanceMode()
    document.addEventListener('visibilitychange', syncPerformanceMode)
    window.addEventListener('focus', syncPerformanceMode)
    window.addEventListener('blur', syncPerformanceMode)
    return () => {
      document.removeEventListener('visibilitychange', syncPerformanceMode)
      window.removeEventListener('focus', syncPerformanceMode)
      window.removeEventListener('blur', syncPerformanceMode)
      setOrbitPerformanceMode(false)
    }
  }, [runningGameId])

  useEffect(() => {
    let hibernationTimer: number | undefined
    const cancelHibernation = (): void => {
      if (hibernationTimer !== undefined) window.clearTimeout(hibernationTimer)
      hibernationTimer = undefined
    }
    const wakeVisuals = (): void => {
      cancelHibernation()
      setVisualsHibernated(false)
    }
    const syncVisibility = (): void => {
      cancelHibernation()
      if (!runningGameId || !document.hidden) {
        setVisualsHibernated(false)
        return
      }
      // Once a confirmed game owns the screen, release every hidden card,
      // backdrop and compositing layer. Renderer stores remain alive, so the
      // exact launcher state can be reconstructed immediately on return.
      hibernationTimer = window.setTimeout(
        () => setVisualsHibernated(true),
        RENDERER_HIBERNATION_DELAY_MS
      )
    }

    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('focus', wakeVisuals)
    syncVisibility()
    return () => {
      cancelHibernation()
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('focus', wakeVisuals)
    }
  }, [runningGameId])

  useEffect(() => {
    if (!sessionSummary) return
    const timer = window.setTimeout(() => setSessionSummary(null), SESSION_SUMMARY_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [sessionSummary])

  useEffect(() => {
    void initGuestMode()
  }, [initGuestMode])

  useEffect(() => {
    let active = true
    void initLibrary().then(() => {
      if (!active) return
      scheduleLibraryRefresh()
      return initGeForceNow()
    })
    return () => {
      active = false
      useGeForceNowStore.getState().dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mainView === 'store') void refreshStoreIfStale()
  }, [mainView, refreshStoreIfStale])

  useBackHandler(() => {
    if (mainView !== 'home') setMainView('home')
  })

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    if (
      detailGame ||
      downloadCenterOpen ||
      launchOverlayVisible ||
      pinRequest !== null ||
      updateStage === 'installing'
    ) {
      shell.setAttribute('inert', '')
    }
    else shell.removeAttribute('inert')
    return () => shell.removeAttribute('inert')
  }, [detailGame, downloadCenterOpen, launchOverlayVisible, pinRequest, updateStage])

  useEffect(() => {
    let observer: MutationObserver | undefined
    const focusActivePane = (): boolean => {
      const activePane = shellRef.current?.querySelector<HTMLElement>(
        `[data-view-pane="${mainView}"]`
      )
      const preferredEntry = activePane?.querySelector<HTMLElement>('[data-view-entry="true"]')
      const target =
        preferredEntry ??
        activePane?.querySelector<HTMLElement>('[data-focusable]:not([data-disabled="true"])')
      if (!target) return false
      focusElement(target)
      return true
    }
    const frame = requestAnimationFrame(() => {
      if (focusActivePane()) return
      const activePane = shellRef.current?.querySelector<HTMLElement>(
        `[data-view-pane="${mainView}"]`
      )
      if (!activePane) return
      observer = new MutationObserver(() => {
        if (focusActivePane()) observer?.disconnect()
      })
      observer.observe(activePane, { childList: true, subtree: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [mainView])

  function renderView(view: MainView): JSX.Element {
    if (view === 'home') return <HomeView />
    if (view === 'applications') return <ApplicationsView />
    if (view === 'friends') return <FriendsView />
    if (view === 'library') return <LibraryView />
    if (view === 'store') return <StoreView />
    return <SettingsView />
  }

  if (visualsHibernated) {
    return (
      <div
        data-orbit-renderer-hibernated="true"
        aria-hidden="true"
        className="h-full w-full bg-black"
      />
    )
  }

  return (
    <RunningGameProvider gameId={runningGameId} source={launchStatus.trackingMethod === 'geforce-now-window' ? 'geforce-now' : 'local'}>
      <div className="relative h-full w-full overflow-hidden">
        <LauncherBackgroundMusic
          active={launcherMusicActive}
          suspended={launcherMusicSuspended}
          immediateStop={musicImmediateStop}
          source={launcherMusicSource}
          customUrl={launcherMusicSource === 'custom' ? customLauncherMusic?.url : undefined}
          volume={launcherMusicVolume}
        />
        <GameTitleMusic
          gameId={titleMusicGameId}
          selectionKey={titleMusicSelectionKey}
          active={titleMusicActive}
          suspended={titleMusicSuspended}
          immediateStop={musicImmediateStop}
          volume={gameTitleMusicVolume}
          delaySeconds={gameTitleMusicDelaySeconds}
          fadeSeconds={gameTitleMusicFadeSeconds}
        />
        <DiscordChatController />
        <div ref={shellRef} className="flex h-full w-full flex-col overflow-hidden">
          <TopBar />
          <main className="relative flex-1 overflow-hidden">
            <PersistentViewPane
              key={mainView}
              view={mainView}
              active
              direction={mainViewDirection}
            >
              <Suspense fallback={<ViewLoadingFallback />}>
                {renderView(mainView)}
              </Suspense>
            </PersistentViewPane>
          </main>
          <BottomStatusHud />
        </div>

        <AnimatePresence>{detailGame && <GameDetailPanel key={detailGame.id} game={detailGame} />}</AnimatePresence>
        <AnimatePresence>
          {downloadCenterOpen && <DownloadCenterPanel key="download-center" />}
        </AnimatePresence>
        <AnimatePresence>
          {pinRequest && (
            <PinPadDialog
              key={`pin-request-${pinRequest.id}`}
              titleKey={pinRequest.titleKey}
              bodyKey={pinRequest.bodyKey}
              mode={pinRequest.mode}
              lockedUntil={guestLockedUntil}
              onSubmit={pinRequest.submit}
              onCancel={() => resolvePinRequest(pinRequest.id, false)}
              onSuccess={() => resolvePinRequest(pinRequest.id, true)}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {launchOverlayVisible && (
            <GameLaunchSplash
              key={launchStatus.gameId ?? 'game-launch'}
              status={launchStatus}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {sessionSummary && (
            <SessionSummaryToast
              key={`${sessionSummary.gameId}:${sessionSummary.endedAt}`}
              status={sessionSummary}
              visibleSeconds={SESSION_SUMMARY_VISIBLE_MS / 1_000}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {updateBannerVisible &&
            (updateStage === 'installing' ||
              (updateStage === 'ready' && launchStatus.phase === 'idle')) && (
              <AppUpdateBanner key="app-update" />
            )}
          {updatePromptVisible && launchStatus.phase === 'idle' && updateStage !== 'installing' && (
            <AppUpdatePrompt key="app-update-prompt" />
          )}
        </AnimatePresence>
      </div>
    </RunningGameProvider>
  )
}

function ViewLoadingFallback(): JSX.Element {
  return (
    <div role="status" aria-label="MT3K Launcher" className="flex h-full items-center justify-center">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-accent" />
    </div>
  )
}

function PersistentViewPane({
  view,
  active,
  direction,
  children
}: {
  view: MainView
  active: boolean
  direction: 1 | -1
  children: ReactNode
}): JSX.Element {
  const paneRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    paneRef.current?.toggleAttribute('inert', !active)
  }, [active])

  return (
    <motion.div
      ref={paneRef}
      data-view-pane={view}
      aria-hidden={!active}
      initial={{ opacity: 0, x: direction * 22, scale: 0.994 }}
      animate={
        active
          ? { opacity: 1, x: 0, scale: 1 }
          : { opacity: 0, x: direction * -14, scale: 0.996 }
      }
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 h-full"
      style={{
        pointerEvents: active ? 'auto' : 'none',
        zIndex: active ? 1 : 0
      }}
    >
      {children}
    </motion.div>
  )
}
