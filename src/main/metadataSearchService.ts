import {
  MAX_METADATA_SEARCH_OPTIONS,
  METADATA_SEARCH_FIELDS,
  parseMetadataSearchItems,
  type MetadataLookupResult,
  type MetadataSearchCandidate,
  type MetadataSearchResult
} from '@shared/gameMetadataSearch'
import { fetchWithElectronNet } from './networkFetch'
import { discardResponse, readTextLimited } from './publicArtworkSearch'
import { settingsStore } from './settingsStore'
import { localizedStoreRegion } from './store/storeRegions'
import { fetchSteamStoreMetadata } from './steam/steamMetadata'

const SEARCH_TIMEOUT_MS = 8_000

function currentRegion(): ReturnType<typeof localizedStoreRegion> {
  return localizedStoreRegion(settingsStore.store.storeRegion, settingsStore.store.language)
}

/** Searches the public Steam store by title. Only apps are returned. */
export async function searchSteamStoreMetadata(query: string): Promise<MetadataSearchResult> {
  const region = currentRegion()
  const url = new URL('https://store.steampowered.com/api/storesearch/')
  url.searchParams.set('term', query)
  url.searchParams.set('l', region.steamLanguage)
  url.searchParams.set('cc', region.countryCode)
  try {
    const response = await fetchWithElectronNet(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })
    if (!response.ok) {
      await discardResponse(response)
      const transient = response.status === 429 || response.status >= 500
      return { state: transient ? 'unavailable' : 'missing', query, options: [] }
    }
    // Streamed with a byte cap so an oversized or slow-drip body is abandoned early.
    const text = await readTextLimited(response)
    if (!text) return { state: 'unavailable', query, options: [] }
    const options = parseMetadataSearchItems(JSON.parse(text)).slice(0, MAX_METADATA_SEARCH_OPTIONS)
    return { state: options.length > 0 ? 'ready' : 'missing', query, options }
  } catch {
    return { state: 'unavailable', query, options: [] }
  }
}

/** Loads one app's store details and keeps only the fields the editor can fill. */
export async function lookupSteamStoreMetadata(appId: number): Promise<MetadataLookupResult> {
  try {
    const result = await fetchSteamStoreMetadata(appId, currentRegion().steamLanguage)
    if (!result) return { state: 'unavailable' }
    if (result.type === 'missing' || !result.name) return { state: 'missing' }
    const metadata: MetadataSearchCandidate['metadata'] = {}
    for (const field of METADATA_SEARCH_FIELDS) {
      const value = result.metadata[field]
      if (value !== undefined) (metadata as Record<string, unknown>)[field] = value
    }
    return {
      state: 'ready',
      candidate: { appId, name: result.name, source: 'steam-store', metadata }
    }
  } catch {
    return { state: 'unavailable' }
  }
}
