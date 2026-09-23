import { CaptureShelf } from './CaptureShelf'
import { useCapturesStore } from '@renderer/state/capturesStore'
import { type Language, languageLocale } from '@shared/language'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  CalendarDays,
  Archive,
  ArchiveRestore,
  ChevronUp,
  CircleAlert,
  CloudLightning,
  Database,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  HardDriveDownload,
  LibraryBig,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Timer,
  Trophy,
  Trash2,
  X
} from 'lucide-react'
import type {
  GameAchievement,
  GameAchievementsSnapshot,
  GameCompletionTimes,
  LauncherDownloadPhase,
  LibraryGame
} from '@shared/ipc'
import { retroLaunchArguments } from '@shared/retroSystems'
import { GameImage } from './GameImage'
import type { GameTrailer } from '@shared/gameTrailer'
import { GameTrailerBackground, GameTrailerDialog } from './GameTrailerPlayer'
import { GameMetadataEditor } from './GameMetadataEditor'
import { formatWindowsArguments, LaunchOptionsDialog } from './LaunchOptionsDialog'
import { LibraryCollectionDialog } from './LibraryCollectionDialog'
import { SaveRestoreBackupDialog } from './SaveRestoreBackupDialog'
import {
  GameDetailActionMenu,
  type GameDetailActionMenuItem
} from './GameDetailActionMenu'
import { useBackHandler } from '@renderer/hooks/useBackHandler'
import { useLaunchGame } from '@renderer/hooks/useLaunchGame'
import { useT } from '@renderer/i18n/useT'
import type { TranslationKey } from '@renderer/i18n/translations'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { focusElement } from '@renderer/lib/spatialNavigation'
import { formatPlaytime } from '@renderer/lib/playtime'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { useLibraryCollectionsStore } from '@renderer/state/libraryCollectionsStore'
import { notify } from '@renderer/state/notificationStore'
import { useGeForceNowStore } from '@renderer/state/geForceNowStore'
import { useTitleMusicStore } from '@renderer/state/titleMusicStore'
import { useDownloadStore } from '@renderer/state/downloadStore'
import { useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import { canRequestGameInstall, canRequestGameUninstall } from '@shared/gameInstallation'
import { isActionAllowed, type GuestModeAction } from '@shared/guestModePolicy'
import { isGuestModeActive, useGuestModeStore } from '@renderer/state/guestModeStore'
import { clampLauncherProgress } from '@shared/launcherDownloads'
import {
  AchievementOverviewSheet,
  type AchievementGuideUiState
} from './AchievementDetailSheet'

interface Props {
  game: LibraryGame
}

const DOWNLOAD_PHASE_KEYS: Record<LauncherDownloadPhase, TranslationKey> = {
  downloading: 'downloads.phase.downloading',
  updating: 'downloads.phase.updating',
  installing: 'downloads.phase.installing',
  verifying: 'downloads.phase.verifying',
  paused: 'downloads.phase.paused',
  completed: 'downloads.phase.completed',
  error: 'downloads.phase.error'
}

type AchievementGuidePlayer = {
  achievementId: string
  trailer: GameTrailer
}

function formatHours(minutes: number | undefined, language: Language): string {
  if (!minutes) return '—'
  const hours = minutes / 60
  const value = new Intl.NumberFormat(languageLocale(language), {
    maximumFractionDigits: hours < 10 ? 1 : 0
  }).format(hours)
  return `${value} h`
}

function sortAchievements(achievements: readonly GameAchievement[]): GameAchievement[] {
  return [...achievements].sort(
    (a, b) =>
      Number(b.unlocked) - Number(a.unlocked) ||
      (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0)
  )
}

const GUEST_GUARDED_MANAGE_ACTIONS: Record<string, GuestModeAction> = {
  collections: 'edit-metadata',
  metadata: 'edit-metadata',
  'launch-options': 'edit-metadata',
  uninstall: 'uninstall',
  'remove-custom': 'uninstall',
  exclude: 'hide'
}

export function GameDetailPanel({ game }: Props): JSX.Element {
  const t = useT()
  const captureShelfEnabled = usePreferencesStore((s) => s.captureShelfEnabled)
  const reduceMotion = Boolean(useReducedMotion())
  const language = usePreferencesStore((state) => state.language)
  const showAchievements = usePreferencesStore((state) => state.showAchievements)
  const backgroundTrailers = usePreferencesStore((state) => state.backgroundTrailers)
  const setFullScreenTrailerOpen = useTitleMusicStore(
    (state) => state.setFullScreenTrailerOpen
  )
  const [trailer, setTrailer] = useState<GameTrailer | null>(null)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const achievementGuidesUnlocked = useOrbitPlusStore((state) =>
    state.hasFeature('achievement-guides')
  )
  const [achievementSheetOpen, setAchievementSheetOpen] = useState(false)
  const [selectedAchievementId, setSelectedAchievementId] = useState<string | null>(null)
  const [achievementGuideState, setAchievementGuideState] =
    useState<AchievementGuideUiState | null>(null)
  const [achievementGuidePlayer, setAchievementGuidePlayer] =
    useState<AchievementGuidePlayer | null>(null)
  const achievementGuideGenerationRef = useRef(0)
  const achievementReturnFocusRef = useRef<HTMLElement | null>(null)
  const discoverActionsRef = useRef<HTMLButtonElement>(null)
  const achievementsSupported =
    game.provider === 'steam' || game.provider === 'retro' || game.provider === 'xbox'
  const closeGame = useGameDetailStore((state) => state.closeGame)
  const preferredAction = useGameDetailStore((state) => state.preferredAction)
  const launch = useLaunchGame()
  const detailRootRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const launchRef = useRef<HTMLButtonElement>(null)
  const cloudLaunchRef = useRef<HTMLButtonElement>(null)
  const manageActionsRef = useRef<HTMLButtonElement>(null)
  const [completionTimes, setCompletionTimes] = useState<GameCompletionTimes | null>(
    game.metadata.completionTimes ?? null
  )
  const [loadingTimes, setLoadingTimes] = useState(!game.metadata.completionTimes)
  const [achievements, setAchievements] = useState<GameAchievementsSnapshot | null>(null)
  const [loadingAchievements, setLoadingAchievements] = useState(
    showAchievements && achievementsSupported
  )
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupFeedback, setBackupFeedback] = useState<'success' | 'failed' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmInstall, setConfirmInstall] = useState(false)
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const [installRequestState, setInstallRequestState] = useState<
    'idle' | 'requesting' | 'requested' | 'error'
  >('idle')
  const [uninstallState, setUninstallState] = useState<
    'idle' | 'removing' | 'provider-opened' | 'error'
  >('idle')
  const [metadataEditorOpen, setMetadataEditorOpen] = useState(false)
  const [launchOptionsOpen, setLaunchOptionsOpen] = useState(false)
  const [collectionsOpen, setCollectionsOpen] = useState(false)
  const [saveRestoreOpen, setSaveRestoreOpen] = useState(false)
  const [openActionMenu, setOpenActionMenu] = useState<'discover' | 'manage' | null>(null)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [cloudLaunchState, setCloudLaunchState] = useState<'idle' | 'launching' | 'error'>('idle')
  const [excludeState, setExcludeState] = useState<'idle' | 'saving' | 'error'>('idle')
  const guestModeActive = useGuestModeStore(isGuestModeActive)
  const favoriteGameIds = useLibraryCollectionsStore((state) => state.favoriteGameIds)
  const toggleFavorite = useLibraryCollectionsStore((state) => state.toggleFavorite)
  const isFavorite = favoriteGameIds.includes(game.id)
  const geForceNowMatch = useGeForceNowStore((state) => state.matchesByGameId[game.id])
  const downloadCenterOpen = useDownloadStore((state) => state.centerOpen)
  const openDownloadCenter = useDownloadStore((state) => state.openCenter)
  const downloadActivity = useDownloadStore((state) =>
    state.snapshot.activities.find(
      (activity) =>
        activity.gameId === game.id ||
        (activity.provider === game.provider &&
          (activity.providerGameId === game.providerGameId ||
            activity.providerGameId === String(game.appId ?? '')))
    )
  )
  const entitlement = game.metadata.entitlement
  const installable = canRequestGameInstall(game)
  const uninstallable = canRequestGameUninstall(game)
  const downloadProgress = clampLauncherProgress(downloadActivity?.progress)
  const downloadPercentage =
    downloadProgress === undefined ? undefined : Math.round(downloadProgress * 100)
  const installationActive =
    downloadActivity !== undefined &&
    downloadActivity.phase !== 'completed' &&
    downloadActivity.phase !== 'error'
  const primaryActionLabel = downloadActivity
    ? `${t(DOWNLOAD_PHASE_KEYS[downloadActivity.phase])}${
        downloadPercentage === undefined ? '' : ` · ${downloadPercentage}%`
      }`
    : installRequestState === 'requesting'
      ? t('details.installRequesting')
      : installRequestState === 'requested'
        ? t('details.installRequested')
        : installRequestState === 'error'
          ? t('details.installRetry')
          : confirmInstall
            ? t('details.installConfirm')
            : game.installed || !installable
              ? t('details.play')
              : t('details.install')
  const xboxCloudUrl =
    game.provider === 'xbox' && /^[A-Z0-9]{12}$/iu.test(game.metadata.providerStoreId ?? '')
      ? `https://www.xbox.com/${languageLocale(language)}/play/games/${game.metadata.providerStoreId}`
      : undefined

  useBackHandler(closeGame, !achievementSheetOpen)

  useEffect(() => {
    if (!geForceNowMatch && document.activeElement === document.body) {
      focusElement(launchRef.current, { ensureVisible: false })
    }
  }, [geForceNowMatch])

  useEffect(() => {
    setFullScreenTrailerOpen(game.id, trailerOpen || Boolean(achievementGuidePlayer))
    return () => setFullScreenTrailerOpen(game.id, false)
  }, [achievementGuidePlayer, game.id, setFullScreenTrailerOpen, trailerOpen])

  useEffect(() => {
    let active = true
    setTrailer(null)
    setTrailerOpen(false)
    // Avoid unnecessary requests while rapidly switching between details.
    const timer = window.setTimeout(() => {
      void window.api.game.resolveTrailer(game.id).then((result) => {
        if (active) setTrailer(result)
      }).catch(() => undefined)
    }, 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [game.id, game.metadataRevision, language])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    returnFocusRef.current = previousFocus
    const frame = requestAnimationFrame(() => {
      // The panel is still translated outside the viewport during this frame.
      // Scrolling it into view would move the inert shell until the slide settles.
      focusElement(
        preferredAction === 'geforce-now' && geForceNowMatch
          ? cloudLaunchRef.current
          : launchRef.current,
        { ensureVisible: false }
      )
    })
    return () => {
      cancelAnimationFrame(frame)
      requestAnimationFrame(() => {
        const returnTarget = returnFocusRef.current
        const fallback =
          document.querySelector<HTMLElement>('[data-library-source][aria-pressed="true"]') ??
          document.querySelector<HTMLElement>('[data-top-nav] [aria-current="page"]')
        focusElement(returnTarget?.isConnected ? returnTarget : fallback)
      })
    }
  }, [])

  useEffect(() => {
    let active = true
    setCompletionTimes(game.metadata.completionTimes ?? null)
    setLoadingTimes(!game.metadata.completionTimes)
    void window.api.game
      .resolveCompletionTimes(game.id)
      .then((result) => {
        if (active) setCompletionTimes(result)
      })
      .finally(() => {
        if (active) setLoadingTimes(false)
      })
    return () => {
      active = false
    }
  }, [game.id, game.metadataRevision])

  useEffect(() => {
    let active = true
    achievementGuideGenerationRef.current += 1
    achievementReturnFocusRef.current = null
    setAchievementSheetOpen(false)
    setSelectedAchievementId(null)
    setAchievementGuideState(null)
    setAchievementGuidePlayer(null)
    setAchievements(null)
    setLoadingAchievements(showAchievements && achievementsSupported)
    if (showAchievements && achievementsSupported) {
      void window.api.game
        .resolveAchievements(game.id)
        .then((result) => {
          if (active) setAchievements(result)
        })
        .finally(() => {
          if (active) setLoadingAchievements(false)
        })
    }
    return () => {
      active = false
    }
  }, [achievementsSupported, game.id, showAchievements, language])

  useEffect(() => {
    if (
      selectedAchievementId &&
      achievements?.state === 'available' &&
      !achievements.achievements.some((achievement) => achievement.id === selectedAchievementId)
    ) {
      achievementGuideGenerationRef.current += 1
      setSelectedAchievementId(null)
      setAchievementGuideState(null)
      setAchievementGuidePlayer(null)
    }
  }, [achievements, selectedAchievementId])

  useEffect(() => {
    if (achievementGuidesUnlocked || !achievementSheetOpen) return
    achievementGuideGenerationRef.current += 1
    setAchievementGuidePlayer(null)
    if (selectedAchievementId) {
      setAchievementGuideState({ achievementId: selectedAchievementId, state: 'locked' })
    }
  }, [achievementGuidesUnlocked, achievementSheetOpen, selectedAchievementId])

  useEffect(() => {
    if (!achievementSheetOpen || achievements?.state === 'available') return
    achievementGuideGenerationRef.current += 1
    setAchievementSheetOpen(false)
    setSelectedAchievementId(null)
    setAchievementGuideState(null)
    setAchievementGuidePlayer(null)
  }, [achievementSheetOpen, achievements])

  const openAchievementOverview = (returnFocus: HTMLElement): void => {
    achievementGuideGenerationRef.current += 1
    achievementReturnFocusRef.current = returnFocus
    setSelectedAchievementId(null)
    setAchievementGuideState(null)
    setAchievementGuidePlayer(null)
    setAchievementSheetOpen(true)
  }

  const closeAchievementOverview = (): void => {
    achievementGuideGenerationRef.current += 1
    setAchievementSheetOpen(false)
    setSelectedAchievementId(null)
    setAchievementGuideState(null)
    setAchievementGuidePlayer(null)
  }

  const handleAchievementGuide = async (achievement: GameAchievement): Promise<void> => {
    if (
      achievementGuideState?.achievementId === achievement.id &&
      achievementGuideState.state === 'loading'
    ) return
    if (!achievementGuidesUnlocked) {
      setAchievementGuideState({ achievementId: achievement.id, state: 'locked' })
      setAchievementGuidePlayer(null)
      return
    }
    const generation = ++achievementGuideGenerationRef.current
    setAchievementGuideState({ achievementId: achievement.id, state: 'loading' })
    setAchievementGuidePlayer(null)
    try {
      const result = await window.api.game.resolveAchievementGuide(game.id, achievement.id)
      if (generation !== achievementGuideGenerationRef.current) return
      if (result.state === 'ready') {
        setAchievementGuideState(null)
        setAchievementGuidePlayer({
          achievementId: achievement.id,
          trailer: result.trailer
        })
        return
      }
      setAchievementGuideState({ achievementId: achievement.id, state: result.state })
    } catch {
      if (generation === achievementGuideGenerationRef.current) {
        setAchievementGuideState({ achievementId: achievement.id, state: 'unavailable' })
      }
    }
  }

  const handleAchievementSelection = (achievement: GameAchievement): void => {
    achievementGuideGenerationRef.current += 1
    setSelectedAchievementId(achievement.id)
    setAchievementGuideState(null)
    setAchievementGuidePlayer(null)
    if (achievementGuidesUnlocked) void handleAchievementGuide(achievement)
    else setAchievementGuideState({ achievementId: achievement.id, state: 'locked' })
  }

  async function retryAchievements(): Promise<void> {
    if (loadingAchievements) return
    setLoadingAchievements(true)
    try {
      setAchievements(await window.api.game.resolveAchievements(game.id, true))
    } catch {
      // Keep the previous explanatory state visible when IPC itself fails.
    } finally {
      setLoadingAchievements(false)
    }
  }

  useEffect(() => {
    if (!confirmRemove) return
    const timer = window.setTimeout(() => setConfirmRemove(false), 4_000)
    return () => window.clearTimeout(timer)
  }, [confirmRemove])

  useEffect(() => {
    if (!confirmInstall && !confirmUninstall) return
    const timer = window.setTimeout(() => {
      setConfirmInstall(false)
      setConfirmUninstall(false)
    }, 4_000)
    return () => window.clearTimeout(timer)
  }, [confirmInstall, confirmUninstall])

  useEffect(() => {
    if (downloadActivity) setInstallRequestState('idle')
  }, [downloadActivity])

  useEffect(() => {
    if (game.installed) setInstallRequestState('idle')
    else setUninstallState('idle')
  }, [game.installed])

  useEffect(() => {
    if (installRequestState !== 'requested') return
    const timer = window.setTimeout(() => setInstallRequestState('idle'), 45_000)
    return () => window.clearTimeout(timer)
  }, [installRequestState])

  useEffect(() => {
    if (uninstallState !== 'provider-opened') return
    const timer = window.setTimeout(() => setUninstallState('idle'), 45_000)
    return () => window.clearTimeout(timer)
  }, [uninstallState])

  useEffect(() => {
    const root = detailRootRef.current
    if (!root) return
    if (
      metadataEditorOpen ||
      launchOptionsOpen ||
      collectionsOpen ||
      saveRestoreOpen ||
      trailerOpen ||
      downloadCenterOpen ||
      openActionMenu !== null
    ) root.setAttribute('inert', '')
    else root.removeAttribute('inert')
    return () => root.removeAttribute('inert')
  }, [
    metadataEditorOpen,
    collectionsOpen,
    saveRestoreOpen,
    downloadCenterOpen,
    launchOptionsOpen,
    openActionMenu,
    trailerOpen
  ])

  const orderedAchievements = useMemo(
    () =>
      achievements?.state === 'available'
        ? sortAchievements(achievements.achievements)
        : [],
    [achievements]
  )
  const playtime = formatPlaytime(game, t) ?? t('details.notPlayed')
  const summary = game.metadata.summary ?? game.metadata.description
  const developer = game.metadata.developers?.[0]
  const genreText = useMemo(() => game.metadata.genres?.slice(0, 3).join(' · '), [game.metadata.genres])
  const completionAvailable = completionTimes?.state === 'available'
  const local = game.provider === 'local' ? game.local : undefined
  const retro = game.provider === 'retro' ? game.retro : undefined
  const retroDefaultArguments = useMemo(() => {
    if (!retro) return undefined
    try {
      return retroLaunchArguments({ ...retro, launchArguments: undefined })
    } catch {
      return [retro.romPath]
    }
  }, [retro])
  const retroEffectiveArguments = useMemo(() => {
    if (!retro) return undefined
    try {
      return retroLaunchArguments(retro)
    } catch {
      return retroDefaultArguments
    }
  }, [retro, retroDefaultArguments])
  const retroLaunchCommand = formatWindowsArguments(retroEffectiveArguments)
  const retroLaunchUnavailable = Boolean(retro && (!game.installed || !retro.emulatorPath))
  const lastBackupLabel =
    backupFeedback === 'failed' || local?.lastBackupState === 'failed'
      ? t('details.backupFailed')
      : backupFeedback === 'success' || local?.lastBackupAt
        ? t('details.backupLast', {
            date: new Intl.DateTimeFormat(languageLocale(language), {
              dateStyle: 'short',
              timeStyle: 'short'
            }).format(local?.lastBackupAt ?? Date.now())
          })
        : t('details.backupNever')

  const handleLaunch = async (): Promise<void> => {
    if (retroLaunchUnavailable) return
    if (installationActive && downloadActivity) {
      openDownloadCenter(downloadActivity.id)
      return
    }
    if (installable) {
      if (installRequestState === 'requesting' || installRequestState === 'requested') return
      if (!confirmInstall) {
        setConfirmInstall(true)
        return
      }
      setConfirmInstall(false)
      setInstallRequestState('requesting')
      try {
        await window.api.game.install(game.id)
        setInstallRequestState('requested')
      } catch {
        setInstallRequestState('error')
      }
      return
    }
    launch(game.id)
    closeGame()
  }

  const handleUninstall = async (): Promise<void> => {
    if (!uninstallable || uninstallState === 'removing') return
    if (!confirmUninstall) {
      setConfirmUninstall(true)
      return
    }
    setConfirmUninstall(false)
    setUninstallState('removing')
    try {
      const snapshot = await window.api.game.uninstall(game.id)
      useLibraryStore.getState().applySnapshot(snapshot)
      setUninstallState(game.provider === 'steam' ? 'provider-opened' : 'idle')
    } catch {
      setUninstallState('error')
    }
  }

  const handleCloudLaunch = async (): Promise<void> => {
    if (!geForceNowMatch || cloudLaunchState === 'launching') return
    setCloudLaunchState('launching')
    try {
      await window.api.geforceNow.launchGame(game.id)
      closeGame()
    } catch {
      setCloudLaunchState('error')
    }
  }

  const handleBackup = async (): Promise<void> => {
    if (!local?.backupEnabled || backupBusy) return
    const actionOrigin = document.activeElement as HTMLElement | null
    setBackupBusy(true)
    setBackupFeedback(null)
    try {
      const result = await window.api.library.custom.backup(game.id)
      setBackupFeedback(result.state === 'success' ? 'success' : 'failed')
    } catch {
      setBackupFeedback('failed')
    } finally {
      setBackupBusy(false)
      requestAnimationFrame(() => {
        if (actionOrigin?.isConnected) focusElement(actionOrigin)
      })
    }
  }

  const findFocusAfterLibraryRemoval = (): HTMLElement | null => {
    const originCard = returnFocusRef.current?.closest<HTMLElement>('[data-game-card="true"]')
    const activePane = originCard?.closest<HTMLElement>('[data-view-pane]')
    const visibleCards = activePane
      ? Array.from(activePane.querySelectorAll<HTMLElement>('[data-game-card="true"]'))
      : []
    const currentIndex = originCard ? visibleCards.indexOf(originCard) : -1
    const fallbackCard =
      currentIndex >= 0
        ? (visibleCards[currentIndex + 1] ?? visibleCards[currentIndex - 1] ?? null)
        : null
    return (
      fallbackCard ??
      document.querySelector<HTMLElement>('[data-library-source][aria-pressed="true"]') ??
      document.querySelector<HTMLElement>('[data-top-nav] [aria-current="page"]')
    )
  }

  const handleExclude = async (): Promise<void> => {
    if (excludeState === 'saving') return
    const focusTarget = findFocusAfterLibraryRemoval()
    setExcludeState('saving')
    try {
      const snapshot = await window.api.library.exclude(game.id)
      returnFocusRef.current = focusTarget
      useLibraryStore.getState().applySnapshot(snapshot)
      notify({
        tone: 'success',
        titleKey: 'notification.libraryExcluded.title',
        messageKey: 'notification.libraryExcluded.body',
        vars: { game: game.name },
        force: true,
        replace: true
      })
      closeGame()
    } catch {
      setExcludeState('error')
    }
  }

  const handleRemove = async (): Promise<void> => {
    if (!confirmRemove) {
      setConfirmRemove(true)
      return
    }
    const focusTarget = findFocusAfterLibraryRemoval()
    try {
      const snapshot = await window.api.library.custom.remove(game.id)
      returnFocusRef.current = focusTarget
      useLibraryStore.getState().applySnapshot(snapshot)
      closeGame()
    } catch {
      setConfirmRemove(false)
    }
  }

  const handleToggleFavorite = async (): Promise<void> => {
    if (favoriteBusy) return
    setFavoriteBusy(true)
    try {
      await toggleFavorite(game.id)
    } catch {
      // The collection store rolls the optimistic state back on persistence failure.
    } finally {
      setFavoriteBusy(false)
    }
  }

  const closeLaunchOptions = (): void => {
    setLaunchOptionsOpen(false)
    requestAnimationFrame(() => focusElement(manageActionsRef.current))
  }

  const discoverActions: GameDetailActionMenuItem[] = []
  if (trailer) {
    discoverActions.push({
      id: 'trailer',
      label: t('trailer.watch'),
      icon: Play,
      onSelect: () => {
        if (trailer.format === 'external') void window.api.app.openExternal(trailer.url)
        else setTrailerOpen(true)
      }
    })
  }
  if (game.metadata.storeUrl) {
    discoverActions.push({
      id: 'store',
      label: t('details.storePage'),
      icon: ExternalLink,
      onSelect: () => void window.api.app.openExternal(game.metadata.storeUrl as string)
    })
  }
  if (game.metadata.website && game.metadata.website !== game.metadata.storeUrl) {
    discoverActions.push({
      id: 'website',
      label: t('metadata.website'),
      icon: ExternalLink,
      onSelect: () => void window.api.app.openExternal(game.metadata.website as string)
    })
  }
  if (game.metadata.achievementsUrl) {
    discoverActions.push({
      id: 'achievements',
      label: t('metadata.achievements'),
      icon: Trophy,
      onSelect: () => void window.api.app.openExternal(game.metadata.achievementsUrl as string)
    })
  }
  if (completionTimes?.sourceUrl) {
    discoverActions.push({
      id: 'completion-times',
      label: t('details.hltbPage'),
      icon: Timer,
      onSelect: () => void window.api.app.openExternal(completionTimes.sourceUrl as string)
    })
  }
  if (xboxCloudUrl) {
    discoverActions.push({
      id: 'xbox-cloud',
      label: t('details.xboxCloudCheck'),
      icon: CloudLightning,
      onSelect: () => void window.api.app.openExternal(xboxCloudUrl)
    })
  }

  const manageActions: GameDetailActionMenuItem[] = [
    ...(captureShelfEnabled ? [{ id: 'captures', label: t('captures.title'), icon: FolderOpen,
      onSelect: () => void useCapturesStore.getState().openFolder() }] : []),
    {
      id: 'favorite',
      label: t(isFavorite ? 'details.favoriteRemove' : 'details.favoriteAdd'),
      icon: Star,
      checked: isFavorite,
      busy: favoriteBusy,
      disabled: favoriteBusy,
      tone: isFavorite ? 'accent' : 'default',
      onSelect: () => void handleToggleFavorite()
    },
    {
      id: 'collections',
      label: t('details.collections'),
      icon: LibraryBig,
      onSelect: () => setCollectionsOpen(true)
    },
    {
      id: 'metadata',
      label: t('details.metadata'),
      icon: Database,
      onSelect: () => setMetadataEditorOpen(true)
    }
  ]

  if (local || retro) {
    manageActions.push({
      id: 'launch-options',
      label: t('details.launchOptions'),
      icon: SlidersHorizontal,
      onSelect: () => setLaunchOptionsOpen(true)
    })
  }
  if (local?.backupEnabled) {
    manageActions.push(
      {
        id: 'backup-now',
        label: t(backupBusy ? 'details.backupRunning' : 'details.backupNow'),
        icon: Archive,
        busy: backupBusy,
        disabled: backupBusy,
        separatorBefore: true,
        onSelect: () => void handleBackup()
      },
      {
        id: 'open-backups',
        label: t('details.openBackups'),
        icon: FolderOpen,
        onSelect: () => void window.api.library.custom.openBackups(game.id)
      },
      {
        id: 'restore-backup',
        label: t('details.restoreBackup'),
        icon: ArchiveRestore,
        onSelect: () => setSaveRestoreOpen(true)
      }
    )
  }
  if (downloadActivity) {
    manageActions.push({
      id: 'downloads',
      label: t('details.openDownloads'),
      icon: HardDriveDownload,
      separatorBefore: !local?.backupEnabled,
      onSelect: () => openDownloadCenter(downloadActivity.id)
    })
  }
  if (uninstallable) {
    manageActions.push({
      id: 'uninstall',
      label: t(
        confirmUninstall
          ? 'details.uninstallConfirm'
          : uninstallState === 'removing'
            ? 'details.uninstalling'
            : uninstallState === 'provider-opened'
              ? 'details.uninstallProviderOpened'
              : uninstallState === 'error'
                ? 'details.uninstallRetry'
                : 'details.uninstall'
      ),
      icon: Trash2,
      busy: uninstallState === 'removing',
      disabled: uninstallState === 'removing',
      keepOpen: true,
      separatorBefore: true,
      tone: confirmUninstall ? 'danger' : uninstallState === 'error' ? 'warning' : 'default',
      onSelect: () => void handleUninstall()
    })
  }
  manageActions.push({
    id: 'exclude',
    label: t(
      excludeState === 'saving'
        ? 'details.excludeSaving'
        : excludeState === 'error'
          ? 'details.excludeRetry'
          : 'details.exclude'
    ),
    icon: EyeOff,
    busy: excludeState === 'saving',
    disabled: excludeState === 'saving',
    separatorBefore: !uninstallable,
    tone: excludeState === 'error' ? 'warning' : 'default',
    onSelect: () => void handleExclude()
  })
  if (local) {
    manageActions.push({
      id: 'remove-custom',
      label: t(confirmRemove ? 'details.confirmRemoveCustom' : 'details.removeCustom'),
      icon: Trash2,
      keepOpen: true,
      tone: confirmRemove ? 'danger' : 'default',
      onSelect: () => void handleRemove()
    })
  }
  // Guest mode keeps launching and favourites; everything that edits or removes
  // the library needs the owner (the main process rejects these too).
  const visibleManageActions = manageActions.filter((action) => {
    const guarded = GUEST_GUARDED_MANAGE_ACTIONS[action.id]
    return guarded === undefined || isActionAllowed(guarded, guestModeActive)
  })

  return (
    <>
    <motion.div
      ref={detailRootRef}
      data-focus-scope={metadataEditorOpen || launchOptionsOpen || collectionsOpen || saveRestoreOpen || trailerOpen || downloadCenterOpen || openActionMenu !== null || achievementSheetOpen ? undefined : 'active'}
      aria-hidden={metadataEditorOpen || launchOptionsOpen || collectionsOpen || saveRestoreOpen || trailerOpen || downloadCenterOpen || openActionMenu !== null || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={game.name}
      initial="closed"
      animate="open"
      exit="closed"
      onPointerDown={closeGame}
      className="fixed inset-0 z-50"
    >
      <motion.div
        aria-hidden="true"
        variants={{
          closed: {
            opacity: 0,
            transition: reduceMotion
              ? { duration: 0.12 }
              : { duration: 0.2, delay: 0.12, ease: [0.4, 0, 1, 1] }
          },
          open: {
            opacity: 1,
            transition: reduceMotion
              ? { duration: 0.12 }
              : { duration: 0.24, ease: [0, 0, 0.2, 1] }
          }
        }}
        className="absolute inset-0 bg-black/65"
      />
      <motion.section
        variants={
          reduceMotion
            ? { closed: { opacity: 0 }, open: { opacity: 1 } }
            : { closed: { x: '102%' }, open: { x: 0 } }
        }
        transition={
          reduceMotion
            ? { duration: 0.12 }
            : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }
        }
        onPointerDown={(event) => event.stopPropagation()}
        className="game-detail-panel absolute overflow-hidden rounded-[clamp(1.4rem,2.3vw,2.8rem)] border border-white/10 bg-surface shadow-[0_32px_100px_rgba(0,0,0,0.65)]"
      >
        <GameImage
          gameId={game.id}
          name={game.name}
          decorative
          orientation="horizontal"
          className="absolute inset-0 h-full w-full scale-[1.02] object-cover"
        />
        {trailer && trailer.format !== 'external' && backgroundTrailers && !reduceMotion && !trailerOpen && !achievementGuidePlayer && !metadataEditorOpen && !launchOptionsOpen && !collectionsOpen && !saveRestoreOpen && !achievementSheetOpen && (
          <GameTrailerBackground key={`${game.id}:${trailer.url}`} trailer={trailer} />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,transparent_0%,rgba(0,0,0,0.28)_48%,rgba(0,0,0,0.72)_100%)]" />

        <div
          aria-hidden={achievementSheetOpen || undefined}
          className="absolute right-[clamp(0.85rem,1.7vw,1.6rem)] top-[clamp(0.85rem,1.7vw,1.6rem)] z-30"
        >
          <button
            data-focusable
            type="button"
            onClick={closeGame}
            aria-label={t('details.close')}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white backdrop-blur-xl transition-colors hover:bg-white/15"
          >
            <X size={20} />
          </button>
        </div>

        <div
          aria-hidden={achievementSheetOpen || undefined}
          className="absolute inset-0 z-20 overflow-hidden"
        >
          <div className="game-detail-layout grid h-full">
            <div className="game-detail-overview scrollbar-none grid min-h-0 items-start overflow-y-auto overscroll-contain">
              <div className="min-w-0">
                <div className="game-detail-identity flex items-end gap-[clamp(0.8rem,1.4vw,1.35rem)]">
                  <div className="relative h-[clamp(4.25rem,6.6vw,6.5rem)] aspect-[2/3] shrink-0 overflow-hidden rounded-[clamp(0.65rem,1vw,1rem)] border border-white/20 bg-black/35 shadow-[0_16px_40px_rgba(0,0,0,0.48)]">
                    <GameImage
                      gameId={game.id}
                      name={game.name}
                      orientation="vertical"
                      className="h-full w-full object-cover"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10"
                    />
                  </div>
                  <div className="min-w-0 pb-1">
                    <p className="mb-1.5 text-[clamp(0.6rem,0.75vw,0.7rem)] font-bold uppercase tracking-[0.18em] text-white/48">
                      {game.provider}
                    </p>
                    <h1 className="line-clamp-2 text-[clamp(1.8rem,3.25vw,3.8rem)] font-bold leading-[0.96] tracking-[-0.04em] text-white">
                      {game.name}
                    </h1>
                    <div className="game-detail-statuses mt-2.5 flex flex-wrap items-center gap-1.5 text-[clamp(0.62rem,0.76vw,0.72rem)] font-semibold text-white/70">
                      {game.libraryAccess === 'shared' && (
                        <span className="rounded-full border border-sky-200/20 bg-sky-300/10 px-2 py-1 text-sky-100/80">
                          {t('details.steamShared')}
                        </span>
                      )}
                      {entitlement?.kind === 'subscription' && (
                        <span className="flex items-center gap-1.5 rounded-full border border-[#52c75a]/25 bg-[#107c10]/15 px-2 py-1 text-[#8bea91]">
                          <Sparkles size={11} />
                          {t('library.entitlement.gamePass')}
                        </span>
                      )}
                      {entitlement?.kind === 'purchased' && (
                        <span className="flex items-center gap-1.5 rounded-full border border-sky-200/20 bg-sky-300/10 px-2 py-1 text-sky-100/80">
                          <ShieldCheck size={11} />
                          {t('library.entitlement.purchased')}
                        </span>
                      )}
                      {game.installed && (
                        <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-accent">
                          {t('details.installed')}
                        </span>
                      )}
                      {geForceNowMatch && (
                        <span className="flex items-center gap-1.5 rounded-full border border-[#9ee34b]/25 bg-[#76b900]/15 px-2 py-1 text-[#b7f16f]">
                          <CloudLightning size={11} />
                          {t('library.geforceNow.available')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="game-detail-meta flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[clamp(0.72rem,0.9vw,0.88rem)] text-white/65">
                {developer && (
                  <span className="flex min-w-0 items-center gap-2">
                    <Gamepad2 size={14} className="shrink-0 text-accent" />
                    <span className="truncate">{developer}</span>
                  </span>
                )}
                {game.metadata.releaseDateText && (
                  <span className="flex items-center gap-2">
                    <CalendarDays size={14} className="text-accent" />
                    {game.metadata.releaseDateText}
                  </span>
                )}
                {genreText && <span className="truncate">{genreText}</span>}
              </div>

              {summary && (
                <p className="game-detail-summary line-clamp-3 text-[clamp(0.76rem,0.95vw,0.94rem)] leading-relaxed text-white/65">
                  {summary}
                </p>
              )}

              {local && (
                <div className="game-detail-backup rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 backdrop-blur-md">
                  <div className="flex items-start justify-between gap-3">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white/80">
                        {local.backupEnabled ? t('details.backupReady') : t('details.backupNotConfigured')}
                      </p>
                      {local.savePath && (
                        <p className="mt-1 truncate text-[10px] text-white/35" title={local.savePath}>
                          {local.savePath}
                        </p>
                      )}
                      {local.backupEnabled && (
                        <p aria-live="polite" className="mt-1 text-[10px] text-white/45">
                          {lastBackupLabel}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {retro && (
                <div className="game-detail-backup rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 backdrop-blur-md">
                  <div className="flex items-start gap-3">
                    {retro.emulatorPath ? (
                      <Gamepad2 size={16} className="mt-0.5 shrink-0 text-accent" />
                    ) : (
                      <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-300" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white/80">
                        {retro.systemName}
                        <span className="px-1.5 text-white/25">·</span>
                        {retro.emulatorName ?? t('details.retroMissingEmulator')}
                      </p>
                      <p className="mt-1 text-[10px] text-white/45">
                        {t(
                          retro.retroAchievementsMatch === 'matched'
                            ? 'details.retroAchievementsMatched'
                            : retro.retroAchievementsMatch === 'not-configured'
                              ? 'details.retroAchievementsSetup'
                              : retro.retroAchievementsMatch === 'unmatched'
                                ? 'details.retroAchievementsUnmatched'
                                : retro.retroAchievementsMatch === 'unavailable'
                                  ? 'details.retroAchievementsUnavailable'
                                  : 'details.retroAchievementsUnsupported'
                        )}
                      </p>
                      {retroLaunchCommand && (
                        <p
                          className="mt-1.5 truncate font-mono text-[10px] text-white/35"
                          title={retroLaunchCommand}
                        >
                          {retroLaunchCommand}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <section className="game-detail-completion rounded-xl2 border border-white/10 bg-black/30 p-3.5 backdrop-blur-md">
                <div className="mb-3 flex items-center gap-3">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
                    <Sparkles size={14} className="text-accent" />
                    HLTB
                  </p>
                </div>

                <div className="game-detail-stats grid grid-cols-4 gap-2">
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-white/55">
                    <Timer size={14} className="text-accent" />
                    {t('details.yourPlaytime')}
                  </div>
                  <p className="text-lg font-semibold text-white">{playtime}</p>
                </div>

                {loadingTimes ? (
                  [0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="min-h-[4.25rem] animate-pulse rounded-xl border border-white/5 bg-white/[0.06]"
                    />
                  ))
                ) : completionAvailable ? (
                  <>
                    <TimeCard
                      label={t('details.mainStory')}
                      value={formatHours(completionTimes.mainStoryMinutes, language)}
                    />
                    <TimeCard
                      label={t('details.mainExtra')}
                      value={formatHours(completionTimes.mainExtraMinutes, language)}
                    />
                    <TimeCard
                      label={t('details.completionist')}
                      value={formatHours(completionTimes.completionistMinutes, language)}
                    />
                  </>
                ) : (
                  <div className="col-span-3 flex min-h-[4.25rem] items-center rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 py-2.5 text-sm text-white/55">
                    {t('details.noCompletionData')}
                  </div>
                )}
                </div>
              </section>

              {showAchievements && achievementsSupported && (
                <AchievementSummary
                  snapshot={achievements}
                  loading={loadingAchievements}
                  onOpen={openAchievementOverview}
                  onRetry={() => void retryAchievements()}
                  t={t}
                />
              )}
            </div>
            </div>

            {captureShelfEnabled && <CaptureShelf gameId={game.id} />}

            {(downloadActivity || installRequestState !== 'idle') && (
              <section
                data-game-installation-status="true"
                className="rounded-xl2 border border-accent/20 bg-accent/[0.07] p-3.5 backdrop-blur-md"
                aria-live="polite"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-bold text-white">
                      {downloadActivity?.phase === 'paused' ? (
                        <Pause size={15} fill="currentColor" className="text-accent" />
                      ) : (
                        <Loader2
                          size={15}
                          className={downloadActivity?.phase === 'error' ? 'text-amber-200' : 'animate-spin text-accent'}
                        />
                      )}
                      <span className="truncate">{primaryActionLabel}</span>
                    </p>
                    <p className="mt-1 text-xs text-white/45">
                      {t('details.installStatusBody')}
                    </p>
                  </div>
                </div>
                {downloadActivity && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                    {downloadProgress === undefined ? (
                      <motion.span
                        className="block h-full w-1/3 rounded-full bg-accent"
                        animate={
                          reduceMotion || downloadActivity.phase === 'paused'
                            ? undefined
                            : { x: ['-120%', '320%'] }
                        }
                        transition={{ duration: 1.35, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    ) : (
                      <motion.span
                        className="block h-full origin-left rounded-full bg-accent"
                        initial={false}
                        animate={{ scaleX: downloadProgress }}
                        transition={{ duration: reduceMotion ? 0 : 0.3 }}
                      />
                    )}
                  </div>
                )}
              </section>
            )}

            <div className="game-detail-actions grid gap-2.5">
              <button
                ref={launchRef}
                data-focusable
                aria-disabled={retroLaunchUnavailable || installRequestState === 'requesting'}
                data-disabled={retroLaunchUnavailable || installRequestState === 'requesting' ? 'true' : undefined}
                disabled={installRequestState === 'requesting'}
                onClick={() => void handleLaunch()}
                className={`game-detail-action game-detail-action--primary border-transparent bg-accent font-bold text-black shadow-[0_12px_40px_rgb(var(--color-accent)/0.25)] ${
                  retroLaunchUnavailable
                    ? 'cursor-not-allowed opacity-55'
                    : 'hover:scale-[1.015]'
                }`}
              >
                {installRequestState === 'requesting' ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : retroLaunchUnavailable ? (
                  <CircleAlert size={17} />
                ) : installationActive && downloadActivity?.phase === 'paused' ? (
                  <Pause size={17} fill="currentColor" />
                ) : installationActive || installRequestState === 'requested' ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : game.installed ? (
                  <Play size={17} fill="currentColor" />
                ) : (
                  <HardDriveDownload size={17} />
                )}
                {retro && !game.installed
                  ? t('details.romMissing')
                  : retro && !retro.emulatorPath
                    ? t('details.retroMissingEmulator')
                    : primaryActionLabel}
              </button>

              {geForceNowMatch && (
                <button
                  ref={cloudLaunchRef}
                  data-geforce-now-game-launch
                  data-focusable
                  type="button"
                  disabled={cloudLaunchState === 'launching'}
                  data-disabled={cloudLaunchState === 'launching' ? 'true' : undefined}
                  onClick={() => void handleCloudLaunch()}
                  className={`game-detail-action border-[#9ee34b]/35 bg-[#76b900]/15 font-bold text-[#c7ff82] hover:bg-[#76b900]/25 ${
                    cloudLaunchState === 'error' ? 'border-amber-200/35 text-amber-100' : ''
                  }`}
                >
                  {cloudLaunchState === 'launching' ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <CloudLightning size={17} />
                  )}
                  {t(
                    cloudLaunchState === 'launching'
                      ? 'details.geforceNowLaunching'
                      : cloudLaunchState === 'error'
                        ? 'details.geforceNowRetry'
                        : 'details.geforceNowPlay'
                  )}
                </button>
              )}

              {discoverActions.length > 0 && (
                <GameDetailActionMenu
                  ref={discoverActionsRef}
                  label={t('details.discoverActions')}
                  icon={Sparkles}
                  items={discoverActions}
                  open={openActionMenu === 'discover'}
                  onOpenChange={(open) => setOpenActionMenu(open ? 'discover' : null)}
                />
              )}

              <GameDetailActionMenu
                ref={manageActionsRef}
                label={t('details.manageActions')}
                icon={SlidersHorizontal}
                items={visibleManageActions}
                open={openActionMenu === 'manage'}
                onOpenChange={(open) => setOpenActionMenu(open ? 'manage' : null)}
              />
            </div>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {achievementSheetOpen && achievements?.state === 'available' && (
            <AchievementOverviewSheet
              key={game.id}
              achievements={orderedAchievements}
              unlocked={achievements.unlocked}
              total={achievements.total}
              selectedAchievementId={selectedAchievementId}
              gameName={game.name}
              language={language}
              guideUnlocked={achievementGuidesUnlocked}
              guideState={achievementGuideState}
              guideTrailer={achievementGuidePlayer}
              returnFocus={achievementReturnFocusRef.current}
              onSelect={(achievement) => handleAchievementSelection(achievement)}
              onGuideRetry={(achievement) => void handleAchievementGuide(achievement)}
              onClose={closeAchievementOverview}
            />
          )}
        </AnimatePresence>
      </motion.section>
    </motion.div>
    {trailerOpen && trailer && (
      <GameTrailerDialog trailer={trailer} gameName={game.name} onClose={() => {
        setTrailerOpen(false)
        requestAnimationFrame(() => focusElement(discoverActionsRef.current))
      }} />
    )}
    {metadataEditorOpen && (
      <GameMetadataEditor
        game={game}
        onClose={() => {
          setMetadataEditorOpen(false)
          requestAnimationFrame(() => focusElement(manageActionsRef.current))
        }}
      />
    )}
    {launchOptionsOpen && (local || retro) && (
      <LaunchOptionsDialog
        gameName={game.name}
        context={retro ? 'retro' : 'local'}
        initialArguments={retro ? retroEffectiveArguments : local?.launchArguments}
        defaultArguments={retro ? retroDefaultArguments : undefined}
        onSave={(launchArguments) =>
          retro
            ? window.api.library.retro.setLaunchArguments({ gameId: game.id, launchArguments })
            : window.api.library.custom.setLaunchArguments({ gameId: game.id, launchArguments })
        }
        onSaved={(snapshot) => {
          useLibraryStore.getState().applySnapshot(snapshot)
          closeLaunchOptions()
        }}
        onClose={closeLaunchOptions}
      />
    )}
    {collectionsOpen && (
      <LibraryCollectionDialog
        gameId={game.id}
        onClose={() => {
          setCollectionsOpen(false)
          requestAnimationFrame(() => focusElement(manageActionsRef.current))
        }}
      />
    )}
    {saveRestoreOpen && (
      <SaveRestoreBackupDialog
        gameId={game.id}
        gameName={game.name}
        onClose={() => {
          setSaveRestoreOpen(false)
          requestAnimationFrame(() => focusElement(manageActionsRef.current))
        }}
        onRestored={({ safetyBackupId }) => {
          notify({
            tone: 'success',
            titleKey: 'notification.saveRestore.success.title',
            messageKey: 'notification.saveRestore.success.body',
            vars: { safetyBackup: safetyBackupId ?? '—' },
            force: true,
            replace: true
          })
        }}
        onRestoreFailed={(reason) => {
          notify({
            tone: 'error',
            titleKey: 'notification.saveRestore.failed.title',
            messageKey:
              reason === 'game-running'
                ? 'notification.saveRestore.failed.running'
                : 'notification.saveRestore.failed.body',
            force: true,
            replace: true
          })
        }}
      />
    )}
    </>
  )
}

function AchievementSummary({
  snapshot,
  loading,
  onOpen,
  onRetry,
  t
}: {
  snapshot: GameAchievementsSnapshot | null
  loading: boolean
  onOpen: (trigger: HTMLElement) => void
  onRetry: () => void
  t: ReturnType<typeof useT>
}): JSX.Element {
  if (loading) {
    return (
      <div className="game-detail-achievements h-32 min-w-0 max-w-full animate-pulse overflow-hidden rounded-xl2 border border-white/5 bg-white/[0.05]" />
    )
  }

  if (!snapshot || snapshot.state === 'unavailable') {
    const reason = snapshot?.reason ?? 'unavailable'
    const reasonKey = {
      private: 'achievements.private',
      unsupported: 'achievements.unsupported',
      unavailable: 'achievements.unavailable',
      'not-connected': 'achievements.notConnected'
    } as const
    return (
      <section className="game-detail-achievements min-w-0 max-w-full overflow-hidden rounded-xl2 border border-white/10 bg-black/30 p-3.5 backdrop-blur-md">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
              <Trophy size={14} className="text-accent" />
              {t('achievements.title')}
            </p>
            <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-white/55">
              <CircleAlert size={14} className="mt-0.5 shrink-0 text-amber-300" />
              {t(reasonKey[reason])}
            </p>
          </div>
          {reason !== 'unsupported' && (
            <button
              data-focusable
              type="button"
              onClick={onRetry}
              className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] font-semibold text-white/65 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              <RefreshCw size={13} />
              {t('achievements.retry')}
            </button>
          )}
        </div>
      </section>
    )
  }

  const percent = snapshot.total ? Math.round((snapshot.unlocked / snapshot.total) * 100) : 0

  return (
    <section
      data-achievement-browser="true"
      className="game-detail-achievements min-w-0 max-w-full overflow-hidden rounded-xl2 border border-white/10 bg-black/30 p-1.5 backdrop-blur-md"
    >
      {snapshot.achievements.length === 0 ? (
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.035] px-3 py-4 text-xs text-white/50">
          {t('achievements.empty')}
        </p>
      ) : (
        <button
          type="button"
          data-focusable
          data-achievement-overview-open="true"
          onClick={(event) => onOpen(event.currentTarget)}
          aria-label={t('achievements.openOverview')}
          className="block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.055]"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
              <Trophy size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">
                {t('achievements.title')}
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold text-white">
                {t('achievements.progress', {
                  unlocked: snapshot.unlocked,
                  total: snapshot.total
                })}
              </p>
            </div>
            <span className="text-lg font-black tabular-nums text-white">{percent}%</span>
            <ChevronUp size={16} className="shrink-0 text-accent" />
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
            />
          </div>
          <p className="mt-2 truncate text-[10px] text-white/38">
            {t('achievements.openOverview')}
          </p>
        </button>
      )}
    </section>
  )
}

function TimeCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 py-2.5">
      <p className="mb-1.5 text-[11px] font-medium text-white/55">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  )
}
