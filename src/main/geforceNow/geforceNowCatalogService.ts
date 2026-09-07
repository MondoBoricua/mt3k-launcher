import { EventEmitter } from 'node:events'
import Store from 'electron-store'
import type {
  GeForceNowCatalogSnapshot,
  GeForceNowLibraryMatch,
  LibraryGame
} from '@shared/ipc'
import {
  GEFORCE_NOW_CATALOG_URL,
  geForceNowStoreForProvider,
  geForceNowStoreIdForGame,
  geForceNowStoreKey
} from '@shared/geforceNow'
import { fetchWithElectronNet } from '../networkFetch'
import { settingsStore } from '../settingsStore'
import { orbitPlusService } from '../orbitPlus/orbitPlusService'

const CATALOG_SCHEMA_VERSION = 1
const CATALOG_TTL_MS = 12 * 60 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 25_000
const PAGE_SIZE = 750
const MAX_PAGES = 12
const MAX_PAGE_BYTES = 12 * 1024 * 1024
const MAX_CATALOG_GAMES = PAGE_SIZE * MAX_PAGES
const GEFORCE_NOW_GAME_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface CatalogVariant {
  id: string
  appStore: string
  storeId: string
  shortName?: string
}

interface CatalogGame {
  id: string
  cmsId: number
  title: string
  boxArtUrl?: string
  playabilityState?: string
  variants: CatalogVariant[]
}

interface CatalogCacheSchema {
  schemaVersion: number
  locale?: string
  region?: 'DE' | 'US' | 'ES'
  updatedAt?: number
  catalogSize?: number
  games?: CatalogGame[]
}

interface CatalogPage {
  games: CatalogGame[]
  numberReturned: number
  endCursor?: string
  hasNextPage: boolean
}

interface IndexedVariant {
  game: CatalogGame
  variant: CatalogVariant
}

const catalogStore = new Store<CatalogCacheSchema>({
  name: 'orbit-geforce-now-catalog-v1',
  defaults: { schemaVersion: CATALOG_SCHEMA_VERSION }
})

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedString(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maximumLength ? normalized : undefined
}

function httpsUrl(value: unknown): string | undefined {
  const candidate = boundedString(value, 2_048)
  if (!candidate) return undefined
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' ? parsed.toString() : undefined
  } catch {
    return undefined
  }
}

function parseVariant(value: unknown): CatalogVariant | null {
  const candidate = objectValue(value)
  if (!candidate) return null
  const id = boundedString(candidate.id, 128)
  const appStore = boundedString(candidate.appStore, 40)?.toUpperCase()
  const storeId = boundedString(candidate.storeId, 256)
  if (!id || !appStore || !storeId) return null
  return {
    id,
    appStore,
    storeId,
    shortName: boundedString(candidate.shortName, 256)
  }
}

function parseGame(value: unknown): CatalogGame | null {
  const candidate = objectValue(value)
  if (!candidate) return null
  const id = boundedString(candidate.id, 64)
  const cmsId = Number(candidate.cmsId)
  const title = boundedString(candidate.title, 240)
  if (!id || !GEFORCE_NOW_GAME_ID.test(id) || !Number.isSafeInteger(cmsId) || cmsId <= 0 || !title) {
    return null
  }
  const images = objectValue(candidate.images)
  const gfn = objectValue(candidate.gfn)
  const variants = Array.isArray(candidate.variants)
    ? candidate.variants.slice(0, 32).map(parseVariant).filter((item): item is CatalogVariant => Boolean(item))
    : []
  if (variants.length === 0) return null
  return {
    id: id.toLowerCase(),
    cmsId,
    title,
    boxArtUrl: httpsUrl(images?.GAME_BOX_ART) ?? httpsUrl(candidate.boxArtUrl),
    playabilityState:
      boundedString(gfn?.playabilityState, 80) ?? boundedString(candidate.playabilityState, 80),
    variants
  }
}

function parsePage(value: unknown): CatalogPage {
  const root = objectValue(value)
  const data = objectValue(root?.data)
  const apps = objectValue(data?.apps)
  const pageInfo = objectValue(apps?.pageInfo)
  if (!apps || !pageInfo || !Array.isArray(apps.items)) {
    throw new Error('Invalid GeForce NOW catalog response')
  }
  const games = apps.items.map(parseGame).filter((item): item is CatalogGame => Boolean(item))
  const numberReturned = Number(apps.numberReturned)
  const endCursor = boundedString(pageInfo.endCursor, 128)
  const hasNextPage = pageInfo.hasNextPage === true
  if (!Number.isInteger(numberReturned) || numberReturned < 0 || numberReturned > PAGE_SIZE) {
    throw new Error('Invalid GeForce NOW catalog page size')
  }
  if (hasNextPage && !endCursor) throw new Error('Missing GeForce NOW catalog cursor')
  return { games, numberReturned, endCursor, hasNextPage }
}

