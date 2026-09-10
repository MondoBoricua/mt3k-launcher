import { type Language, languageCountry } from '@shared/language'
import { createHash } from 'node:crypto'
import Store from 'electron-store'
import type { LibraryGame } from '@shared/ipc'
import { youtubeVideoIdFromUrl, type GameTitleMusic } from '@shared/gameTitleMusic'
import {
  normalizeMediaSearchQuery,
  type MediaLinkSearchOption,
  type MediaLinkSearchResult
} from '@shared/mediaLinkSearch'
import {
  rankThemeMusicCandidates,
  searchTitleForGame,
  type ThemeMusicCandidate
} from './themeMusicCandidates'
import { evaluateYouTubePlayerScript } from './youtubePlayerEvaluator'
import { registerTitleMusicStream } from './titleMusicProtocol'
import { prepareTitleMusicAudioSource } from './titleMusicSabrService'

export { handleTitleMusicMediaRequest } from './titleMusicProtocol'

interface CachedSelection {
  gameName: string
  candidates: ThemeMusicCandidate[]
  expiresAt: number
  lastUsedAt: number
}

interface TitleMusicCache {
  selections: Record<string, CachedSelection>
}

const CACHE_VERSION = 2
const POSITIVE_TTL = 30 * 24 * 60 * 60_000
const NEGATIVE_TTL = 12 * 60 * 60_000
const MAX_CACHE_ENTRIES = 500
const sessionTasks = new Map<Language, Promise<import('youtubei.js').Innertube>>()
const resolutionTasks = new Map<string, Promise<GameTitleMusic | null>>()
const cacheStore = new Store<TitleMusicCache>({
  name: 'orbit-title-music',
  defaults: { selections: {} }
})

const timedFetch: typeof fetch = (input, init) => {
  const requestInit = init ?? {}
  const timeout = AbortSignal.timeout(15_000)
  const signal = requestInit.signal ? AbortSignal.any([requestInit.signal, timeout]) : timeout
  return globalThis.fetch(input, { ...requestInit, signal })
}

function cacheKey(game: LibraryGame): string {
  return createHash('sha256')
    .update(`${CACHE_VERSION}\0${game.provider}\0${game.id}\0${game.name}\0${game.metadata.titleMusicUrl ?? ''}`)
    .digest('hex')
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!value || typeof value !== 'object') return undefined
  const text = (value as { text?: unknown }).text
  return typeof text === 'string' && text.trim() ? text.trim() : undefined
}

function candidateFromResult(value: unknown): ThemeMusicCandidate | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as {
    video_id?: unknown
    title?: unknown
    author?: { name?: unknown }
    duration?: { seconds?: unknown }
    is_live?: unknown
    is_upcoming?: unknown
  }
  const videoId = typeof result.video_id === 'string' ? result.video_id : ''
  const title = textValue(result.title)
  if (!videoId || !title || result.is_live === true || result.is_upcoming === true) return undefined
  const seconds = result.duration?.seconds
  return {
    videoId,
    title,
    author: textValue(result.author?.name),
    durationSeconds: typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : undefined
  }
}

function mediaOptionFromResult(value: unknown): MediaLinkSearchOption | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as {
    video_id?: unknown
    title?: unknown
    author?: { name?: unknown }
    duration?: { seconds?: unknown }
    is_live?: unknown
    is_upcoming?: unknown
  }
  const videoId = typeof result.video_id === 'string' ? result.video_id.trim() : ''
  const rawTitle = textValue(result.title)
  if (
    !/^[A-Za-z0-9_-]{11}$/.test(videoId) ||
    !rawTitle ||
    result.is_live === true ||
    result.is_upcoming === true
  ) {
    return undefined
  }
  const seconds = result.duration?.seconds
  const author = textValue(result.author?.name)?.slice(0, 160)
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
    title: rawTitle.slice(0, 240),
    author,
    durationSeconds:
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? Math.min(Math.round(seconds), 24 * 60 * 60)
        : undefined
  }
}

