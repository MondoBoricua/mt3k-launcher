import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'node:fs'
import { app } from 'electron'
import type {
  GameCompletionTimes,
  LibraryAccessKind,
  LibraryDetectionMethod,
  LibraryProviderIssue,
  LibraryProviderStatus,
  LibrarySnapshot
} from '@shared/ipc'
import { canPruneSteamOwnedRecords, decideSteamSyncHealth } from '@shared/steamSyncPolicy'
import { classifySteamSessionAccess } from '@shared/steamLibraryAccess'
import { isConfirmedNonGameSteamAppType } from '@shared/libraryContentPolicy'
import type { SteamAuthManager } from './steamAuth'
import { settingsStore } from '../settingsStore'
import { gameRepository } from '../library/gameRepository'
import {
  getSteamAppsDirectories,
  scanInstalledSteamAppsSnapshot,
  scanSteamLocalActivity,
  type InstalledSteamApp
} from './steamInstall'
import {
  fetchDynamicStoreData,
  fetchSteamCommunityGames,
  fetchOwnedGamesWithToken,
  fetchSteamClientGames,
  getSteamUserToken,
  type SteamOwnedGame,
  type SteamUserToken
} from './steamWebService'
import {
  steamMetadataService,
  type MetadataSyncTarget,
  type SteamAppMetadata
} from './steamMetadata'
import { artworkService } from '../imageCache'
import { syncCoordinator } from '../sync/syncCoordinator'
import type { LibraryProviderAdapter } from '../library/libraryProvider'
import { completionTimesService } from '../completionTimes'

const STEAM_API_LANGUAGE: Record<string, string> = { en: 'english', de: 'german', es: 'spanish' }
const LOCAL_MANIFEST_SETTLE_MS = 900

type SteamSyncSource =
  | 'store-token'
  | 'owned-games'
  | 'client-app-list'
  | 'community'
  | 'dynamic-store'

function steamSourceFailureKind(error: unknown): string {
  const message = error instanceof Error ? error.message.toLocaleLowerCase('en') : ''
  if (/abort|timeout/.test(message)) return 'timeout'
  if (/session|login|token|another account/.test(message)) return 'session'
  if (/\(\d{3}\)/.test(message)) return 'http'
  if (/returned|response|payload|parse|json|not present/.test(message)) return 'invalid-response'
  if (error instanceof TypeError) return 'network'
  return 'unknown'
}

/** Deliberately excludes raw errors, URLs, tokens, account IDs and game data. */
function reportSteamSourceFailure(source: SteamSyncSource, error: unknown): void {
  console.warn(`[steam-sync] ${source} unavailable (${steamSourceFailureKind(error)})`)
}

interface MetadataUpdate {
  metadata: SteamAppMetadata
  allowCreate: boolean
  libraryAccess?: LibraryAccessKind
}

function localInstallFingerprint(installed: Iterable<InstalledSteamApp>): string {
  return [...installed]
    .sort((left, right) => left.appId - right.appId)
    .map((game) => `${game.appId}:${game.updateAvailable ? 1 : 0}:${game.installDir}:${game.name}`)
    .join('\n')
}

/**
 * Aggregates Steam's sources in Playnite's order and publishes only snapshots
 * from the persistent keyed repository. Source failures never replace a good
 * cached library with an empty list.
 */
export class SteamLibraryService extends EventEmitter implements LibraryProviderAdapter<SteamAuthManager> {
  readonly provider = 'steam' as const
  private refreshInFlight: Promise<LibrarySnapshot> | null = null
  private pendingMetadataIds = new Set<number>()
  private localManifestWatchers: FSWatcher[] = []
  private localManifestTimer: ReturnType<typeof setTimeout> | undefined
  private localInstallState = ''
  private watchedSteamId?: string
  private synchronizedSourceIssue?: Extract<
    LibraryProviderIssue,
    'supplemental-source-unavailable' | 'local-source-unavailable'
  >
  private providerStatus: LibraryProviderStatus = {
    provider: 'steam',
    state: 'idle',
    connection: 'not-connected',
    methods: [],
    gameCount: 0,
    installedCount: 0,
    installableCount: 0
  }

