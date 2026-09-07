import { createHash, randomUUID } from 'node:crypto'
import type { TitleMusicAudioSource } from './titleMusicSabrService'
import { titleMusicStreamExtension } from '@shared/titleMusicAudio'

const STREAM_LIFETIME_MS = 25 * 60_000
const MAX_STREAMS = 100
const STREAM_PATH = /^\/([a-f0-9]{64})\.(?:webm|m4a)$/u
const streams = new Map<string, { source: TitleMusicAudioSource; expiresAt: number }>()

function pruneStreams(now = Date.now()): void {
  for (const [token, stream] of streams) {
    if (stream.expiresAt <= now) streams.delete(token)
  }
  while (streams.size > MAX_STREAMS) {
    const oldest = streams.keys().next().value
    if (typeof oldest !== 'string') break
    streams.delete(oldest)
  }
}

export function registerTitleMusicStream(source: TitleMusicAudioSource): string {
  pruneStreams()
  const token = createHash('sha256')
    .update(`${source.videoId}\0${randomUUID()}`)
    .digest('hex')
  streams.set(token, { source, expiresAt: Date.now() + STREAM_LIFETIME_MS })
  pruneStreams()
  return `orbit-media://title-music/${token}.${titleMusicStreamExtension(source.mimeType)}`
}

function streamForRequest(value: string): TitleMusicAudioSource | undefined {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'orbit-media:' ||
      url.hostname !== 'title-music' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    const token = STREAM_PATH.exec(url.pathname)?.[1]
    if (!token) return undefined
    const stream = streams.get(token)
    if (!stream || stream.expiresAt <= Date.now()) {
      if (stream) streams.delete(token)
      return undefined
    }
    return stream.source
  } catch {
    return undefined
  }
}

function responseHeaders(mimeType: string): HeadersInit {
  return {
    'accept-ranges': 'none',
    'cache-control': 'no-store',
    'content-type': mimeType
  }
}

export function handleTitleMusicMediaRequest(request: Request): Promise<Response> | undefined {
  const source = streamForRequest(request.url)
  if (!source) return undefined
  if (request.method === 'HEAD') {
    return Promise.resolve(new Response(null, { status: 200, headers: responseHeaders(source.mimeType) }))
  }
  if (request.method !== 'GET') {
    return Promise.resolve(new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } }))
  }
  return source.open().then(({ abort, mimeType, stream }) => {
    const reader = stream.getReader()
    const stop = (): void => {
      void reader.cancel().catch(() => undefined)
      abort()
    }
    request.signal.addEventListener('abort', stop, { once: true })
    const responseStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            request.signal.removeEventListener('abort', stop)
            controller.close()
            return
          }
          controller.enqueue(value)
        } catch (error) {
          request.signal.removeEventListener('abort', stop)
          controller.error(error)
        }
      },
      cancel() {
        request.signal.removeEventListener('abort', stop)
        stop()
      }
    })
    return new Response(responseStream, {
      status: 200,
      headers: responseHeaders(mimeType)
    })
  }).catch(() => new Response(null, { status: 502 }))
}
