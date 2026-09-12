import type { ArtworkSearchOption, ImageOrientation } from '@shared/ipc'

export type PublicArtworkOrientation = Exclude<ImageOrientation, 'icon'>

export interface PublicSteamSearchItem {
  id: number
  name: string
}

export interface PublicSteamArtworkCandidate extends ArtworkSearchOption {
  source: 'steam-store'
  downloadUrl: string
}

const STEAM_ARTWORK_FILE = /^(?:header(?:_2x)?|library_600x900(?:_2x)?|library_capsule(?:_2x)?|library_hero(?:_2x)?|library_logo(?:_2x)?|logo)\.(?:jpe?g|png|webp)$/i
const STEAM_ASSET_HASH = /^[0-9a-f]{40}$/i
const STEAM_ASSET_FILE = /^[0-9a-f]{40}\/[a-z0-9_]+\.(?:jpe?g|png|webp)$/i
const STEAM_ASSET_URL_FORMAT = /^steam\/apps\/(\d+)\/\$\{FILENAME\}(?:\?t=\d+)?$/
const STEAM_ASSET_ROOT = 'https://shared.fastly.steamstatic.com/store_item_assets/'

/**
 * Newer Steam apps publish library artwork under content-hashed folders
 * (steam/apps/<id>/<sha1>/library_capsule_2x.jpg). The classic fixed paths
 * return 404 for them, so the store browse API supplies the real file names.
 */
export interface SteamStoreLibraryAssets {
  vertical: string[]
  horizontal: string[]
  header: string[]
  logo: string[]
}

export function parseSteamStoreBrowseAssets(value: unknown): Map<number, SteamStoreLibraryAssets> {
  const result = new Map<number, SteamStoreLibraryAssets>()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return result
  const response = (value as { response?: unknown }).response
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return result
  const items = (response as { store_items?: unknown }).store_items
  if (!Array.isArray(items)) return result
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const { appid, id, assets } = item as { appid?: unknown; id?: unknown; assets?: unknown }
    const appId = typeof appid === 'number' ? appid : id
    if (typeof appId !== 'number' || !Number.isSafeInteger(appId) || appId <= 0) continue
    if (typeof assets !== 'object' || assets === null || Array.isArray(assets)) continue
    const record = assets as Record<string, unknown>
    const format = typeof record.asset_url_format === 'string' ? record.asset_url_format : ''
    const match = STEAM_ASSET_URL_FORMAT.exec(format)
    if (!match || Number(match[1]) !== appId) continue
    const urls = (...keys: string[]): string[] =>
      keys.flatMap((key) => {
        const file = record[key]
        return typeof file === 'string' && STEAM_ASSET_FILE.test(file)
          ? [`${STEAM_ASSET_ROOT}${format.replace('${FILENAME}', file)}`]
          : []
      })
    result.set(appId, {
      vertical: urls('library_capsule_2x', 'library_capsule'),
      horizontal: urls('library_hero_2x', 'library_hero'),
      header: urls('header_2x', 'header'),
      logo: urls('library_logo_2x', 'library_logo')
    })
  }
  return result
}

export function parsePublicSteamSearchItems(value: unknown): PublicSteamSearchItem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const seen = new Set<number>()
  const result: PublicSteamSearchItem[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const candidate = item as { id?: unknown; type?: unknown; name?: unknown }
    if (
      candidate.type !== 'app' ||
      typeof candidate.id !== 'number' ||
      !Number.isSafeInteger(candidate.id) ||
      candidate.id <= 0 ||
      seen.has(candidate.id) ||
      typeof candidate.name !== 'string'
    ) {
      continue
    }
    const name = candidate.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 160)
    if (!name) continue
    seen.add(candidate.id)
    result.push({ id: candidate.id, name })
  }
  return result
}

export function publicSteamArtworkUrls(
  appId: number,
  orientation: PublicArtworkOrientation,
  assets?: SteamStoreLibraryAssets
): string[][] {
  if (!Number.isSafeInteger(appId) || appId <= 0) return []
  const fastlyRoot = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}`
  const legacyRoot = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`
  const storePageBackground = `https://store.akamai.steamstatic.com/images/storepagebackground/app/${appId}`
  return orientation === 'vertical'
    ? [
        [
          ...(assets?.vertical ?? []),
          `${fastlyRoot}/library_600x900_2x.jpg`,
          `${fastlyRoot}/library_600x900.jpg`,
          `${legacyRoot}/library_600x900.jpg`
        ]
      ]
    : orientation === 'logo'
      ? [
          [
            ...(assets?.logo ?? []),
            `${fastlyRoot}/library_logo.png`,
            `${fastlyRoot}/logo.png`,
            `${legacyRoot}/library_logo.png`,
            `${legacyRoot}/logo.png`
          ]
        ]
      : [
          [
            ...(assets?.horizontal ?? []),
            `${fastlyRoot}/library_hero.jpg`,
            `${legacyRoot}/library_hero.jpg`
          ],
          [storePageBackground],
          [...(assets?.header ?? []), `${fastlyRoot}/header.jpg`, `${legacyRoot}/header.jpg`]
        ]
}

export function isPublicSteamArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
      return false
    }
    const host = url.hostname.toLowerCase()
    if (host === 'store.akamai.steamstatic.com') {
      return /^\/images\/storepagebackground\/app\/\d+\/?$/i.test(url.pathname)
    }
    const assetHost = host === 'shared.fastly.steamstatic.com' || host === 'shared.akamai.steamstatic.com'
    if (!assetHost && host !== 'cdn.cloudflare.steamstatic.com') {
      return false
    }
    const segments = url.pathname.split('/').filter(Boolean)
    const appsIndex = assetHost ? 2 : 1
    const expectedPrefix = assetHost ? ['store_item_assets', 'steam', 'apps'] : ['steam', 'apps']
    if (
      !expectedPrefix.every((segment, index) => segments[index] === segment) ||
      !/^\d+$/.test(segments[appsIndex + 1] ?? '')
    ) {
      return false
    }
    const hashed =
      assetHost &&
      segments.length === appsIndex + 4 &&
      STEAM_ASSET_HASH.test(segments[appsIndex + 2] ?? '')
    if (segments.length !== appsIndex + 3 && !hashed) return false
    const fileName = segments[segments.length - 1]
    return Boolean(fileName && STEAM_ARTWORK_FILE.test(fileName))
  } catch {
    return false
  }
}