function storeCandidates(key: string, gameName: string, candidates: ThemeMusicCandidate[]): void {
  const now = Date.now()
  const selections = {
    ...cacheStore.get('selections'),
    [key]: {
      gameName,
      candidates,
      expiresAt: now + (candidates.length ? POSITIVE_TTL : NEGATIVE_TTL),
      lastUsedAt: now
    }
  }
  const entries = Object.entries(selections)
  if (entries.length > MAX_CACHE_ENTRIES) {
    entries
      .sort(([, left], [, right]) => right.lastUsedAt - left.lastUsedAt)
      .slice(MAX_CACHE_ENTRIES)
      .forEach(([staleKey]) => delete selections[staleKey])
  }
  cacheStore.set('selections', selections)
}

async function youtube(language: Language): Promise<import('youtubei.js').Innertube> {
  let task = sessionTasks.get(language)
  if (!task) {
    task = import('youtubei.js')
      .then(({ Innertube, Platform }) => {
        Platform.shim.eval = evaluateYouTubePlayerScript
        return Innertube.create({
          lang: language,
          location: languageCountry(language),
          enable_safety_mode: true,
          generate_session_locally: true,
          retrieve_player: false,
          fetch: timedFetch
        })
      })
      .catch((error) => {
        sessionTasks.delete(language)
        throw error
      })
    sessionTasks.set(language, task)
  }
  return task
}

export async function searchYouTubeMedia(
  queryValue: unknown,
  language: Language
): Promise<MediaLinkSearchResult> {
  const query = normalizeMediaSearchQuery(queryValue)
  if (!query) throw new Error('Invalid media search query')
  const client = await youtube(language)
  const results = await client.search(query, { type: 'video' })
  const options = results.results
    .map(mediaOptionFromResult)
    .filter((item): item is MediaLinkSearchOption => Boolean(item))
    .slice(0, 18)
  return { state: options.length ? 'ready' : 'missing', query, options }
}

async function searchCandidates(
  game: LibraryGame,
  language: Language
): Promise<ThemeMusicCandidate[]> {
  const client = await youtube(language)
  const title = searchTitleForGame(game.name)
  const results = await client.search(`${title} main theme official soundtrack`, { type: 'video' })
  return rankThemeMusicCandidates(
    title,
    results.results.map(candidateFromResult).filter((item): item is ThemeMusicCandidate => Boolean(item))
  )
}

async function resolveStream(
  candidate: ThemeMusicCandidate
): Promise<GameTitleMusic | null> {
  try {
    const source = await prepareTitleMusicAudioSource(candidate.videoId)
    return {
      ...candidate,
      url: registerTitleMusicStream(source),
      mimeType: source.mimeType,
      source: 'youtube'
    }
  } catch (error) {
    console.warn(`[title-music] Could not prepare audio for ${candidate.videoId}:`, error)
    return null
  }
}

async function resolve(
  game: LibraryGame,
  language: Language,
  key: string
): Promise<GameTitleMusic | null> {
  const selectedVideoId = youtubeVideoIdFromUrl(game.metadata.titleMusicUrl)
  if (selectedVideoId) {
    return resolveStream({
      videoId: selectedVideoId,
      title: `${game.name} — selected soundtrack`
    })
  }
  const now = Date.now()
  const cached = cacheStore.get('selections')[key]
  let candidates = cached?.expiresAt > now ? cached.candidates : undefined
  const usedCachedCandidates = Boolean(candidates?.length)

  if (!candidates) {
    candidates = await searchCandidates(game, language)
    storeCandidates(key, game.name, candidates)
  } else {
    storeCandidates(key, game.name, candidates)
  }
  if (!candidates.length) return null

  for (const candidate of candidates) {
    const music = await resolveStream(candidate)
    if (music) return music
  }

  if (usedCachedCandidates) {
    const refreshed = await searchCandidates(game, language)
    storeCandidates(key, game.name, refreshed)
    for (const candidate of refreshed) {
      const music = await resolveStream(candidate)
      if (music) return music
    }
  }
  return null
}

export function resolveGameTitleMusic(
  game: LibraryGame,
  language: Language
): Promise<GameTitleMusic | null> {
  const key = cacheKey(game)
  const current = resolutionTasks.get(key)
  if (current) return current
  const task = resolve(game, language, key)
    .catch(() => null)
    .finally(() => resolutionTasks.delete(key))
  resolutionTasks.set(key, task)
  return task
}
