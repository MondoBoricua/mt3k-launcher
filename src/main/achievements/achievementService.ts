import { steamLanguage, normalizeLanguage } from '@shared/language'
import { app } from 'electron'
import Store from 'electron-store'
import type { GameAchievementsSnapshot, LibraryGame } from '@shared/ipc'
import { latestLibraryActivity } from '@shared/libraryTime'
import { fetchWithElectronNet } from '../networkFetch'
import {
  fetchRetroAchievements,
  hasRetroAchievementsCredentials
} from '../retro/retroAchievements'
import { settingsStore } from '../settingsStore'
import { steamAuthManager } from '../steam/steamAuth'
import { steamWebApiCredentials } from '../steam/steamWebApiCredentials'
import { syncCoordinator } from '../sync/syncCoordinator'
import { xboxAuthManager } from '../xbox/xboxAuth'
import { fetchXboxAchievements } from './xboxAchievements'
import {
  parseSteamCommunityAchievements,
  parseSteamWebApiAchievements
} from './steamAchievementParsers'

interface AchievementDatabase {
  schemaVersion: number
  snapshots: Record<string, GameAchievementsSnapshot>
}

const ACHIEVEMENT_SCHEMA_VERSION = 5
const AVAILABLE_TTL_MS = 6 * 60 * 60 * 1000
const PRIVATE_TTL_MS = 6 * 60 * 60 * 1000
const UNSUPPORTED_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TRANSIENT_TTL_MS = 5 * 60 * 1000
const REQUEST_PACING_MS = 900

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const database = new Store<AchievementDatabase>({
  name: 'orbit-achievements',
  defaults: { schemaVersion: ACHIEVEMENT_SCHEMA_VERSION, snapshots: {} }
})
const databaseState: AchievementDatabase = database.store
let databasePersistTimer: ReturnType<typeof setTimeout> | undefined

if (databaseState.schemaVersion < 3) databaseState.snapshots = {}
if (databaseState.schemaVersion < ACHIEVEMENT_SCHEMA_VERSION) {
  // Earlier versions cached every network/session failure as a definitive
  // seven-day miss. Preserve successful data, but let false negatives join
  // the repaired background sync immediately.
  for (const [gameId, snapshot] of Object.entries(databaseState.snapshots)) {
    if (snapshot.state === 'unavailable') delete databaseState.snapshots[gameId]
  }
  databaseState.schemaVersion = ACHIEVEMENT_SCHEMA_VERSION
  database.store = databaseState
}

function flushDatabase(): void {
  if (databasePersistTimer) clearTimeout(databasePersistTimer)
  databasePersistTimer = undefined
  database.store = databaseState
}

function scheduleDatabasePersist(): void {
  if (databasePersistTimer) return
  databasePersistTimer = setTimeout(flushDatabase, 500)
  databasePersistTimer.unref()
}

app.on('before-quit', flushDatabase)

function fresh(snapshot: GameAchievementsSnapshot): boolean {
  const ttl =
    snapshot.state === 'available'
      ? AVAILABLE_TTL_MS
      : snapshot.reason === 'unsupported'
        ? UNSUPPORTED_TTL_MS
        : snapshot.reason === 'private'
          ? PRIVATE_TTL_MS
          : TRANSIENT_TTL_MS
  return Date.now() - snapshot.fetchedAt < ttl
}

function unavailable(
  game: LibraryGame,
  reason: GameAchievementsSnapshot['reason']
): GameAchievementsSnapshot {
  return {
    gameId: game.id,
    provider: game.provider,
    state: 'unavailable',
    achievements: [],
    unlocked: 0,
    total: 0,
    fetchedAt: Date.now(),
    reason
  }
}

async function fetchSteamWebApiAchievements(
  game: LibraryGame,
  steamId: string,
  apiKey: string,
  language: string
): Promise<GameAchievementsSnapshot> {
  const url = new URL(
    'https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/'
  )
  url.searchParams.set('key', apiKey)
  url.searchParams.set('steamid', steamId)
  url.searchParams.set('appid', String(game.appId))
  url.searchParams.set('l', language)
  try {
    const response = await fetchWithElectronNet(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return unavailable(game, 'unavailable')
    return parseSteamWebApiAchievements(game, await response.json())
  } catch {
    return unavailable(game, 'unavailable')
  }
}

async function fetchSteamCommunityAchievements(
  game: LibraryGame,
  steamId: string,
  language: string
): Promise<GameAchievementsSnapshot> {
  const url = new URL(`https://steamcommunity.com/profiles/${steamId}/stats/${game.appId}/`)
  url.searchParams.set('xml', '1')
  url.searchParams.set('l', language)

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await steamAuthManager.fetchAuthenticated(url, {
        signal: AbortSignal.timeout(15_000)
      })
      if (response.ok) return parseSteamCommunityAchievements(game, await response.text())
      if (response.status !== 429 && response.status < 500) break
    } catch {
      // One paced retry absorbs brief session/network transitions without
      // turning the entire library into a long-lived negative cache.
    }
    if (attempt === 0) await wait(800)
  }
  return unavailable(game, 'unavailable')
}

