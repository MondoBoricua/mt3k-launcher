import { safeExternalHttpsUrl } from './externalUrl'
import { youtubeVideoIdFromUrl } from './gameTitleMusic'

export const GAME_MEDIA_LINK_KINDS = ['trailer', 'title-music'] as const
export type GameMediaLinkKind = (typeof GAME_MEDIA_LINK_KINDS)[number]

export interface MediaLinkSearchOption {
  /** YouTube video identity validated in the main process. */
  videoId: string
  url: string
  thumbnailUrl: string
  title: string
  author?: string
  durationSeconds?: number
}

export interface MediaLinkSearchResult {
  state: 'ready' | 'missing' | 'unavailable'
  query: string
  options: MediaLinkSearchOption[]
}

export interface MediaLinkPasteResult {
  state: 'ready' | 'empty' | 'invalid'
  url?: string
}

const MAX_GAME_NAME_LENGTH = 160
export const MAX_MEDIA_SEARCH_QUERY_LENGTH = 180
const MAX_MEDIA_LINK_LENGTH = 4_096
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/gu

export function isGameMediaLinkKind(value: unknown): value is GameMediaLinkKind {
  return GAME_MEDIA_LINK_KINDS.includes(value as GameMediaLinkKind)
}

export function normalizeMediaSearchQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const query = value.normalize('NFKC').trim()
  if (
    query.length < 2 ||
    query.length > MAX_MEDIA_SEARCH_QUERY_LENGTH ||
    CONTROL_CHARACTERS.test(query)
  ) {
    return undefined
  }
  return query
}

function suggestedQuery(gameNameValue: string, suffix: string): string {
  const gameName = gameNameValue
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS_GLOBAL, ' ')
    .trim()
    .slice(0, MAX_GAME_NAME_LENGTH)
  return `${gameName} ${suffix}`.trim().slice(0, MAX_MEDIA_SEARCH_QUERY_LENGTH)
}

export function mediaLinkSearchSuggestions(
  gameName: string,
  kind: GameMediaLinkKind
): readonly string[] {
  const suffixes =
    kind === 'trailer'
      ? ['official trailer', 'gameplay trailer', 'launch trailer']
      : ['main theme', 'official soundtrack', 'title screen music']
  return suffixes.map((suffix) => suggestedQuery(gameName, suffix))
}

export function youtubeSearchUrl(queryValue: unknown): string | undefined {
  const query = normalizeMediaSearchQuery(queryValue)
  if (!query) return undefined
  const url = new URL('https://www.youtube.com/results')
  url.searchParams.set('search_query', query)
  return url.toString()
}

export function canonicalYouTubeVideoUrl(value: unknown): string | undefined {
  const videoId = youtubeVideoIdFromUrl(value)
  return videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : undefined
}

/**
 * Keeps clipboard access narrow: only a validated media URL ever crosses IPC.
 * Arbitrary clipboard text remains in the main process.
 */
export function normalizePastedMediaLink(
  value: unknown,
  kind: GameMediaLinkKind
): MediaLinkPasteResult {
  if (typeof value !== 'string' || !value.trim()) return { state: 'empty' }
  const candidate = value.trim()
  if (candidate.length > MAX_MEDIA_LINK_LENGTH || CONTROL_CHARACTERS.test(candidate)) {
    return { state: 'invalid' }
  }
  if (kind === 'title-music') {
    const url = canonicalYouTubeVideoUrl(candidate)
    return url ? { state: 'ready', url } : { state: 'invalid' }
  }
  const url = safeExternalHttpsUrl(candidate)
  return url ? { state: 'ready', url } : { state: 'invalid' }
}
