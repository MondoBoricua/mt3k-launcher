import type { GameMetadata } from './ipc'

/**
 * Store metadata search for the metadata editor. The renderer only ever sees
 * validated options and a filtered candidate; nothing is saved until the user
 * reviews the filled fields and confirms Save & sync.
 */
export const MIN_METADATA_SEARCH_QUERY_LENGTH = 2
export const MAX_METADATA_SEARCH_QUERY_LENGTH = 120
export const MAX_METADATA_SEARCH_OPTIONS = 12

export const METADATA_SEARCH_FIELDS = [
  'summary',
  'description',
  'genres',
  'features',
  'developers',
  'publishers',
  'releaseDateText',
  'comingSoon',
  'criticScore',
  'recommendationCount',
  'requiredAge',
  'website',
  'storeUrl',
  'languages',
  'controllerSupport',
  'platforms',
  'achievementCount',
  'contentDescriptorNotes',
  'systemRequirements'
] as const satisfies readonly (keyof GameMetadata)[]

export type MetadataSearchField = (typeof METADATA_SEARCH_FIELDS)[number]

export interface MetadataSearchOption {
  appId: number
  name: string
  /** Small Steam store capsule, validated to Steam's asset CDN. */
  imageUrl?: string
  source: 'steam-store'
}

export interface MetadataSearchResult {
  state: 'ready' | 'missing' | 'unavailable'
  query: string
  options: MetadataSearchOption[]
}

export interface MetadataSearchCandidate {
  appId: number
  name: string
  source: 'steam-store'
  metadata: Pick<GameMetadata, MetadataSearchField>
}

export interface MetadataLookupResult {
  state: 'ready' | 'missing' | 'unavailable'
  candidate?: MetadataSearchCandidate
}

/** C0 and C1 control characters, written as escapes so the source stays plain ASCII. */
const CONTROL_CHARACTERS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'u')
const CONTROL_CHARACTERS_GLOBAL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'gu')
const STEAM_IMAGE_HOSTS = new Set(['shared.akamai.steamstatic.com', 'shared.fastly.steamstatic.com'])

export function normalizeMetadataSearchQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // Ordinary whitespace (tabs, newlines) collapses to spaces; any other control character is rejected.
  const query = value.replace(/\s+/gu, ' ').trim()
  if (CONTROL_CHARACTERS.test(query)) return undefined
  return query.length >= MIN_METADATA_SEARCH_QUERY_LENGTH &&
    query.length <= MAX_METADATA_SEARCH_QUERY_LENGTH
    ? query
    : undefined
}

/**
 * The metadata editor shows list fields as comma-separated text and splits on
 * commas when saving. Store names often contain commas ("ARC SYSTEM WORKS CO., LTD"),
 * which would otherwise turn one entry into several, so inner commas become spaces.
 */
export function storeListToEditorText(values: readonly string[] | undefined): string | undefined {
  if (!values) return undefined
  const items = values
    .map((value) => value.replace(/\s*,\s*/gu, ' ').replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
  return items.length > 0 ? [...new Set(items)].join(', ') : undefined
}

export function isSteamAppId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 2_147_483_647
  )
}

export function steamStoreImageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !STEAM_IMAGE_HOSTS.has(url.hostname.toLowerCase()) ||
      !/^\/store_item_assets\/steam\/apps\/\d+\//u.test(url.pathname) ||
      !/\/[a-z0-9_]+\.(?:jpe?g|png|webp)$/iu.test(url.pathname)
    ) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

export function parseMetadataSearchItems(value: unknown): MetadataSearchOption[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const seen = new Set<number>()
  const options: MetadataSearchOption[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const candidate = item as { id?: unknown; type?: unknown; name?: unknown; tiny_image?: unknown }
    if (candidate.type !== 'app' || !isSteamAppId(candidate.id) || seen.has(candidate.id)) continue
    if (typeof candidate.name !== 'string') continue
    const name = candidate.name
      .replace(CONTROL_CHARACTERS_GLOBAL, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 160)
    if (!name) continue
    seen.add(candidate.id)
    options.push({
      appId: candidate.id,
      name,
      imageUrl: steamStoreImageUrl(candidate.tiny_image),
      source: 'steam-store'
    })
    if (options.length >= MAX_METADATA_SEARCH_OPTIONS) break
  }
  return options
}