  constructor() {
    super()
    steamMetadataService.on('busy', () => {
      gameRepository.setMetadataLoading('steam', true)
      this.emitSnapshot()
    })
    steamMetadataService.on(
      'updated',
      ({ metadata, allowCreate, libraryAccess }: MetadataUpdate) => {
        const wasPending = this.pendingMetadataIds.has(metadata.appId)
        if (metadata.type !== 'game') {
          const removed =
            isConfirmedNonGameSteamAppType(metadata.type) &&
            gameRepository.removeProviderContent('steam', String(metadata.appId))
          if (wasPending) this.resolvePendingMetadata(metadata.appId)
          else if (removed) this.emitSnapshot()
          return
        }
        const changed = gameRepository.applyMetadataDelta(
          metadata,
          Boolean(allowCreate && wasPending),
          libraryAccess
        )
        const game = gameRepository
          .getGamesByProvider('steam')
          .find((candidate) => candidate.id === `steam:${metadata.appId}`)
        if (wasPending && game) this.resolvePendingMetadata(metadata.appId)
        if (!changed) return
        if (game) artworkService.syncProvider([game], 'steam')
        this.emitSnapshot()
      }
    )
    steamMetadataService.on('idle', () => {
      gameRepository.setMetadataLoading('steam', false)
      if (
        this.providerStatus.issue === 'metadata-pending' &&
        this.pendingMetadataIds.size > 0
      ) {
        this.setProviderStatus({
          state: 'partial',
          connection: 'connected',
          methods: this.providerStatus.methods,
          pendingCount: this.pendingMetadataIds.size,
          issue: 'source-unavailable',
          lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
        })
        return
      }
      this.emitSnapshot()
    })
  }

  hydrateFromDiskIfEmpty(steamId?: string): void {
    gameRepository.openProfile(steamId)
  }

  getSnapshot(): LibrarySnapshot {
    return gameRepository.getSnapshot()
  }

  getProviderStatus(): LibraryProviderStatus {
    return {
      ...this.providerStatus,
      ...gameRepository.getProviderCounts('steam'),
      methods: [...this.providerStatus.methods]
    }
  }

  getGame(gameId: string) {
    return gameRepository.getGame(gameId)
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

  markGameStarted(gameId: string): void {
    if (gameRepository.markStarted(gameId)) this.emitSnapshot()
  }

  /** Reconciles one finished session without starting a full metadata/artwork sync. */
  async refreshPlaytime(auth: SteamAuthManager, appId: number): Promise<boolean> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    if (!account || !Number.isInteger(appId) || appId <= 0) return false
    const language = STEAM_API_LANGUAGE[settingsStore.get('language')] ?? 'english'
    const sessionFetch = (url: string | URL, init?: RequestInit): Promise<Response> =>
      auth.fetchAuthenticated(url, init)
    let synchronized = false
    const localActivity = scanSteamLocalActivity(account.steamId).get(appId)
    if (localActivity) {
      const changed = gameRepository.applyProviderActivityDelta('steam', [
        {
          providerGameId: String(appId),
          playtimeSeconds: localActivity.playtimeSeconds,
          lastPlayedTimestamp: localActivity.lastPlayedTimestamp
        }
      ])
      if (changed > 0) this.emitSnapshot()
      synchronized = localActivity.playtimeSeconds !== undefined
    }

    let game
    try {
      const token = await getSteamUserToken(account.steamId, sessionFetch)
      game = (await fetchOwnedGamesWithToken(token, language)).get(appId)
    } catch {
      try {
        game = (await fetchSteamCommunityGames(account.steamId, sessionFetch)).get(appId)
      } catch {
        return synchronized
      }
    }
    if (!game || game.playtimeSeconds === undefined) return synchronized
    const changed = gameRepository.applyProviderPlaytimeDelta(
      'steam',
      String(appId),
      game.playtimeSeconds,
      game.lastPlayedTimestamp
    )
    if (changed) this.emitSnapshot()
    return true
  }

