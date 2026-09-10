import type { StoreProduct } from './ipc'

const UNSUPPORTED_TITLE_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u

export function hasStoreArtwork(product: StoreProduct): boolean {
  return Boolean(product.heroUrl ?? product.headerUrl ?? product.portraitUrl)
}

/** A user's explicit wishlist choice remains visible while metadata and art hydrate. */
export function isStoreWishlistProductVisible(product: StoreProduct): boolean {
  return product.steamWishlisted || product.orbitWishlisted
}

/**
 * Featured Steam records already contain enough data for a useful preview.
 * Full details and cross-store prices arrive progressively and must not block
 * the entire discovery grid on a cold cache.
 */
export function isStoreDiscoverProductVisible(
  product: StoreProduct,
  ownedSteamAppIds: ReadonlySet<number>
): boolean {
  if (ownedSteamAppIds.has(product.steamAppId ?? -1)) return false
  if (product.artworkStatus === 'missing') return false
  if (product.steamWishlisted || product.orbitWishlisted) return true
  if (product.searchOnly || product.discoverEligible === false || !hasStoreArtwork(product)) {
    return false
  }
  return !UNSUPPORTED_TITLE_SCRIPT.test(product.name)
}
