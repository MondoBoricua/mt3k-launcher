import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import Store from 'electron-store'
import {
  IPC,
  type RetroEmulatorInstallInput,
  type RetroEmulatorInstallResult,
  type CustomGameCommitInput,
  type CustomGameDraft,
  type CustomGameImportSource,
  type CustomGameSaveSource,
  type GameAchievementsSnapshot,
  type GameCompletionTimes,
  type GameLaunchStatus,
  type GameMetadataSyncResult,
  type GameMetadataUpdateInput,
  type LibraryGame,
  type LibrarySnapshot,
  type LibraryStats,
  type LocalGameBackupResult,
  type LocalGameBackupEntry,
  type LocalGameRestoreResult,
  type RetroLibraryResult,
  type RetroLibraryStatus,
  type RetroEmulatorDownloadInput,
  type RetroEmulatorDownloadResult,
  type RetroSystemDirectoryResult,
  type RetroSystemId
} from '@shared/ipc'
import { completionTimesService } from '../completionTimes'
import { artworkService } from '../imageCache'
import { epicAuthManager } from '../epic/epicAuth'
import { epicLibraryService } from '../epic/epicLibrary'
import { steamAuthManager } from '../steam/steamAuth'
import { steamLibraryService } from '../steam/steamLibrary'
import { syncCoordinator } from '../sync/syncCoordinator'
import { gameRepository } from './gameRepository'
import { achievementService } from '../achievements/achievementService'
import { settingsStore } from '../settingsStore'
import { xboxLibraryService } from '../xbox/xboxLibrary'
import { playStationAuthManager } from '../playstation/playstationAuth'
import { playStationLibraryService } from '../playstation/playstationLibrary'
import { storeService } from '../store/storeService'
import { customLibraryService } from '../customLibrary'
import { listLocalGameBackups, restoreLocalGameBackup } from '../saveRestoreService'
import { customArtworkService } from '../customArtwork'
import { projectLibraryVisibility } from '@shared/libraryVisibility'
import { retroLibraryService } from '../retro/retroLibrary'
import { retroSetupService } from '../retro/retroSetup'
import { gogLibraryService } from '../gog/gogLibrary'
import { eaLibraryService } from '../ea/eaLibrary'
import { ubisoftLibraryService } from '../ubisoft/ubisoftLibrary'
import type {
  InstalledLibraryProvider,
  InstalledLibraryRefreshTarget
} from './libraryRefreshScheduler'
import {
  STARTUP_FULL_LIBRARY_SYNC_DELAY_MS,
  shouldScheduleFullLibrarySync
} from '@shared/libraryStartupSync'

const MAX_EXCLUDED_GAME_IDS = 10_000
const STARTUP_INSTALLED_LIBRARY_TARGETS: readonly InstalledLibraryRefreshTarget[] = [
  { provider: 'steam' },
  { provider: 'epic' },
  { provider: 'xbox' },
  { provider: 'gog' },
  { provider: 'ea' },
  { provider: 'ubisoft' }
]

const librarySyncState = new Store<{ lastFullSyncAt?: number }>({
  name: 'library-sync-state'
})

function yieldToMainLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function validExcludedGameIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter(
        (gameId): gameId is string =>
          typeof gameId === 'string' && Boolean(gameId.trim()) && gameId.length <= 512
      )
    )
  ].slice(0, MAX_EXCLUDED_GAME_IDS)
}

/** Coordinates every store into one cache and one three-pipeline sync session. */
export class UnifiedLibraryService extends EventEmitter {
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private startupRefreshInFlight: Promise<LibrarySnapshot> | null = null
  private scheduledFullRefreshTimer: ReturnType<typeof setTimeout> | undefined
  private snapshotEmitTimer: ReturnType<typeof setTimeout> | undefined
  private playtimeSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private performanceResumeWaiters = new Set<() => void>()
  private backgroundEnrichmentPaused = false
  private backgroundEnrichmentPending = false