  refreshMetadata(appId: number): Promise<boolean> {
    const language = STEAM_API_LANGUAGE[settingsStore.get('language')] ?? 'english'
    return steamMetadataService.refreshGame(appId, language)
  }

  /** Reconciles newly installed Steam manifests without repeating account,
   * wishlist or full-library metadata requests. */
  async refreshInstalledGames(providerGameIds?: readonly string[]): Promise<LibrarySnapshot> {
    const activeRefresh = this.refreshInFlight
    if (activeRefresh) await activeRefresh.catch(() => undefined)

    const requestedAppIds = providerGameIds
      ? new Set(
          providerGameIds
            .map((providerGameId) => Number(providerGameId))
            .filter((appId) => Number.isInteger(appId) && appId > 0)
        )
      : undefined
    syncCoordinator.begin('library', 1, 0, 'steam-local', 'steam')
    const installedSnapshot = scanInstalledSteamAppsSnapshot(this.watchedSteamId)
    const installed = [...installedSnapshot.games.values()].filter(
      (game) => !requestedAppIds || requestedAppIds.has(game.appId)
    )
    const changedInstalled = installed.filter((game) => {
      const existing = gameRepository.getGame(`steam:${game.appId}`)
      return (
        !existing?.installed ||
        existing.installDir !== game.installDir ||
        existing.name !== game.name ||
        Boolean(existing.updateAvailable) !== game.updateAvailable
      )
    })
    if (changedInstalled.length > 0) {
      gameRepository.applyInstalledProviderPatch(
        'steam',
        changedInstalled.map((game) => ({
          providerGameId: String(game.appId),
          appId: game.appId,
          name: game.name,
          installDir: game.installDir,
          updateAvailable: game.updateAvailable,
          playtimeSeconds: game.playtimeSeconds,
          lastPlayedTimestamp: game.lastPlayedTimestamp
        }))
      )
    }

    const games = changedInstalled
      .map((game) => gameRepository.getGame(`steam:${game.appId}`))
      .filter((game): game is NonNullable<typeof game> => Boolean(game))
    if (games.length > 0) {
      artworkService.syncProvider(games, 'steam')
      steamMetadataService.syncLibrary(
        changedInstalled.map((game) => ({ appId: game.appId, allowCreate: false })),
        STEAM_API_LANGUAGE[settingsStore.get('language')] ?? 'english'
      )
    }
    if (installedSnapshot.complete) syncCoordinator.complete('library', 'steam-local', 'steam')
    else syncCoordinator.fail('library', 'steam-local', 'steam')
    if (changedInstalled.length > 0) this.emitSnapshot()
    return this.getSnapshot()
  }

