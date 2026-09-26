import { LaunchProfileListener } from '@renderer/components/LaunchProfileConfirmation'
import { LosslessScalingListener } from '@renderer/components/LosslessScalingListener'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useGamepadNavigation } from '@renderer/hooks/useGamepadNavigation'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useAuthStore } from '@renderer/state/authStore'
import { useEpicAuthStore } from '@renderer/state/epicAuthStore'
import { usePlayStationStore } from '@renderer/state/playstationStore'
import { useXboxAuthStore } from '@renderer/state/xboxAuthStore'
import { useNavigationStore } from '@renderer/state/navigationStore'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useStoreStore } from '@renderer/state/storeStore'
import { useSyncStore } from '@renderer/state/syncStore'
import { useAppUpdateStore } from '@renderer/state/appUpdateStore'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import { installPointerUiSounds } from '@renderer/lib/uiAudio'
import { NotificationCenter } from '@renderer/components/NotificationCenter'
import { StartupAnimation } from '@renderer/components/StartupAnimation'
import {
  markCustomStartupVideoFailed,
  readCachedStartupAnimationMode,
  readCachedStartupVideoUrl
} from '@renderer/lib/startupAnimationPreference'
import type { StartupAnimationMode } from '@shared/ipc'

let onboardingFlowModulePromise:
  | Promise<typeof import('@renderer/views/Onboarding/OnboardingFlow')>
  | undefined
let mainShellModulePromise: Promise<typeof import('@renderer/components/MainShell')> | undefined

function loadOnboardingFlowModule(): Promise<
  typeof import('@renderer/views/Onboarding/OnboardingFlow')
> {
  onboardingFlowModulePromise ??= import('@renderer/views/Onboarding/OnboardingFlow')
  return onboardingFlowModulePromise
}

function loadMainShellModule(): Promise<typeof import('@renderer/components/MainShell')> {
  mainShellModulePromise ??= import('@renderer/components/MainShell')
  return mainShellModulePromise
}

const OnboardingFlow = lazy(() =>
  loadOnboardingFlowModule().then((module) => ({
    default: module.OnboardingFlow
  }))
)
const MainShell = lazy(() =>
  loadMainShellModule().then((module) => ({ default: module.MainShell }))
)
const GamepadKeyboard = lazy(() =>
  import('@renderer/components/GamepadKeyboard').then((module) => ({
    default: module.GamepadKeyboard
  }))
)
const MediaKeyboardOverlay = lazy(() =>
  import('@renderer/components/MediaKeyboardOverlay').then((module) => ({
    default: module.MediaKeyboardOverlay
  }))
)

const STARTUP_TOTAL_MS = 1_500
const STARTUP_EXIT_MS = 180
const STARTUP_MIN_VISIBLE_MS = STARTUP_TOTAL_MS - STARTUP_EXIT_MS
const STARTUP_REDUCED_MOTION_MS = 100
const CUSTOM_STARTUP_MAX_MS = 15_000
const ACCOUNT_RESTORE_STARTUP_BUDGET_MS = 250

type StartupPhase = 'playing' | 'leaving' | 'hidden'

function initialStartupMode(): StartupAnimationMode {
  const mode = readCachedStartupAnimationMode()
  return mode === 'custom' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'orbit'
    : mode
}

