import type { ArtworkNetworkAttempt } from './artworkNetworkPolicy'
import { isTransientArtworkStatus, runArtworkNetworkAttempt } from './artworkNetworkPolicy'
import { fetchWithElectronNet } from './networkFetch'
import { settingsStore } from './settingsStore'
import { localizedStoreRegion } from './store/storeRegions'
import {
  isPublicSteamArtworkUrl,
  parsePublicSteamSearchItems,
  parseSteamStoreBrowseAssets,
  publicSteamArtworkUrls,
  type PublicArtworkOrientation,
  type PublicSteamArtworkCandidate,
  type SteamStoreLibraryAssets
} from './publicArtworkSearchPolicy'

const SEARCH_TIMEOUT_MS = 8_000
const IMAGE_CHECK_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_SEARCH_ITEMS = 12
const MAX_CANDIDATES = 18
const MAX_IMAGE_CHECK_CONCURRENCY = 4

export async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

/** Streams a response body and gives up as soon as it exceeds the byte cap. */
export async function readTextLimited(response: Response): Promise<string | null> {
  const announcedSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(announcedSize) && announcedSize > MAX_RESPONSE_BYTES) {
    await discardResponse(response)
    return null
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function firstAvailableUrl(urls: string[]): Promise<string | undefined> {
  for (const url of urls) {
    if (!isPublicSteamArtworkUrl(url)) continue
    try {
      const response = await fetchWithElectronNet(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(IMAGE_CHECK_TIMEOUT_MS)
      })
      const contentType = response.headers.get('content-type')?.toLowerCase()
      const finalUrl = response.url || url
      await discardResponse(response)
      if (
        response.ok &&
        isPublicSteamArtworkUrl(finalUrl) &&
        (!contentType || contentType.startsWith('image/'))
      ) {
        return finalUrl
      }
    } catch {
      // A missing image or individual CDN timeout only removes this option.
    }
  }
  return undefined
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      results[index] = await task(values[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  )
  return results
}

/** Resolves content-hashed library artwork names for many apps in one request. */
async function fetchSteamStoreLibraryAssets(
  appIds: number[],
  language: string,
  countryCode: string
): Promise<Map<number, SteamStoreLibraryAssets>> {
  if (appIds.length === 0) return new Map()
  try {
    const url = new URL('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/')
    url.searchParams.set(
      'input_json',
      JSON.stringify({
        ids: appIds.map((appid) => ({ appid })),
        context: { language, country_code: countryCode },
        data_request: { include_assets: true }
      })
    )
    const response = await fetchWithElectronNet(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    })
    if (!response.ok) {
      await discardResponse(response)
      return new Map()
    }
    const text = await readTextLimited(response)
    return text ? parseSteamStoreBrowseAssets(JSON.parse(text)) : new Map()
  } catch {
    // Classic fixed paths remain the fallback when the browse API is unavailable.
    return new Map()
  }
}

export async function searchPublicSteamArtwork(
  query: string,
  orientation: PublicArtworkOrientation
): Promise<ArtworkNetworkAttempt<PublicSteamArtworkCandidate[]>> {
  return runArtworkNetworkAttempt<PublicSteamArtworkCandidate[]>(
    'artwork-picker:store.steampowered.com',
    async () => {
      const region = localizedStoreRegion(settingsStore.store.storeRegion, settingsStore.store.language)
      const url = new URL('https://store.steampowered.com/api/storesearch/')
      url.searchParams.set('term', query)
      url.searchParams.set('l', region.steamLanguage)
      url.searchParams.set('cc', region.countryCode)
      const response = await fetchWithElectronNet(url, {
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
      })
      if (!response.ok) {
        await discardResponse(response)
        return { state: isTransientArtworkStatus(response.status) ? 'unavailable' : 'missing' }
      }
      const text = await readTextLimited(response)
      if (!text) return { state: 'missing' }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return { state: 'missing' }
      }
      const items = parsePublicSteamSearchItems(parsed).slice(0, MAX_SEARCH_ITEMS)
      const assets = await fetchSteamStoreLibraryAssets(
        items.map((item) => item.id),
        region.steamLanguage,
        region.countryCode
      )
      const perGame = await mapWithConcurrency(
        items,
        MAX_IMAGE_CHECK_CONCURRENCY,
        async (item): Promise<PublicSteamArtworkCandidate[]> => {
          const groups = publicSteamArtworkUrls(item.id, orientation, assets.get(item.id))
          const urls: Array<string | undefined> = []
          for (const group of groups) urls.push(await firstAvailableUrl(group))
          return urls
            .filter((candidate): candidate is string => Boolean(candidate))
            .map((candidate, index) => ({
              id: `steam-store:${item.id}:${orientation}:${index}`,
              previewUrl: candidate,
              downloadUrl: candidate,
              source: 'steam-store',
              sourceTitle: item.name
            }))
        }
      )
      const candidates = perGame.flat().slice(0, MAX_CANDIDATES)
      return candidates.length > 0
        ? { state: 'success', value: candidates }
        : { state: 'missing' }
    }
  )
}
