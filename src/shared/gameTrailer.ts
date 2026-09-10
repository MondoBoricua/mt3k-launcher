import { youtubeVideoIdFromUrl } from './gameTitleMusic'

export interface GameTrailer {
  url: string
  format: 'hls' | 'file' | 'youtube' | 'external'
  /** Present only for validated YouTube watch, short or embed links. */
  youtubeVideoId?: string
  title: string
  source: 'steam' | 'xbox' | 'custom'
  /** True when the trailer comes from another store's exact-title match. */
  matchedByTitle: boolean
}

/** Skip rating cards and publisher bumpers at the beginning of ordinary trailers. */
export const GAME_TRAILER_INTRO_SKIP_SECONDS = 5
export const YOUTUBE_TRAILER_EMBED_ORIGIN = 'https://www.youtube-nocookie.com'
export const YOUTUBE_TRAILER_APP_REFERRER = 'https://com.orbit.launcher/'

export type CustomGameTrailerMedia =
  | { url: string; format: 'youtube'; youtubeVideoId: string }
  | { url: string; format: 'hls' | 'file' | 'external' }

export type YouTubeTrailerMode = 'background' | 'player'

/**
 * Returns the first useful playback position. Very short clips keep their full
 * runtime instead of seeking straight to the end.
 */
export function gameTrailerStartPosition(playableDuration: number, mediaStart = 0): number {
  const start = Number.isFinite(mediaStart) && mediaStart >= 0 ? mediaStart : 0
  if (Number.isFinite(playableDuration) && playableDuration > 0 &&
      playableDuration <= GAME_TRAILER_INTRO_SKIP_SECONDS + 0.25) return start
  return start + GAME_TRAILER_INTRO_SKIP_SECONDS
}

/** Only provider media hosts; never accept arbitrary renderer/network URLs. */
export function trailerMediaUrl(value: unknown, allowCustomHost = false): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return undefined
    if (!allowCustomHost && !/(^|\.)(steamstatic\.com|steamcdn-a\.akamaihd\.net|xboxservices\.com|xboxlive\.com|s-microsoft\.com)$/.test(url.hostname) &&
        url.hostname !== 'xbl-smooth-ssl-xboxlive-com.akamaized.net') return undefined
    url.protocol = 'https:'
    return url.href
  } catch { return undefined }
}

/**
 * Turns a user-selected trailer link into a bounded playback type. YouTube is
 * kept separate from ordinary media so it can never be assigned to a video src.
 */
export function customGameTrailerMedia(value: unknown): CustomGameTrailerMedia | undefined {
  const safeUrl = trailerMediaUrl(value, true)
  if (!safeUrl) return undefined
  const youtubeVideoId = youtubeVideoIdFromUrl(safeUrl)
  if (youtubeVideoId) return { url: safeUrl, format: 'youtube', youtubeVideoId }
  const path = new URL(safeUrl).pathname.toLocaleLowerCase('en-US')
  return {
    url: safeUrl,
    format: path.endsWith('.m3u8')
      ? 'hls'
      : /\.(?:mp4|m4v|webm|mov)$/u.test(path)
        ? 'file'
        : 'external'
  }
}

/** Exact-ID construction prevents arbitrary pages from entering the iframe. */
export function youtubeTrailerEmbedUrl(
  videoId: unknown,
  mode: YouTubeTrailerMode
): string | undefined {
  if (typeof videoId !== 'string' || !/^[\w-]{11}$/u.test(videoId)) return undefined
  const url = new URL(`/embed/${videoId}`, YOUTUBE_TRAILER_EMBED_ORIGIN)
  url.searchParams.set('autoplay', '1')
  url.searchParams.set('playsinline', '1')
  url.searchParams.set('rel', '0')
  url.searchParams.set('controls', '0')
  url.searchParams.set('disablekb', '1')
  url.searchParams.set('enablejsapi', '1')
  url.searchParams.set('fs', '0')
  url.searchParams.set('start', String(GAME_TRAILER_INTRO_SKIP_SECONDS))
  if (mode === 'background') {
    url.searchParams.set('mute', '1')
  }
  return url.href
}