function validCachedCatalog(value: CatalogCacheSchema): CatalogCacheSchema | null {
  if (
    value.schemaVersion !== CATALOG_SCHEMA_VERSION ||
    (value.region !== 'DE' && value.region !== 'US' && value.region !== 'ES') ||
    (value.locale !== 'de_DE' && value.locale !== 'en_US' && value.locale !== 'es_ES') ||
    !Number.isFinite(value.updatedAt) ||
    (value.updatedAt ?? 0) <= 0 ||
    !Number.isInteger(value.catalogSize) ||
    (value.catalogSize ?? 0) < 0 ||
    !Array.isArray(value.games) ||
    value.games.length > MAX_CATALOG_GAMES
  ) {
    return null
  }
  const games = value.games.map(parseGame).filter((item): item is CatalogGame => Boolean(item))
  if (games.length === 0) return null
  return { ...value, games }
}

function catalogLocale(): { locale: 'de_DE' | 'en_US' | 'es_ES'; region: 'DE' | 'US' | 'ES' } {
  return settingsStore.get('language') === 'de'
    ? { locale: 'de_DE', region: 'DE' }
    : settingsStore.get('language') === 'es'
      ? { locale: 'es_ES', region: 'ES' }
      : { locale: 'en_US', region: 'US' }
}

function catalogQuery(locale: string, region: string, after?: string): string {
  const afterArgument = after ? ` after:"${after}"` : ''
  return `{ apps(country:"${region}" language:"${locale}" first:${PAGE_SIZE}${afterArgument}) { numberReturned pageInfo { endCursor hasNextPage } items { id cmsId title images { GAME_BOX_ART } gfn { playabilityState } variants { id appStore storeId shortName } } } }`
}

async function fetchCatalog(
  locale: 'de_DE' | 'en_US' | 'es_ES',
  region: 'DE' | 'US' | 'ES',
  signal: AbortSignal
): Promise<{
  games: CatalogGame[]
  catalogSize: number
}> {
  const games: CatalogGame[] = []
  const seenCursors = new Set<string>()
  let after: string | undefined
  let catalogSize = 0

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    signal.throwIfAborted()
    orbitPlusService.requireFeature('cloud-gaming')
    const response = await fetchWithElectronNet(GEFORCE_NOW_CATALOG_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'ORBIT/1.0'
      },
      body: catalogQuery(locale, region, after),
      signal
    })
    if (!response.ok) throw new Error(`GeForce NOW catalog returned ${response.status}`)
    const body = await response.text()
    if (body.length > MAX_PAGE_BYTES) throw new Error('GeForce NOW catalog page is too large')
    const page = parsePage(JSON.parse(body) as unknown)
    games.push(...page.games)
    catalogSize += page.numberReturned
    if (!page.hasNextPage) return { games, catalogSize }
    if (!page.endCursor || seenCursors.has(page.endCursor)) {
      throw new Error('GeForce NOW catalog pagination did not advance')
    }
    seenCursors.add(page.endCursor)
    after = page.endCursor
  }
  throw new Error('GeForce NOW catalog exceeded the page limit')
}

export class GeForceNowCatalogService extends EventEmitter {
  private games: CatalogGame[] = []
  private catalogSize = 0
  private locale: 'de_DE' | 'en_US' | 'es_ES' | undefined
  private region: 'DE' | 'US' | 'ES' | undefined
  private updatedAt: number | undefined
  private issue: GeForceNowCatalogSnapshot['issue']
  private refreshInFlight: Promise<void> | null = null
  private abortController: AbortController | null = null
  private index = new Map<string, IndexedVariant | null>()
  private disposed = false

  constructor() {
    super()
    const cached = validCachedCatalog(catalogStore.store)
    if (!cached) return
    this.games = cached.games ?? []
    this.catalogSize = cached.catalogSize ?? this.games.length
    this.locale = cached.locale as 'de_DE' | 'en_US' | 'es_ES'
    this.region = cached.region
    this.updatedAt = cached.updatedAt
    this.rebuildIndex()
  }

