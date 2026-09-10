import type { GameTrailer } from './gameTrailer'
import {
  MAX_MEDIA_SEARCH_QUERY_LENGTH,
  normalizeMediaSearchQuery,
  type MediaLinkSearchOption
} from './mediaLinkSearch'

export type AchievementGuideResult =
  | { state: 'ready'; achievementId: string; trailer: GameTrailer }
  | { state: 'missing' | 'unavailable' | 'locked'; achievementId: string }

const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/gu

function searchPart(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS_GLOBAL, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

/**
 * Achievement names come from the provider, never from a renderer-supplied
 * search box. Fixed budgets keep the useful name and the guide intent intact.
 */
export function achievementGuideSearchQuery(
  gameNameValue: unknown,
  achievementNameValue: unknown
): string | undefined {
  const achievementName = searchPart(achievementNameValue, 88)
  const gameName = searchPart(gameNameValue, 60)
  if (!achievementName || !gameName) return undefined
  return normalizeMediaSearchQuery(
    `${achievementName} ${gameName} achievement guide walkthrough`.slice(
      0,
      MAX_MEDIA_SEARCH_QUERY_LENGTH
    )
  )
}

/** Construct playback only from the validated YouTube ID, never its result URL. */
export function achievementGuideTrailer(
  option: MediaLinkSearchOption
): GameTrailer | undefined {
  const videoId = option.videoId.trim()
  const title = option.title.normalize('NFKC').trim().slice(0, 240)
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId) || !title) return undefined
  return {
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    format: 'youtube',
    youtubeVideoId: videoId,
    title,
    source: 'custom',
    matchedByTitle: false
  }
}