  constructor() {
    super()
    steamLibraryService.on('updated', () => this.emitSnapshot())
    epicLibraryService.on('updated', () => this.emitSnapshot())
    xboxLibraryService.on('updated', () => this.emitSnapshot())
    playStationLibraryService.on('updated', () => this.emitSnapshot())
    gogLibraryService.on('updated', () => this.emitSnapshot())
    eaLibraryService.on('updated', () => this.emitSnapshot())
    ubisoftLibraryService.on('updated', () => this.emitSnapshot())
  }

  hydrateFromDisk(legacySteamId?: string): void {
    gameRepository.openProfile(legacySteamId)
  }

  getSnapshot(): LibrarySnapshot {
    const snapshot = gameRepository.getSnapshot()
    const excludedGameIds = this.getExcludedGameIds()
    // Repository games/providerGames currently share one user-visible projection.
    // Process it once, while preserving the separate path if the repository ever
    // introduces a genuinely different provider projection again.
    const games = projectLibraryVisibility(snapshot.games, excludedGameIds)
    const sharesProviderProjection = snapshot.providerGames === snapshot.games
    const providerGames = sharesProviderProjection
      ? games
      : projectLibraryVisibility(snapshot.providerGames, excludedGameIds)
    const excludedGames = sharesProviderProjection
      ? games.excludedGames
      : [
          ...new Map(
            [...providerGames.excludedGames, ...games.excludedGames].map((game) => [game.id, game])
          ).values()
        ]
    const visibleGames = games.visibleGames
    const visibleProviderGames = sharesProviderProjection
      ? visibleGames
      : providerGames.visibleGames
    const visibleIds = new Set(visibleGames.map((game) => game.id))
    const recentGameIds = snapshot.recentGameIds.filter((gameId) => visibleIds.has(gameId))
    const visibleGamesById = new Map(visibleGames.map((game) => [game.id, game]))
    const currentContinueGameId = snapshot.activity?.continueGameId
    const continueGameId =
      currentContinueGameId && visibleIds.has(currentContinueGameId)
        ? currentContinueGameId
        : recentGameIds.find((gameId) => visibleGamesById.get(gameId)?.installed)

    return {
      ...snapshot,
      games: visibleGames,
      providerGames: visibleProviderGames,
      excludedGames,
      recentGameIds,
      activity: snapshot.activity
        ? { ...snapshot.activity, continueGameId }
        : undefined,
      providerStatuses: [
        steamLibraryService.getProviderStatus(),
        epicLibraryService.getProviderStatus(),
        gogLibraryService.getProviderStatus(),
        xboxLibraryService.getProviderStatus(),
        playStationLibraryService.getProviderStatus(),
        retroLibraryService.getProviderStatus(),
        eaLibraryService.getProviderStatus(),
        ubisoftLibraryService.getProviderStatus()
      ]
    }
  }

  getGame(gameId: string): LibraryGame | undefined {
    return gameRepository.getGame(gameId)
  }

  setGameExcluded(gameId: string, excluded: boolean): LibrarySnapshot {
    if (excluded && !gameRepository.getGame(gameId)) {
      throw new Error('Library game is not available')
    }

    const current = this.getExcludedGameIds()
    const alreadyExcluded = current.includes(gameId)
    if (excluded === alreadyExcluded) return this.getSnapshot()
    if (excluded && current.length >= MAX_EXCLUDED_GAME_IDS) {
      throw new Error('Excluded game limit reached')
    }

    const next = excluded
      ? [...current, gameId]
      : current.filter((candidate) => candidate !== gameId)
    settingsStore.set('excludedGameIds', next)
    const snapshot = this.getSnapshot()
    this.emitSnapshot()
    return snapshot
  }