async function fetchSteamAchievements(game: LibraryGame): Promise<GameAchievementsSnapshot> {
  if (!game.appId) return unavailable(game, 'unavailable')
  const account = steamAuthManager.getAccount() ?? (await steamAuthManager.restoreSession())
  if (!account) return unavailable(game, 'not-connected')
  const language = steamLanguage(settingsStore.store.language)
  const apiKey = steamWebApiCredentials.getApiKey()

  if (apiKey) {
    const apiSnapshot = await fetchSteamWebApiAchievements(
      game,
      account.steamId,
      apiKey,
      language
    )
    if (apiSnapshot.state === 'available' || apiSnapshot.reason !== 'unavailable') {
      return apiSnapshot
    }
  }

  return fetchSteamCommunityAchievements(game, account.steamId, language)
}

async function fetchProviderAchievements(game: LibraryGame): Promise<GameAchievementsSnapshot> {
  if (game.provider === 'steam') return fetchSteamAchievements(game)
  if (game.provider === 'retro') return fetchRetroAchievements(game)
  if (game.provider === 'xbox') return fetchXboxAchievements(game)
  // Epic achievement state requires game-specific EOS credentials. The adapter
  // remains explicit instead of pretending that an Epic web login grants access
  // to EOS player data. PlayStation needs its own achievement adapter too.
  return unavailable(game, 'unsupported')
}

export class AchievementService {
  private inFlight = new Map<string, Promise<GameAchievementsSnapshot>>()
  private syncInFlight: Promise<void> | null = null

  get(gameId: string): GameAchievementsSnapshot | null {
    return databaseState.snapshots[gameId] ?? null
  }

  aggregate(gameIds: Iterable<string>): { unlocked: number; total: number } {
    let unlocked = 0
    let total = 0
    for (const gameId of gameIds) {
      const snapshot = this.get(gameId)
      if (!snapshot || snapshot.state !== 'available') continue
      unlocked += snapshot.unlocked
      total += snapshot.total
    }
    return { unlocked, total }
  }

  clearProvider(provider: LibraryGame['provider']): void {
    for (const [gameId, snapshot] of Object.entries(databaseState.snapshots)) {
      if (snapshot.provider === provider) delete databaseState.snapshots[gameId]
    }
    flushDatabase()
  }

  resolve(game: LibraryGame, force = false): Promise<GameAchievementsSnapshot> {
    const cached = this.get(game.id)
    const language = normalizeLanguage(settingsStore.store.language)
    if (!force && cached && cached.language === language && fresh(cached)) {
      return Promise.resolve(cached)
    }
    const requestKey = `${game.id}:${language}`
    const active = this.inFlight.get(requestKey)
    if (active) return active
    const request = fetchProviderAchievements(game)
      .then((snapshot) => {
        snapshot.language = language
        if (language === normalizeLanguage(settingsStore.store.language)) {
          databaseState.snapshots[game.id] = snapshot
          scheduleDatabasePersist()
        }
        return snapshot
      })
      .finally(() => this.inFlight.delete(requestKey))
    this.inFlight.set(requestKey, request)
    return request
  }

  syncStartup(games: LibraryGame[]): Promise<void> {
    return this.sync(games)
  }

  sync(games: LibraryGame[], forceUnavailable = false): Promise<void> {
    if (this.syncInFlight) return this.syncInFlight
    const request = this.runSync(games, forceUnavailable).finally(() => {
      if (this.syncInFlight === request) this.syncInFlight = null
    })
    this.syncInFlight = request
    return request
  }

  private async runSync(games: LibraryGame[], forceUnavailable: boolean): Promise<void> {
    if (!settingsStore.store.showAchievements) {
      syncCoordinator.begin('achievements', 0, 0, undefined, 'system')
      return
    }

    const steamConnected = Boolean(steamAuthManager.getAccount())
    const retroConnected = hasRetroAchievementsCredentials()
    const xboxConnected = Boolean(xboxAuthManager.getAccount())
    const candidates = games
      .filter(
        (game) =>
          (steamConnected && game.provider === 'steam' &&
            ((game.metadata.achievementCount ?? 0) > 0 ||
              this.get(game.id)?.state === 'available')) ||
          (retroConnected &&
            game.provider === 'retro' &&
            Boolean(game.retro?.retroAchievementsGameId)) ||
          (xboxConnected &&
            game.provider === 'xbox' &&
            (game.installed ||
              Boolean(game.metadata.providerTitleId) ||
              this.get(game.id)?.state === 'available'))
      )
      .sort((a, b) => latestLibraryActivity(b) - latestLibraryActivity(a))

    const stale = candidates.filter((game) => {
      const cached = this.get(game.id)
      return (
        !cached ||
        cached.language !== normalizeLanguage(settingsStore.store.language) ||
        !fresh(cached) ||
        (forceUnavailable && cached.state === 'unavailable')
      )
    })
    const completedInitially = candidates.length - stale.length
    syncCoordinator.begin(
      'achievements',
      candidates.length,
      completedInitially,
      undefined,
      'unified'
    )

    let completed = completedInitially
    const queue = [...stale]
    const workers = Array.from({ length: Math.min(1, queue.length) }, async () => {
      while (queue.length > 0) {
        const game = queue.shift()
        if (!game) return
        await this.resolve(game, forceUnavailable)
        completed += 1
        syncCoordinator.progress(
          'achievements',
          completed,
          candidates.length,
          game.name,
          'unified'
        )
        if (queue.length > 0) await wait(REQUEST_PACING_MS)
      }
    })
    await Promise.allSettled(workers)
    syncCoordinator.complete('achievements', undefined, 'unified')
  }
}

export const achievementService = new AchievementService()