  async refresh(auth: SteamAuthManager): Promise<LibrarySnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.doRefresh(auth)
    try {
      return await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
    }
  }

  private async doRefresh(auth: SteamAuthManager): Promise<LibrarySnapshot> {
    const account = auth.getAccount() ?? (await auth.restoreSession())
    syncCoordinator.begin('library', account ? 3 : 1, 0, 'steam-local', 'steam')

    gameRepository.openProfile(account?.steamId)
    this.pendingMetadataIds.clear()
    this.synchronizedSourceIssue = undefined
    this.setProviderStatus({
      state: 'scanning',
      connection: account ? 'connected' : 'not-connected',
      methods: ['local-manifests']
    })

    // Local state is fast, private and authoritative for installation status.
    const installedSnapshot = scanInstalledSteamAppsSnapshot(account?.steamId)
    const installed = installedSnapshot.games
    const localActivity = [...scanSteamLocalActivity(account?.steamId)].map(
      ([appId, activity]) => ({
        providerGameId: String(appId),
        playtimeSeconds: activity.playtimeSeconds,
        lastPlayedTimestamp: activity.lastPlayedTimestamp
      })
    )
    this.localInstallState = localInstallFingerprint(installed.values())
    this.startLocalInstallMonitor(account?.steamId)
    if (installedSnapshot.complete) {
      gameRepository.applyInstalledDelta(installed.values())
    } else {
      gameRepository.applyInstalledProviderPatch(
        'steam',
        [...installed.values()].map((game) => ({
          providerGameId: String(game.appId),
          appId: game.appId,
          name: game.name,
          installDir: game.installDir,
          updateAvailable: game.updateAvailable,
          playtimeSeconds: game.playtimeSeconds,
          lastPlayedTimestamp: game.lastPlayedTimestamp
        }))
      )
    }
    gameRepository.applyProviderActivityDelta('steam', localActivity)
    syncCoordinator.progress('library', 1, account ? 3 : 1, 'steam-account', 'steam')
    artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
    this.emitSnapshot()

    const language = STEAM_API_LANGUAGE[settingsStore.get('language')] ?? 'english'
    if (!account) {
      steamMetadataService.syncLibrary(
        [...installed.keys()].map((appId) => ({ appId, allowCreate: false })),
        language
      )
      syncCoordinator.complete('library', 'steam-local', 'steam')
      this.setProviderStatus({
        state: 'local-only',
        connection: 'not-connected',
        methods: ['local-manifests'],
        issue: 'not-connected',
        lastCheckedAt: Date.now()
      })
      return this.getSnapshot()
    }

    const sessionFetch = (url: string | URL, init?: RequestInit): Promise<Response> =>
      auth.fetchAuthenticated(url, init)

    const cachedByAppId = new Map(
      this.getSnapshot().providerGames.flatMap((game) =>
        game.provider === 'steam' && game.appId ? [[game.appId, game] as const] : []
      )
    )
    const hadCachedOnlineLibrary = [...cachedByAppId.values()].some((game) => !game.installed)
    const methods: LibraryDetectionMethod[] = ['local-manifests']
    const addMethod = (method: LibraryDetectionMethod): void => {
      if (!methods.includes(method)) methods.push(method)
    }
    const metadataByAppId = new Map<
      number,
      { allowCreate: boolean; libraryAccess?: LibraryAccessKind }
    >()
    const addMetadataTarget = (
      appId: number,
      allowCreate: boolean,
      libraryAccess?: LibraryAccessKind
    ): void => {
      const current = metadataByAppId.get(appId)
      metadataByAppId.set(appId, {
        allowCreate: Boolean(current?.allowCreate || allowCreate),
        libraryAccess: libraryAccess ?? current?.libraryAccess
      })
    }
    const mergeOwnedGame = (target: Map<number, SteamOwnedGame>, game: SteamOwnedGame): void => {
      const current = target.get(game.appId)
      target.set(game.appId, {
        ...current,
        ...game,
        name: game.name ?? current?.name
      })
    }
    const dynamicStoreAttempt = Promise.allSettled([fetchDynamicStoreData(sessionFetch)])

    let token: SteamUserToken | undefined
    try {
      // Steam exposes the short-lived token in #application_config on /explore/.
      // It remains in memory and is never persisted or sent anywhere but Steam.
      token = await getSteamUserToken(account.steamId, sessionFetch)
    } catch (error) {
      reportSteamSourceFailure('store-token', error)
      // Community and authenticated Store userdata remain independent fallbacks.
    }

    let authoritativeOwned: Map<number, SteamOwnedGame> | undefined
    const supplementalOwned = new Map<number, SteamOwnedGame>()
    const sharedSessionGames = new Map<number, SteamOwnedGame>()
    let clientGames = new Map<number, { appId: number; name: string }>()
    let clientSourceAvailable = false
    let ownedResponseWasEmpty = false

    if (token) {
      const [ownedAttempt, clientAttempt] = await Promise.allSettled([
        fetchOwnedGamesWithToken(token, language),
        fetchSteamClientGames(token, language)
      ])
      if (ownedAttempt.status === 'fulfilled') {
        ownedResponseWasEmpty = ownedAttempt.value.size === 0
        if (ownedAttempt.value.size > 0) {
          authoritativeOwned = ownedAttempt.value
          addMethod('account-api')
        }
      } else {
        reportSteamSourceFailure('owned-games', ownedAttempt.reason)
      }
      if (clientAttempt.status === 'fulfilled') {
        clientSourceAvailable = true
        clientGames = clientAttempt.value
        if (clientGames.size > 0) addMethod('launcher-session')
      } else {
        reportSteamSourceFailure('client-app-list', clientAttempt.reason)
      }
      syncCoordinator.progress('library', 2, 3, 'steam-client', 'steam')
    } else {
      syncCoordinator.progress('library', 2, 3, 'steam-community', 'steam')
    }

    const authoritativeOwnedAppIds = authoritativeOwned
      ? new Set(authoritativeOwned.keys())
      : undefined
    for (const clientGame of clientGames.values()) {
      const access = classifySteamSessionAccess(clientGame.appId, authoritativeOwnedAppIds)
      mergeOwnedGame(
        access === 'shared' ? sharedSessionGames : (authoritativeOwned ?? supplementalOwned),
        {
          appId: clientGame.appId,
          name: clientGame.name
        }
      )
    }

    if (!authoritativeOwned) {
      try {
        const communityGames = await fetchSteamCommunityGames(account.steamId, sessionFetch)
        if (communityGames.size > 0) {
          addMethod('community-profile')
          for (const game of communityGames.values()) mergeOwnedGame(supplementalOwned, game)
        }
      } catch (error) {
        reportSteamSourceFailure('community', error)
        // A private or unavailable community feed must never prune cached games.
      }
    }

    let dynamicOwnedIds: number[] = []
    let dynamicRecentIds: number[] = []
    let dynamicSourceAvailable = false
    const [dynamicAttempt] = await dynamicStoreAttempt
    if (dynamicAttempt.status === 'fulfilled') {
      const dynamicStore = dynamicAttempt.value
      dynamicSourceAvailable = true
      dynamicOwnedIds = dynamicStore.ownedAppIds
      dynamicRecentIds = dynamicStore.recentlyPlayedAppIds
      if (dynamicOwnedIds.length > 0) addMethod('launcher-session')
    } else {
      reportSteamSourceFailure('dynamic-store', dynamicAttempt.reason)
      // Keep the last good online snapshot when Steam's Store session is unavailable.
    }
    const primaryLibraryAvailable = Boolean(authoritativeOwned)
    const canPruneOwnedRecords = canPruneSteamOwnedRecords(
      primaryLibraryAvailable,
      clientSourceAvailable,
      dynamicSourceAvailable
    )

    if (authoritativeOwned) {
      // Preserve previously verified Store-session games that are still present
      // in the current session while their metadata source catches up.
      for (const appId of dynamicOwnedIds) {
        if (authoritativeOwned.has(appId)) continue
        const cached = cachedByAppId.get(appId)
        if (!cached) continue
        sharedSessionGames.set(appId, {
          appId,
          name: cached.name,
          iconUrl: cached.metadata.iconUrl,
          playtimeSeconds: cached.playtimeSeconds,
          playtimeMinutes: cached.playtimeMinutes,
          lastPlayedTimestamp: cached.lastPlayedTimestamp
        })
      }
      // GetOwnedGames does not necessarily include Family Sharing titles. A
      // mark-and-sweep is safe only after both additive session sources were
      // also structurally available; otherwise keep cached provider records.
      if (canPruneOwnedRecords) {
        gameRepository.applyAuthoritativeOwnedDelta(
          authoritativeOwned.values(),
          sharedSessionGames.values()
        )
      } else {
        gameRepository.applyNonAuthoritativeOwnedDelta(authoritativeOwned.values())
        gameRepository.applyNonAuthoritativeSharedDelta(sharedSessionGames.values())
      }
      for (const appId of authoritativeOwned.keys()) addMetadataTarget(appId, false, 'owned')
      for (const appId of sharedSessionGames.keys()) addMetadataTarget(appId, false, 'shared')
    } else if (supplementalOwned.size > 0) {
      gameRepository.applyNonAuthoritativeUnclassifiedDelta(supplementalOwned.values())
      for (const appId of supplementalOwned.keys()) addMetadataTarget(appId, false)
    }

    const dynamicOwnedAppIds = authoritativeOwned
      ? dynamicOwnedIds.filter((appId) => authoritativeOwned?.has(appId))
      : []
    const dynamicSharedAppIds = authoritativeOwned
      ? dynamicOwnedIds.filter((appId) => !authoritativeOwned?.has(appId))
      : []
    const dynamicUnclassifiedAppIds = authoritativeOwned ? [] : dynamicOwnedIds
    const unresolved = [
      ...gameRepository.applyNonAuthoritativeOwnedIds(dynamicOwnedAppIds, 'owned'),
      ...gameRepository.applyNonAuthoritativeOwnedIds(dynamicSharedAppIds, 'shared'),
      ...gameRepository.applyNonAuthoritativeOwnedIds(dynamicUnclassifiedAppIds)
    ]
    const unresolvedSet = new Set(unresolved)
    for (const appId of dynamicOwnedIds) {
      addMetadataTarget(
        appId,
        unresolvedSet.has(appId),
        classifySteamSessionAccess(appId, authoritativeOwnedAppIds)
      )
    }
    this.synchronizedSourceIssue = !installedSnapshot.complete
      ? 'local-source-unavailable'
      : !clientSourceAvailable || !dynamicSourceAvailable
        ? 'supplemental-source-unavailable'
        : undefined
    gameRepository.applyProviderActivityDelta('steam', localActivity)
    if (dynamicSourceAvailable) gameRepository.setRecentSteamAppIds(dynamicRecentIds)

    // Revalidate retained records as well. This lets cached provider metadata
    // purge DLC/tools left behind by an older or partial client-list sync.
    for (const game of this.getSnapshot().providerGames) {
      if (game.provider === 'steam' && game.appId) {
        addMetadataTarget(game.appId, false, game.libraryAccess)
      }
    }
    let metadataTargets: MetadataSyncTarget[] = [...metadataByAppId].map(
      ([appId, target]) => ({ appId, ...target })
    )
    const librarySucceeded = Boolean(
      authoritativeOwned || supplementalOwned.size > 0 || dynamicOwnedIds.length > 0
    )
    const counts = gameRepository.getProviderCounts('steam')
    if (!canPruneOwnedRecords && hadCachedOnlineLibrary) addMethod('cached-data')
    this.pendingMetadataIds = new Set([
      ...unresolvedSet,
      ...[...metadataByAppId.keys()].filter((appId) => {
        const game = gameRepository.getGame(`steam:${appId}`)
        return !game?.name?.trim()
      })
    ])
    const pendingCount = this.pendingMetadataIds.size
    const health = decideSteamSyncHealth({
      primaryLibraryAvailable,
      fallbackLibraryAvailable: supplementalOwned.size > 0 || dynamicOwnedIds.length > 0,
      cachedGameCount: counts.gameCount,
      pendingMetadataCount: pendingCount,
      ownedResponseWasEmpty,
      supplementalSourcesComplete: clientSourceAvailable && dynamicSourceAvailable,
      localLibraryComplete: installedSnapshot.complete
    })
    this.setProviderStatus({
      state: health.state,
      connection: 'connected',
      methods,
      pendingCount: pendingCount || undefined,
      issue: health.issue,
      lastCheckedAt: Date.now()
    })

    if (librarySucceeded) syncCoordinator.complete('library', 'steam', 'steam')
    else syncCoordinator.fail('library', 'cached-library', 'steam')

    const snapshot = this.getSnapshot()
    if (metadataTargets.length === 0) {
      metadataTargets = snapshot.providerGames
        .filter((game) => game.provider === 'steam')
        .flatMap((game) =>
          Number.isInteger(game.appId)
            ? [
                {
                  appId: game.appId as number,
                  allowCreate: false,
                  libraryAccess: game.libraryAccess
                }
              ]
            : []
        )
    }
    // These two provider-neutral pipelines always run after the game delta,
    // including during onboarding. Fresh records count as completed instantly.
    steamMetadataService.syncLibrary(metadataTargets, language)
    artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
    this.emitSnapshot()
    return this.getSnapshot()
  }

  dispose(): void {
    if (this.localManifestTimer) clearTimeout(this.localManifestTimer)
    this.localManifestTimer = undefined
    for (const watcher of this.localManifestWatchers) watcher.close()
    this.localManifestWatchers = []
  }

  private finishPendingMetadataIfReady(): void {
    if (
      this.pendingMetadataIds.size > 0 ||
      this.providerStatus.issue !== 'metadata-pending'
    ) {
      return
    }
    this.setProviderStatus({
      state: this.synchronizedSourceIssue ? 'partial' : 'ready',
      connection: 'connected',
      methods: this.providerStatus.methods,
      issue: this.synchronizedSourceIssue,
      lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
    })
  }

  private resolvePendingMetadata(appId: number): void {
    if (!this.pendingMetadataIds.delete(appId)) return
    if (this.pendingMetadataIds.size === 0) {
      this.finishPendingMetadataIfReady()
      return
    }
    this.setProviderStatus({
      state: 'partial',
      connection: 'connected',
      methods: this.providerStatus.methods,
      pendingCount: this.pendingMetadataIds.size,
      issue: 'metadata-pending',
      lastCheckedAt: this.providerStatus.lastCheckedAt ?? Date.now()
    })
  }

  private startLocalInstallMonitor(steamId?: string): void {
    this.dispose()
    this.watchedSteamId = steamId
    for (const steamappsDir of getSteamAppsDirectories()) {
      try {
        const watcher = watch(steamappsDir, { persistent: false }, (_event, filename) => {
          const changedFile = filename?.toString().toLocaleLowerCase('en') ?? ''
          const librariesChanged = changedFile === 'libraryfolders.vdf'
          if (
            changedFile &&
            !librariesChanged &&
            !/^appmanifest_\d+\.acf$/.test(changedFile)
          ) {
            return
          }
          this.scheduleLocalInstallRefresh(librariesChanged)
        })
        watcher.on('error', () => watcher.close())
        this.localManifestWatchers.push(watcher)
      } catch {
        // A missing or temporarily locked Steam library simply remains on the last good snapshot.
      }
    }
  }

  private scheduleLocalInstallRefresh(restartWatchers: boolean): void {
    if (this.localManifestTimer) clearTimeout(this.localManifestTimer)
    this.localManifestTimer = setTimeout(() => {
      this.localManifestTimer = undefined
      const installedSnapshot = scanInstalledSteamAppsSnapshot(this.watchedSteamId)
      const installed = installedSnapshot.games
      const fingerprint = localInstallFingerprint(installed.values())
      if (fingerprint !== this.localInstallState) {
        this.localInstallState = fingerprint
        if (installedSnapshot.complete) {
          gameRepository.applyInstalledDelta(installed.values())
        } else {
          gameRepository.applyInstalledProviderPatch(
            'steam',
            [...installed.values()].map((game) => ({
              providerGameId: String(game.appId),
              appId: game.appId,
              name: game.name,
              installDir: game.installDir,
              updateAvailable: game.updateAvailable,
              playtimeSeconds: game.playtimeSeconds,
              lastPlayedTimestamp: game.lastPlayedTimestamp
            }))
          )
        }
        artworkService.syncProvider(gameRepository.getGamesByProvider('steam'), 'steam')
        this.emitSnapshot()
      }
      if (!installedSnapshot.complete && this.providerStatus.state !== 'scanning') {
        this.synchronizedSourceIssue = 'local-source-unavailable'
        this.setProviderStatus({
          state: 'partial',
          connection: this.providerStatus.connection,
          methods: this.providerStatus.methods,
          issue: 'local-source-unavailable',
          lastCheckedAt: Date.now()
        })
      }
      if (restartWatchers) this.startLocalInstallMonitor(this.watchedSteamId)
    }, LOCAL_MANIFEST_SETTLE_MS)
    this.localManifestTimer.unref()
  }

  private setProviderStatus(
    next: Omit<
      LibraryProviderStatus,
      'provider' | 'gameCount' | 'installedCount' | 'installableCount'
    >
  ): void {
    this.providerStatus = {
      provider: 'steam',
      ...gameRepository.getProviderCounts('steam'),
      ...next,
      methods: [...next.methods]
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('updated', this.getSnapshot())
  }
}

export const steamLibraryService = new SteamLibraryService()
app.once('before-quit', () => steamLibraryService.dispose())