  getSnapshot(libraryGames: readonly LibraryGame[]): GeForceNowCatalogSnapshot {
    const current = catalogLocale()
    if (!orbitPlusService.hasFeature('cloud-gaming')) {
      return { state: 'locked', matches: [], catalogSize: 0, region: current.region }
    }
    const hasCatalog = this.games.length > 0 && Boolean(this.updatedAt)
    const wrongLocale = this.locale !== current.locale || this.region !== current.region
    const stale = !this.updatedAt || Date.now() - this.updatedAt >= CATALOG_TTL_MS || wrongLocale
    const state: GeForceNowCatalogSnapshot['state'] = !hasCatalog
      ? this.refreshInFlight
        ? 'loading'
        : this.issue
          ? 'error'
          : 'loading'
      : this.issue || stale
        ? 'stale'
        : 'ready'

    return {
      state,
      matches: libraryGames
        .map((game) => this.matchIndexedGame(game))
        .filter((match): match is GeForceNowLibraryMatch => Boolean(match)),
      catalogSize: this.catalogSize,
      region: current.region,
      updatedAt: this.updatedAt,
      issue: this.issue
    }
  }

  matchGame(game: LibraryGame): GeForceNowLibraryMatch | null {
    if (!orbitPlusService.hasFeature('cloud-gaming')) return null
    return this.matchIndexedGame(game)
  }

  private matchIndexedGame(game: LibraryGame): GeForceNowLibraryMatch | null {
    const appStore = geForceNowStoreForProvider(game.provider)
    const storeId = geForceNowStoreIdForGame(game)
    if (!appStore || !storeId) return null
    const indexed = this.index.get(geForceNowStoreKey(appStore, storeId))
    if (!indexed) return null
    return {
      gameId: game.id,
      geforceNowGameId: indexed.game.id,
      geforceNowTitle: indexed.game.title,
      cmsId: indexed.game.cmsId,
      variantId: indexed.variant.id,
      appStore: indexed.variant.appStore,
      storeId: indexed.variant.storeId,
      boxArtUrl: indexed.game.boxArtUrl,
      playabilityState: indexed.game.playabilityState
    }
  }

  refreshIfStale(): void {
    if (this.disposed || !orbitPlusService.hasFeature('cloud-gaming')) return
    const current = catalogLocale()
    const fresh =
      this.updatedAt &&
      Date.now() - this.updatedAt < CATALOG_TTL_MS &&
      this.locale === current.locale &&
      this.region === current.region
    if (!fresh) void this.refresh().catch(() => undefined)
  }

  async refresh(force = false): Promise<void> {
    if (this.disposed) return
    orbitPlusService.requireFeature('cloud-gaming')
    if (this.refreshInFlight) return this.refreshInFlight
    if (!force) {
      const current = catalogLocale()
      if (
        this.updatedAt &&
        Date.now() - this.updatedAt < CATALOG_TTL_MS &&
        this.locale === current.locale &&
        this.region === current.region
      ) {
        return
      }
    }
    const requestedLocale = catalogLocale().locale
    this.refreshInFlight = this.doRefresh()
    this.emit('updated')
    try {
      await this.refreshInFlight
    } finally {
      this.refreshInFlight = null
      if (!this.disposed) {
        this.emit('updated')
        if (catalogLocale().locale !== requestedLocale) this.refreshIfStale()
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.abortController?.abort()
    this.abortController = null
  }

  private async doRefresh(): Promise<void> {
    const controller = new AbortController()
    this.abortController = controller
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    timeout.unref()
    try {
      const current = catalogLocale()
      const { games, catalogSize } = await fetchCatalog(
        current.locale,
        current.region,
        controller.signal
      )
      if (controller.signal.aborted || this.disposed || !orbitPlusService.hasFeature('cloud-gaming')) return
      if (games.length === 0) throw new Error('GeForce NOW catalog is empty')
      const updatedAt = Date.now()
      this.games = games
      this.catalogSize = catalogSize
      this.locale = current.locale
      this.region = current.region
      this.updatedAt = updatedAt
      this.issue = undefined
      this.rebuildIndex()
      catalogStore.store = {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        locale: current.locale,
        region: current.region,
        updatedAt,
        catalogSize,
        games
      }
    } catch {
      if (!this.disposed && orbitPlusService.hasFeature('cloud-gaming')) this.issue = 'catalog-unavailable'
    } finally {
      clearTimeout(timeout)
      if (this.abortController === controller) this.abortController = null
    }
  }

  private rebuildIndex(): void {
    const index = new Map<string, IndexedVariant | null>()
    for (const game of this.games) {
      for (const variant of game.variants) {
        const key = geForceNowStoreKey(variant.appStore, variant.storeId)
        const existing = index.get(key)
        if (!index.has(key)) index.set(key, { game, variant })
        else if (!existing) continue
        else if (existing.game.id !== game.id || existing.variant.id !== variant.id) index.set(key, null)
      }
    }
    this.index = index
  }
}

export const geForceNowCatalogService = new GeForceNowCatalogService()