function OrbitApp(): JSX.Element | null {
  const launchProfilesEnabled = usePreferencesStore((s) => s.launchProfilesEnabled)
  const losslessScalingEnabled = usePreferencesStore((s) => s.losslessScalingEnabled)
  const cachedStartupMode = useRef(initialStartupMode())
  const [ready, setReady] = useState(false)
  const [startupMode, setStartupMode] = useState<StartupAnimationMode>(
    cachedStartupMode.current
  )
  const [startupPhase, setStartupPhase] = useState<StartupPhase>(
    cachedStartupMode.current === 'off' ? 'hidden' : 'playing'
  )
  const [customStartupComplete, setCustomStartupComplete] = useState(false)
  const startupStartedAt = useRef(performance.now())
  const customStartupVideoUrl = useRef(readCachedStartupVideoUrl())
  const appContentRef = useRef<HTMLDivElement>(null)
  const hydratePreferences = usePreferencesStore((s) => s.hydrate)
  const restoreAuth = useAuthStore((s) => s.restore)
  const restoreEpicAuth = useEpicAuthStore((s) => s.restore)
  const restorePlayStation = usePlayStationStore((s) => s.restore)
  const restoreXboxAuth = useXboxAuthStore((s) => s.restore)
  const hydrateLibraryCollections = useLibraryCollectionsStore((s) => s.hydrate)
  const initAppUpdates = useAppUpdateStore((s) => s.init)
  const initOrbitPlus = useOrbitPlusStore((s) => s.init)
  const phase = useNavigationStore((s) => s.phase)
  const setPhase = useNavigationStore((s) => s.setPhase)

  useGamepadNavigation()

  useEffect(() => installPointerUiSounds(), [])

  useEffect(
    () => () => {
      useOrbitPlusStore.getState().dispose()
    },
    []
  )

  useEffect(() => {
    const syncAppearance = (): void => {
      usePreferencesStore.getState().syncOrbitPlusAppearance()
    }
    syncAppearance()
    return useOrbitPlusStore.subscribe((state, previousState) => {
      if (state.snapshot !== previousState.snapshot) syncAppearance()
    })
  }, [])

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      const accountRestores = Promise.allSettled([
        restoreAuth(),
        restoreEpicAuth(),
        restorePlayStation(),
        restoreXboxAuth()
      ])
      const [settings] = await Promise.all([
        hydratePreferences(),
        hydrateLibraryCollections(),
        initAppUpdates(),
        initOrbitPlus()
      ])
      const accountRestoreState = await Promise.race([
        accountRestores.then(() => 'ready' as const),
        new Promise<'deferred'>((resolve) =>
          window.setTimeout(() => resolve('deferred'), ACCOUNT_RESTORE_STARTUP_BUDGET_MS)
        )
      ])

      if (settings.hasCompletedOnboarding) {
        // Prepare the real first frame while the startup layer still owns the screen.
        // These IPC reads hydrate local snapshots only; provider reconciliation and
        // artwork continue asynchronously after the shell has become interactive.
        const localSnapshotsReady = Promise.allSettled([
          useLibraryStore.getState().init(),
          useStoreStore.getState().init(),
          useSyncStore.getState().init()
        ])
        await Promise.all([loadMainShellModule(), localSnapshotsReady])
      } else {
        await loadOnboardingFlowModule()
      }

      setPhase(settings.hasCompletedOnboarding ? 'main' : 'onboarding')
      setReady(true)
      if (accountRestoreState === 'deferred' && settings.hasCompletedOnboarding) {
        // Slow/offline provider validation must not hold the first frame hostage.
        // Reconcile once more when it finishes so no provider functionality is lost.
        void accountRestores.then(() => useLibraryStore.getState().scheduleRefresh())
      }
    }
    void bootstrap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || startupMode === 'off') return
    if (startupMode === 'custom' && !customStartupComplete) return

    const minimumVisibleMs =
      startupMode === 'custom'
        ? 0
        : window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? STARTUP_REDUCED_MOTION_MS
          : STARTUP_MIN_VISIBLE_MS
    const elapsedMs = performance.now() - startupStartedAt.current
    const timer = window.setTimeout(
      () => setStartupPhase('leaving'),
      Math.max(0, minimumVisibleMs - elapsedMs)
    )

    return () => window.clearTimeout(timer)
  }, [customStartupComplete, ready, startupMode])

  useEffect(() => {
    if (startupMode !== 'custom' || startupPhase !== 'playing') return
    const timer = window.setTimeout(() => setCustomStartupComplete(true), CUSTOM_STARTUP_MAX_MS)
    return () => window.clearTimeout(timer)
  }, [startupMode, startupPhase])

  useEffect(() => {
    if (startupPhase !== 'leaving') return
    const timer = window.setTimeout(() => setStartupPhase('hidden'), STARTUP_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [startupPhase])

  function fallbackToOrbitStartup(): void {
    startupStartedAt.current = performance.now()
    markCustomStartupVideoFailed()
    void window.api.settings.set({ startupAnimationMode: 'orbit' }).catch(() => undefined)
    setCustomStartupComplete(false)
    setStartupMode('orbit')
  }

  useEffect(() => {
    const content = appContentRef.current
    if (!content) return
    content.toggleAttribute('inert', startupPhase !== 'hidden')
    return () => content.removeAttribute('inert')
  }, [startupPhase])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-base">
      {ready && launchProfilesEnabled && <LaunchProfileListener />}
      {ready && losslessScalingEnabled && <LosslessScalingListener />}
      <div
        ref={appContentRef}
        data-orbit-app-content
        className="orbit-app-content h-full w-full"
        aria-hidden={!ready || startupPhase !== 'hidden'}
      >
        {ready && (
          <Suspense fallback={<AppLoadingFallback />}>
            {phase === 'onboarding' ? <OnboardingFlow /> : <MainShell />}
          </Suspense>
        )}
        {ready && <NotificationCenter />}
      </div>

      {startupPhase !== 'hidden' && startupMode !== 'off' && (
        <StartupAnimation
          phase={startupPhase}
          mode={startupMode}
          customVideoUrl={customStartupVideoUrl.current}
          onCustomVideoEnded={() => setCustomStartupComplete(true)}
          onCustomVideoError={fallbackToOrbitStartup}
        />
      )}
      <Suspense fallback={null}>
        <GamepadKeyboard />
      </Suspense>
    </div>
  )
}

function App(): JSX.Element | null {
  const mode = new URLSearchParams(window.location.search).get('orbitMode')
  return mode === 'media-keyboard' ? (
    <Suspense fallback={null}>
      <MediaKeyboardOverlay />
    </Suspense>
  ) : (
    <OrbitApp />
  )
}

function AppLoadingFallback(): JSX.Element {
  return (
    <div
      role="status"
      aria-label="MT3K Launcher"
      className="flex h-full w-full items-center justify-center bg-base"
    >
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/15 border-t-accent" />
    </div>
  )
}

export default App
