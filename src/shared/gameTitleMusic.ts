export interface GameTitleMusic {
  videoId: string
  title: string
  author?: string
  durationSeconds?: number
  url: string
  mimeType: string
  source: 'youtube'
}

export const GAME_TITLE_MUSIC_ENABLED_DEFAULT = true
export const GAME_TITLE_MUSIC_VOLUME_MIN = 0
export const GAME_TITLE_MUSIC_VOLUME_MAX = 100
export const GAME_TITLE_MUSIC_VOLUME_DEFAULT = 10
export const GAME_TITLE_MUSIC_VOLUME_STEP = 5

export const GAME_TITLE_MUSIC_DELAY_MIN = 0
export const GAME_TITLE_MUSIC_DELAY_MAX = 5
export const GAME_TITLE_MUSIC_DELAY_DEFAULT = 0.5
export const GAME_TITLE_MUSIC_DELAY_STEP = 0.5

export const GAME_TITLE_MUSIC_FADE_MIN = 0
export const GAME_TITLE_MUSIC_FADE_MAX = 2
export const GAME_TITLE_MUSIC_FADE_DEFAULT = 0.1
export const GAME_TITLE_MUSIC_FADE_STEP = 0.1

export function youtubeVideoIdFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4_096) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
    const host = url.hostname.toLocaleLowerCase('en-US')
    let candidate: string | null | undefined
    if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0]
    else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      candidate = url.searchParams.get('v')
      if (!candidate) {
        const parts = url.pathname.split('/').filter(Boolean)
        if (parts[0] === 'shorts' || parts[0] === 'embed') candidate = parts[1]
      }
    }
    return candidate && /^[\w-]{11}$/u.test(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

function normalizedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  precision: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const clamped = Math.max(minimum, Math.min(maximum, value))
  const factor = 10 ** precision
  return Math.round(clamped * factor) / factor
}

export function normalizeGameTitleMusicVolume(value: unknown): number {
  return normalizedNumber(
    value,
    GAME_TITLE_MUSIC_VOLUME_DEFAULT,
    GAME_TITLE_MUSIC_VOLUME_MIN,
    GAME_TITLE_MUSIC_VOLUME_MAX,
    0
  )
}

export function normalizeGameTitleMusicDelay(value: unknown): number {
  return normalizedNumber(
    value,
    GAME_TITLE_MUSIC_DELAY_DEFAULT,
    GAME_TITLE_MUSIC_DELAY_MIN,
    GAME_TITLE_MUSIC_DELAY_MAX,
    1
  )
}

export function normalizeGameTitleMusicFade(value: unknown): number {
  return normalizedNumber(
    value,
    GAME_TITLE_MUSIC_FADE_DEFAULT,
    GAME_TITLE_MUSIC_FADE_MIN,
    GAME_TITLE_MUSIC_FADE_MAX,
    1
  )
}

export function isGameTitleMusicVolume(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= GAME_TITLE_MUSIC_VOLUME_MIN &&
    value <= GAME_TITLE_MUSIC_VOLUME_MAX
  )
}

export function isGameTitleMusicDelay(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= GAME_TITLE_MUSIC_DELAY_MIN &&
    value <= GAME_TITLE_MUSIC_DELAY_MAX
  )
}

export function isGameTitleMusicFade(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= GAME_TITLE_MUSIC_FADE_MIN &&
    value <= GAME_TITLE_MUSIC_FADE_MAX
  )
}
