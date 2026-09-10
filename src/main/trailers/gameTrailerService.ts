import { type Language, languageLocale, steamLanguage, languageCountry } from '@shared/language'
import type { LibraryGame } from '@shared/ipc'
import { customGameTrailerMedia, type GameTrailer } from '@shared/gameTrailer'
import { fetchWithElectronNet } from '../networkFetch'
import { parseSteamTrailer, parseXboxTrailer, exactSteamTrailerMatch } from './trailerProviders'

const cache = new Map<string, { trailer: GameTrailer | null; expires: number }>()
const pending = new Map<string, Promise<GameTrailer | null>>()

function manualTrailer(game: LibraryGame): GameTrailer | null {
  const media = customGameTrailerMedia(game.metadata.trailerUrl)
  if (!media) return null
  return {
    ...media,
    title: `${game.name} — Trailer`,
    source: 'custom',
    matchedByTitle: false
  }
}

async function resolve(game: LibraryGame, language: Language): Promise<GameTrailer | null> {
  const selected = manualTrailer(game)
  if (selected) return selected
  // One total deadline for all native-source and exact-match fallback requests.
  const signal = AbortSignal.timeout(18_000)
  const request = async (url: string): Promise<Response> => {
    const response = await fetchWithElectronNet(url, { signal })
    if (!response.ok) throw new Error('Trailer source unavailable')
    return response
  }
  const steam = async (id: string): Promise<GameTrailer | null> => {
    const response = await request(`https://store.steampowered.com/api/appdetails?appids=${id}&l=${steamLanguage(language)}&cc=${languageCountry(language)}`)
    return parseSteamTrailer(await response.json(), id)
  }
  if (game.provider === 'steam' && /^\d+$/.test(game.providerGameId)) return steam(game.providerGameId)
  if (game.provider === 'xbox') {
    const id = [game.metadata.providerStoreId, game.providerGameId,
      game.metadata.storeUrl?.match(/\/([A-Z0-9]{12})(?:[/?#]|$)/i)?.[1]]
      .find((candidate) => candidate && /^[A-Z0-9]{12}$/i.test(candidate))
    if (id) {
      try {
        const response = await request(`https://www.xbox.com/${languageLocale(language)}/games/store/game/${id.toUpperCase()}`)
        const trailer = parseXboxTrailer(await response.text(), id.toUpperCase())
        if (trailer) return trailer
      } catch { if (signal.aborted) return null }
    }
  }
  // Original retro releases must not be confused with later PC editions.
  if (game.provider === 'retro') return null
  const response = await request(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game.name)}&l=${steamLanguage(language)}&cc=${languageCountry(language)}`)
  const id = exactSteamTrailerMatch(await response.json(), game.name)
  if (!id) return null
  const trailer = await steam(id)
  return trailer ? { ...trailer, matchedByTitle: true } : null
}

/** Lazy, coalesced and bounded: opening a panel never starts a library-wide scan. */
export function resolveGameTrailer(game: LibraryGame, language: Language): Promise<GameTrailer | null> {
  const key = `${game.id}:${language}:${game.name}:${game.metadata.providerStoreId ?? ''}:${game.metadata.trailerUrl ?? ''}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.trailer)
  const existing = pending.get(key)
  if (existing) return existing
  if (pending.size >= 4) return Promise.resolve(null)
  const task = resolve(game, language).catch(() => null).then((trailer) => {
    cache.delete(key)
    cache.set(key, { trailer, expires: Date.now() + (trailer ? 6 * 60 * 60_000 : 60_000) })
    if (cache.size > 128) cache.delete(cache.keys().next().value!)
    return trailer
  }).finally(() => pending.delete(key))
  pending.set(key, task)
  return task
}
