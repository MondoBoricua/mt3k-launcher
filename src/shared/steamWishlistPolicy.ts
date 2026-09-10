import type { StoreProduct } from './ipc'

export interface SteamWishlistEntry {
  appId: number
  addedAt?: number
  priority?: number
}

export interface SteamWishlistSyncResult {
  items: SteamWishlistEntry[]
  complete: boolean
}

interface PersistedWishlistEntry {
  productId: string
  addedAt?: number
}

function steamArtworkUrls(appId: number): {
  headerUrl: string
  heroUrl: string
  portraitUrl: string
} {
  const root = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}`
  return {
    headerUrl: `${root}/header.jpg`,
    heroUrl: `${root}/library_hero.jpg`,
    portraitUrl: `${root}/library_600x900_2x.jpg`
  }
}

/** Materialize every synced identity before optional Store metadata has arrived. */
export function createSteamWishlistProduct(
  appId: number,
  current?: StoreProduct,
  now = Date.now()
): StoreProduct {
  const artwork = steamArtworkUrls(appId)
  return {
    ...current,
    id: `steam:${appId}`,
    steamAppId: appId,
    canonicalSource: 'steam',
    sourceProductId: String(appId),
    name: current?.name ?? `Steam ${appId}`,
    discoverEligible: current?.discoverEligible ?? false,
    artworkStatus: current?.artworkStatus ?? 'pending',
    searchOnly: false,
    headerUrl: current?.headerUrl ?? artwork.headerUrl,
    heroUrl: current?.heroUrl ?? artwork.heroUrl,
    portraitUrl: current?.portraitUrl ?? artwork.portraitUrl,
    steamWishlisted: true,
    orbitWishlisted: current?.orbitWishlisted ?? false,
    offers: current?.offers ?? [],
    recommendationScore: current?.recommendationScore ?? 0,
    updatedAt: current?.updatedAt ?? now
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function parseSteamWishlistCount(payload: unknown): number | undefined {
  const count = objectValue(objectValue(payload)?.response)?.count
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? count
    : undefined
}

/** Steam's authenticated Store session exposes a complete identity-only fallback. */
export function parseSteamDynamicStoreWishlist(payload: unknown): number[] {
  const rawWishlist = objectValue(payload)?.rgWishlist
  if (!Array.isArray(rawWishlist)) {
    throw new Error('Steam authenticated userdata returned no wishlist')
  }
  const appIds = new Set<number>()
  for (const appId of rawWishlist) {
    if (typeof appId !== 'number' || !Number.isInteger(appId) || appId <= 0) {
      throw new Error('Steam authenticated userdata contained an invalid wishlist identity')
    }
    appIds.add(appId)
  }
  return [...appIds]
}

/**
 * The modern Steam endpoint returns identities only. Validate the separately
 * reported item count before this response is allowed to prune persisted data.
 */
export function parseSteamWishlistPayload(
  payload: unknown,
  expectedCount?: number
): SteamWishlistEntry[] {
  const response = objectValue(objectValue(payload)?.response)
  const rawItems = response?.items
  if (rawItems === undefined && expectedCount === 0) return []
  if (!Array.isArray(rawItems)) throw new Error('Steam wishlist returned no item list')

  const items = new Map<number, SteamWishlistEntry>()
  for (const rawItem of rawItems) {
    const item = objectValue(rawItem)
    const appId = item?.appid
    if (!item || typeof appId !== 'number' || !Number.isInteger(appId) || appId <= 0) {
      throw new Error('Steam wishlist contained an invalid app identity')
    }
    const dateAdded = optionalFiniteNumber(item.date_added)
    items.set(appId, {
      appId,
      addedAt: dateAdded !== undefined && dateAdded > 0 ? dateAdded * 1000 : undefined,
      priority: optionalFiniteNumber(item.priority)
    })
  }

  if (expectedCount !== undefined && items.size !== expectedCount) {
    throw new Error(
      `Steam wishlist was incomplete (${items.size} of ${expectedCount} identities)`
    )
  }

  return [...items.values()].sort(
    (left, right) =>
      (left.priority ?? Infinity) - (right.priority ?? Infinity) ||
      (right.addedAt ?? 0) - (left.addedAt ?? 0)
  )
}

/** A failed refresh is additive only; only a verified complete response may prune. */
export function reconcileSteamWishlist(
  current: Readonly<Record<string, number>>,
  items: readonly PersistedWishlistEntry[],
  complete: boolean,
  now = Date.now()
): Record<string, number> {
  const next: Record<string, number> = complete ? {} : { ...current }
  for (const item of items) {
    next[item.productId] = item.addedAt ?? current[item.productId] ?? now
  }
  return next
}