  getStats(): LibraryStats {
    const games = this.getSnapshot().games
    const mostPlayed = [...games].sort(
      (a, b) => (b.playtimeMinutes ?? 0) - (a.playtimeMinutes ?? 0)
    )[0]
    const achievements = achievementService.aggregate(games.map((game) => game.id))
    return {
      gameCount: games.length,
      installedCount: games.filter((game) => game.installed).length,
      totalPlaytimeMinutes: games.reduce(
        (total, game) => total + (game.playtimeMinutes ?? 0),
        0
      ),
      mostPlayedGameName:
        mostPlayed && (mostPlayed.playtimeMinutes ?? 0) > 0 ? mostPlayed.name : undefined,
      mostPlayedMinutes: mostPlayed?.playtimeMinutes,
      achievementsUnlocked: achievements.unlocked,
      achievementsTotal: achievements.total
    }
  }

  refresh(): Promise<LibrarySnapshot> {
    return this.startFullRefresh(false)
  }

  private startFullRefresh(deferForGamePerformance: boolean): Promise<LibrarySnapshot> {
    this.cancelScheduledFullRefresh()
    if (this.refreshInFlight) return this.refreshInFlight

    const startupRefresh = this.startupRefreshInFlight
    const refresh = (async (): Promise<LibrarySnapshot> => {
      if (startupRefresh) await startupRefresh.catch(() => undefined)
      return this.doRefresh(deferForGamePerformance)
    })().finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null
    })
    this.refreshInFlight = refresh
    return refresh
  }

  /** Reconciles cheap local install evidence after the first interactive
   * frame. Remote libraries and broad enrichment stay on the stale/manual
   * full-sync path so normal startup does not repeat onboarding work. */
  refreshStartup(): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    if (this.startupRefreshInFlight) return this.startupRefreshInFlight

    syncCoordinator.beginSession()
    const refresh = this.refreshInstalledProviders(STARTUP_INSTALLED_LIBRARY_TARGETS)
      .then((snapshot) => {
        this.emitSnapshot()
        this.scheduleFullRefreshIfStale()
        return snapshot
      })
      .finally(() => {
        if (this.startupRefreshInFlight === refresh) this.startupRefreshInFlight = null
      })
    this.startupRefreshInFlight = refresh
    return refresh
  }

  /** Refreshes only local installation evidence for lifecycle-triggered
   * updates and the lightweight startup reconciliation. */
  async refreshInstalledProviders(
    targets: readonly InstalledLibraryRefreshTarget[]
  ): Promise<LibrarySnapshot> {
    const grouped = new Map<InstalledLibraryProvider, Set<string> | null>()
    for (const target of targets) {
      const providerGameId = target.providerGameId?.trim()
      const current = grouped.get(target.provider)
      if (!providerGameId) {
        grouped.set(target.provider, null)
      } else if (current !== null) {
        const ids = current ?? new Set<string>()
        ids.add(providerGameId)
        grouped.set(target.provider, ids)
      }
    }

    const refreshes: Promise<unknown>[] = []
    for (const [provider, providerGameIds] of grouped) {
      const ids = providerGameIds ? [...providerGameIds] : undefined
      if (provider === 'steam') refreshes.push(steamLibraryService.refreshInstalledGames(ids))
      else if (provider === 'epic') refreshes.push(epicLibraryService.refreshInstalledGames(ids))
      else if (provider === 'xbox') refreshes.push(xboxLibraryService.refreshInstalledGames(ids))
      else if (provider === 'gog') refreshes.push(gogLibraryService.refreshInstalledGames())
      else if (provider === 'ea') refreshes.push(eaLibraryService.refreshInstalledGames())
      else if (provider === 'ubisoft') {
        refreshes.push(ubisoftLibraryService.refreshInstalledGames())
      }
    }
    await Promise.allSettled(refreshes)
    return this.getSnapshot()
  }

  setBackgroundEnrichmentPaused(paused: boolean): void {
    if (this.backgroundEnrichmentPaused === paused) return
    this.backgroundEnrichmentPaused = paused
    if (!paused) {
      for (const resume of this.performanceResumeWaiters) resume()
      this.performanceResumeWaiters.clear()
      if (this.backgroundEnrichmentPending) this.startBackgroundEnrichment()
    }
  }

  dispose(): void {
    this.cancelScheduledFullRefresh()
    if (this.snapshotEmitTimer) clearTimeout(this.snapshotEmitTimer)
    this.snapshotEmitTimer = undefined
    for (const timer of this.playtimeSyncTimers.values()) clearTimeout(timer)
    this.playtimeSyncTimers.clear()
    for (const resume of this.performanceResumeWaiters) resume()
    this.performanceResumeWaiters.clear()
  }

  async resolveCompletionTimes(gameId: string): Promise<GameCompletionTimes | null> {
    const game = gameRepository.getGame(gameId)
    if (!game) return null
    const completionTimes = await completionTimesService.resolve(game)
    if (completionTimes) {
      const changed = gameRepository.applyEnrichmentDelta(
        gameId,
        { completionTimes },
        completionTimes.fetchedAt
      )
      if (changed) this.emitSnapshot()
    }
    return completionTimes
  }

  async resolveAchievements(
    gameId: string,
    force = false
  ): Promise<GameAchievementsSnapshot | null> {
    const game = gameRepository.getGame(gameId)
    if (!game || !settingsStore.store.showAchievements) return null
    return achievementService.resolve(game, force)
  }

  syncAchievements(forceUnavailable = false): Promise<void> {
    return achievementService.sync(this.getSnapshot().games, forceUnavailable)
  }

  markGameStarted(gameId: string, startedAt?: number, source: 'local' | 'geforce-now' = 'local'): void {
    if (gameRepository.markStarted(gameId, startedAt, source)) this.emitSnapshot()
  }

  recordGameSession(
    gameId: string,
    durationSeconds: number,
    endedAt: number
  ): { totalPlaytimeSeconds?: number } | undefined {
    const game = gameRepository.getGame(gameId)
    if (!game || !gameRepository.recordGameSession(gameId, durationSeconds, endedAt)) return undefined
    this.emitSnapshot()

    const result = { totalPlaytimeSeconds: gameRepository.getGame(gameId)?.playtimeSeconds }

    const existingTimer = this.playtimeSyncTimers.get(gameId)
    if (existingTimer) clearTimeout(existingTimer)
    if ((game.provider !== 'steam' || !game.appId) && game.provider !== 'epic') return result

    // Give the store client a short window to publish its final total. ORBIT's
    // local seconds remain visible immediately and are reconciled in-place.
    const timer = setTimeout(() => {
      this.playtimeSyncTimers.delete(gameId)
      if (game.provider === 'steam' && game.appId) {
        void steamLibraryService.refreshPlaytime(steamAuthManager, game.appId)
      } else if (game.provider === 'epic') {
        void epicLibraryService.refreshPlaytime(epicAuthManager, game.providerGameId)
      }
    }, 3_000)
    timer.unref()
    this.playtimeSyncTimers.set(gameId, timer)
    return result
  }

  beginCustomGameImport(
    mainWindow: BrowserWindow,
    source: CustomGameImportSource
  ): Promise<CustomGameDraft | null> {
    return customLibraryService.beginImport(mainWindow, source)
  }

  selectCustomGameArtwork(
    mainWindow: BrowserWindow,
    draftId: string
  ): Promise<CustomGameDraft | null> {
    return customLibraryService.selectArtwork(mainWindow, draftId)
  }

  selectCustomGameSave(
    mainWindow: BrowserWindow,
    draftId: string,
    source: CustomGameSaveSource
  ): Promise<CustomGameDraft | null> {
    return customLibraryService.selectSave(mainWindow, draftId, source)
  }

  clearCustomGameSave(draftId: string): CustomGameDraft {
    return customLibraryService.clearSave(draftId)
  }

  cancelCustomGameImport(draftId: string): void {
    customLibraryService.cancel(draftId)
  }

  async commitCustomGame(input: CustomGameCommitInput): Promise<LibrarySnapshot> {
    const record = await customLibraryService.commit(
      input.draftId,
      input.name,
      input.launchArguments
    )
    const game = gameRepository.upsertLocalGame(record)
    artworkService.syncProvider([game], 'local')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  updateCustomGameLaunchArguments(
    gameId: string,
    launchArguments: readonly string[]
  ): LibrarySnapshot {
    if (!gameRepository.updateLocalGameLaunchArguments(gameId, launchArguments)) {
      throw new Error('Custom game is not available')
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async removeCustomGame(gameId: string): Promise<LibrarySnapshot> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    await Promise.all([
      customArtworkService.reset(gameId, 'vertical'),
      customArtworkService.reset(gameId, 'horizontal'),
      customArtworkService.reset(gameId, 'logo'),
      customArtworkService.reset(gameId, 'icon')
    ])
    if (!gameRepository.removeLocalGame(gameId)) throw new Error('Custom game is not available')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  async backupCustomGame(gameId: string): Promise<LocalGameBackupResult> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    const result = await customLibraryService.backup(game)
    if (gameRepository.recordLocalBackup(gameId, result)) this.emitSnapshot()
    return result
  }

  async openCustomGameBackups(gameId: string): Promise<void> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    await customLibraryService.openBackupDirectory(game)
  }

  listCustomGameBackups(gameId: string): Promise<LocalGameBackupEntry[]> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    return listLocalGameBackups(game)
  }

  restoreCustomGameBackup(
    gameId: string,
    backupId: string,
    launchStatus: GameLaunchStatus
  ): Promise<LocalGameRestoreResult> {
    const game = gameRepository.getGame(gameId)
    if (!game || game.provider !== 'local') throw new Error('Custom game is not available')
    return restoreLocalGameBackup(game, backupId, launchStatus, customLibraryService)
  }

  getRetroLibraryStatus(): RetroLibraryStatus {
    return retroLibraryService.getStatus()
  }

  async refreshRetroLibrary(): Promise<RetroLibraryResult> {
    const status = await retroLibraryService.refresh()
    artworkService.syncProvider(gameRepository.getGamesByProvider('retro'), 'retro')
    this.emitSnapshot()
    return { snapshot: this.getSnapshot(), status }
  }

  async addRetroLibraryDirectory(mainWindow: BrowserWindow): Promise<RetroLibraryResult | null> {
    const status = await retroLibraryService.addDirectory(mainWindow)
    if (!status) return null
    artworkService.syncProvider(gameRepository.getGamesByProvider('retro'), 'retro')
    this.emitSnapshot()
    return { snapshot: this.getSnapshot(), status }
  }

  async removeRetroLibraryDirectory(directory: string): Promise<RetroLibraryResult> {
    const status = await retroLibraryService.removeDirectory(directory)
    this.emitSnapshot()
    return { snapshot: this.getSnapshot(), status }
  }

  ensureRetroSystemDirectory(systemId: RetroSystemId): Promise<RetroSystemDirectoryResult> {
    return retroSetupService.ensureSystemDirectory(systemId)
  }

  async openRetroSystemDirectory(
    mainWindow: BrowserWindow,
    systemId: RetroSystemId
  ): Promise<RetroSystemDirectoryResult> {
    const result = await retroSetupService.openSystemDirectory(systemId)
    const refreshOnReturn = (): void => {
      clearTimeout(cleanupTimer)
      const timer = setTimeout(() => {
        if (!mainWindow.isDestroyed()) void this.refreshRetroLibrary().catch(() => undefined)
      }, 700)
      timer.unref()
    }
    mainWindow.once('focus', refreshOnReturn)
    const cleanupTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.removeListener('focus', refreshOnReturn)
    }, 10 * 60 * 1_000)
    cleanupTimer.unref()
    return result
  }

  openRetroEmulatorDownload(
    input: RetroEmulatorDownloadInput
  ): Promise<RetroEmulatorDownloadResult> {
    return retroSetupService.openEmulatorDownload(input.systemId, input.emulatorId)
  }

  async installRetroEmulator(
    mainWindow: BrowserWindow,
    input: RetroEmulatorInstallInput
  ): Promise<RetroEmulatorInstallResult> {
    const result = await retroSetupService.installEmulator(
      input.systemId,
      input.emulatorId,
      (progress) => {
        if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send(IPC.retroEmulatorInstallProgress, progress)
        }
      }
    )
    artworkService.syncProvider(gameRepository.getGamesByProvider('retro'), 'retro')
    this.emitSnapshot()
    return { ...result, snapshot: this.getSnapshot() }
  }

  cancelRetroEmulatorInstall(): boolean {
    return retroSetupService.cancelEmulatorInstall()
  }

  updateRetroGameLaunchArguments(
    gameId: string,
    launchArguments: readonly string[]
  ): LibrarySnapshot {
    if (!gameRepository.updateRetroGameLaunchArguments(gameId, launchArguments)) {
      throw new Error('Retro game is not available')
    }
    this.emitSnapshot()
    return this.getSnapshot()
  }

  updateGameMetadata(input: GameMetadataUpdateInput): LibrarySnapshot {
    if (!gameRepository.getGame(input.gameId)) throw new Error('Game is not available')
    if (gameRepository.updateGameMetadata(input)) {
      const game = gameRepository.getGame(input.gameId)
      if (game) artworkService.syncProvider([game], game.provider)
      this.emitSnapshot()
    }
    return this.getSnapshot()
  }

  async syncGameMetadata(gameId: string): Promise<GameMetadataSyncResult> {
    const initial = gameRepository.getGame(gameId)
    if (!initial) throw new Error('Game is not available')
    const stages: GameMetadataSyncResult['stages'] = {
      library: 'skipped',
      metadata: 'skipped',
      artwork: 'queued',
      completionTimes: 'skipped',
      achievements: 'skipped'
    }

    if (
      initial.provider === 'steam' ||
      initial.provider === 'epic' ||
      initial.provider === 'xbox'
    ) {
      try {
        await this.refreshInstalledProviders([
          { provider: initial.provider, providerGameId: initial.providerGameId }
        ])
        stages.library = 'complete'
      } catch {
        stages.library = 'failed'
      }
    }

    if (initial.provider === 'steam' && initial.appId) {
      try {
        stages.metadata = (await steamLibraryService.refreshMetadata(initial.appId))
          ? 'complete'
          : 'failed'
      } catch {
        stages.metadata = 'failed'
      }
    }

    let current = gameRepository.getGame(gameId)
    if (!current) throw new Error('Game is no longer available')
    artworkService.syncProvider([current], current.provider)

    const enrichmentTasks: Promise<void>[] = []
    enrichmentTasks.push(
      completionTimesService.resolve(current, true).then((completionTimes) => {
        if (!completionTimes) {
          stages.completionTimes = 'failed'
          return
        }
        stages.completionTimes = 'complete'
        gameRepository.applyEnrichmentDelta(gameId, { completionTimes }, completionTimes.fetchedAt)
      }).catch(() => {
        stages.completionTimes = 'failed'
      })
    )

    if (
      settingsStore.store.showAchievements &&
      (current.provider === 'steam' || current.provider === 'retro' || current.provider === 'xbox')
    ) {
      enrichmentTasks.push(
        achievementService.resolve(current, true).then(() => {
          stages.achievements = 'complete'
        }).catch(() => {
          stages.achievements = 'failed'
        })
      )
    }
    await Promise.all(enrichmentTasks)
    current = gameRepository.getGame(gameId) ?? current
    artworkService.syncProvider([current], current.provider)
    this.emitSnapshot()
    return { snapshot: this.getSnapshot(), synchronizedAt: Date.now(), stages }
  }

  private async doRefresh(deferForGamePerformance: boolean): Promise<LibrarySnapshot> {
    const steamAccount = steamAuthManager.getAccount() ?? (await steamAuthManager.restoreSession())
    gameRepository.openProfile(steamAccount?.steamId)
    syncCoordinator.beginSession()
    artworkService.beginSyncSession()
    const batches: ReadonlyArray<ReadonlyArray<() => Promise<unknown>>> = [
      [
        () => steamLibraryService.refresh(steamAuthManager),
        () => epicLibraryService.refresh(epicAuthManager)
      ],
      [
        () => xboxLibraryService.refresh(),
        () => playStationLibraryService.refresh(playStationAuthManager)
      ],
      // These adapters intentionally overlap: all three share one in-flight
      // Windows registry discovery instead of spawning three PowerShell scans.
      [
        () => gogLibraryService.refresh(),
        () => eaLibraryService.refresh(),
        () => ubisoftLibraryService.refresh()
      ],
      [() => retroLibraryService.refresh()]
    ]
    for (const [index, batch] of batches.entries()) {
      if (deferForGamePerformance) await this.waitForGamePerformanceWindow()
      await Promise.allSettled(batch.map((run) => run()))
      if (index < batches.length - 1) await yieldToMainLoop()
    }

    librarySyncState.set('lastFullSyncAt', Date.now())

    this.startBackgroundEnrichment()
    this.emitSnapshot()
    return this.getSnapshot()
  }

  private startBackgroundEnrichment(): void {
    if (this.backgroundEnrichmentPaused) {
      this.backgroundEnrichmentPending = true
      return
    }
    this.backgroundEnrichmentPending = false
    for (const provider of [
      'steam',
      'epic',
      'gog',
      'xbox',
      'playstation',
      'ea',
      'ubisoft',
      'local',
      'retro'
    ] as const) {
      artworkService.syncProvider(gameRepository.getGamesByProvider(provider), provider)
    }
    const startupTasks: Promise<unknown>[] = [
      achievementService.syncStartup(this.getSnapshot().games)
    ]
    // Steam's authenticated session also powers the wishlist import. Start it
    // with achievements as soon as the library delta is stable so Home has its
    // wishlist offers before the user leaves onboarding.
    if (steamAuthManager.getAccount()) startupTasks.push(storeService.refresh())
    void Promise.allSettled(startupTasks)
  }

  private scheduleFullRefreshIfStale(): void {
    if (
      this.scheduledFullRefreshTimer ||
      this.refreshInFlight ||
      !shouldScheduleFullLibrarySync(librarySyncState.get('lastFullSyncAt'))
    ) {
      return
    }

    this.scheduledFullRefreshTimer = setTimeout(() => {
      this.scheduledFullRefreshTimer = undefined
      if (this.backgroundEnrichmentPaused) {
        this.scheduleFullRefreshIfStale()
        return
      }
      void this.startFullRefresh(true).catch((error) => {
        console.warn('[library] Deferred full synchronization failed:', error)
      })
    }, STARTUP_FULL_LIBRARY_SYNC_DELAY_MS)
    this.scheduledFullRefreshTimer.unref()
  }

  private cancelScheduledFullRefresh(): void {
    if (this.scheduledFullRefreshTimer) clearTimeout(this.scheduledFullRefreshTimer)
    this.scheduledFullRefreshTimer = undefined
  }

  private waitForGamePerformanceWindow(): Promise<void> {
    if (!this.backgroundEnrichmentPaused) return Promise.resolve()
    return new Promise((resolve) => this.performanceResumeWaiters.add(resolve))
  }

  private getExcludedGameIds(): string[] {
    return validExcludedGameIds(settingsStore.store.excludedGameIds)
  }

  private emitSnapshot(): void {
    if (this.snapshotEmitTimer) return
    this.snapshotEmitTimer = setTimeout(() => {
      this.snapshotEmitTimer = undefined
      this.emit('updated', this.getSnapshot())
    }, 120)
    this.snapshotEmitTimer.unref()
  }
}

export const libraryService = new UnifiedLibraryService()
