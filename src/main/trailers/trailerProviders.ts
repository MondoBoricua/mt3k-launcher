import type { GameTrailer } from '../../shared/gameTrailer'
import { trailerMediaUrl } from '../../shared/gameTrailer'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}

export function parseSteamTrailer(payload: unknown, appId: string): GameTrailer | null {
  const entry = object(object(payload)[appId])
  if (entry.success !== true) return null
  const movies = object(entry.data).movies
  if (!Array.isArray(movies)) return null
  for (const item of movies) {
    const movie = object(item)
    const url = trailerMediaUrl(movie.hls_h264) ?? trailerMediaUrl(object(movie.mp4).max) ??
      trailerMediaUrl(object(movie.webm).max) ?? trailerMediaUrl(object(movie.mp4)['480'])
    if (url) return { url, format: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : 'file',
      title: typeof movie.name === 'string' ? movie.name.slice(0, 240) : 'Trailer', source: 'steam', matchedByTitle: false }
  }
  return null
}

/** Xbox pages also contain recommendations. Only inspect the requested product. */
export function parseXboxTrailer(html: string, productId: string): GameTrailer | null {
  const encoded = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;[\s\S]*?<\/script>/)?.[1]
  if (!encoded) return null
  let state: unknown
  try { state = JSON.parse(encoded) } catch { return null }
  let visited = 0
  function visit(value: unknown, depth: number): GameTrailer | null {
    if (depth > 30 || ++visited > 60_000) return null
    const node = object(value)
    const product = object(node[productId] ?? (node.productId === productId ? node : undefined))
    const videos = [product.videos, product.cmsVideos].flatMap((items) => Array.isArray(items) ? items : [])
    for (const item of videos) {
      const video = object(item)
      if (typeof video.purpose !== 'string' || !/trailer/i.test(video.purpose)) continue
      const url = trailerMediaUrl(video.url)
      if (url) return { url, format: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : 'file',
        title: typeof video.title === 'string' ? video.title.slice(0, 240) : 'Trailer', source: 'xbox', matchedByTitle: false }
    }
    for (const child of Array.isArray(value) ? value : Object.values(node)) {
      if (child && typeof child === 'object') {
        const result = visit(child, depth + 1)
        if (result) return result
      }
    }
    return null
  }
  return visit(state, 0)
}

export function exactSteamTrailerMatch(payload: unknown, name: string): string | null {
  // Preserve edition names and numbers; never fuzzy-match sequels or remasters.
  const normalize = (text: string): string => text.replace(/[™®©]/g, '').normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLocaleLowerCase('en')
  const items = object(payload).items
  if (!Array.isArray(items) || !normalize(name)) return null
  const matches = items.filter((item) => {
    const entry = object(item)
    return entry.type === 'app' && Number.isSafeInteger(entry.id) && Number(entry.id) > 0 &&
      typeof entry.name === 'string' && normalize(entry.name) === normalize(name)
  })
  return matches.length === 1 ? String(object(matches[0]).id) : null
}
