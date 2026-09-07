import { createContext, Script } from 'node:vm'
import { session } from 'electron'
import { SabrStream } from 'googlevideo/sabr-stream'
import type { FormatStream } from 'googlevideo/shared-types'
import { buildSabrFormat, EnabledTrackTypes } from 'googlevideo/utils'
import { Innertube, Platform } from 'youtubei.js'
import { evaluateYouTubePlayerScript } from './youtubePlayerEvaluator'
import { generateTitleMusicPoToken, type TitleMusicChallenge } from './titleMusicPoTokenService'
import { selectTitleMusicAudioFormat } from '@shared/titleMusicAudio'

const MAX_WATCH_PAGE_BYTES = 6 * 1024 * 1024
const MAX_INTERPRETER_BYTES = 2 * 1024 * 1024

interface InitialAttestationData {
  R?: { bgChallenge?: RawChallenge }
  T?: string
}

interface RawChallenge {
  program?: string
  globalName?: string
  interpreterJavascript?: { privateDoNotAccessOrElseSafeScriptWrappedValue?: string }
  interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string }
}

interface RawPlayerResponse {
  videoDetails?: { videoId?: string }
  streamingData?: {
    serverAbrStreamingUrl?: string
    adaptiveFormats?: FormatStream[]
  }
  playerConfig?: {
    mediaCommonConfig?: {
      mediaUstreamerRequestConfig?: { videoPlaybackUstreamerConfig?: string }
    }
  }
}

interface YouTubeConfig {
  INNERTUBE_CLIENT_VERSION?: string
  INNERTUBE_CONTEXT_CLIENT_NAME?: number
  INNERTUBE_CONTEXT?: {
    client?: Record<string, unknown> & {
      clientName?: string
      clientVersion?: string
      visitorData?: string
    }
  }
  PLAYER_JS_URL?: string
  VISITOR_DATA?: string
  [key: string]: unknown
}

export interface OpenTitleMusicAudio {
  abort: () => void
  mimeType: string
  stream: ReadableStream<Uint8Array>
}

export interface TitleMusicAudioSource {
  mimeType: string
  open: () => Promise<OpenTitleMusicAudio>
  videoId: string
}

const timedFetch: typeof fetch = (input, init) => {
  const requestInit = init ?? {}
  const timeout = AbortSignal.timeout(20_000)
  const signal = requestInit.signal ? AbortSignal.any([requestInit.signal, timeout]) : timeout
  return globalThis.fetch(input, { ...requestInit, signal })
}

function parseAttestation(value: string): InitialAttestationData {
  if (value.length > 1_000_000) throw new Error('YouTube attestation data is too large')
  const context = createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }
  })
  const parsed = new Script(`(${value})`).runInContext(context, { timeout: 1000 })
  return structuredClone(parsed) as InitialAttestationData
}

function watchPageParts(html: string): {
  attestation: InitialAttestationData
  config: YouTubeConfig
  playerResponse: RawPlayerResponse
} {
  if (html.length > MAX_WATCH_PAGE_BYTES) throw new Error('YouTube watch page is too large')
  const configSource = html.match(/ytcfg\.set\((\{.+?\})\);/su)?.[1]
  const attestationSource = html.match(/window\.ytAtN\(\s*(\{[\s\S]*?\})\s*\)/u)?.[1]
  const playerResponseSource = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/su)?.[1]
  if (!configSource || !attestationSource || !playerResponseSource) {
    throw new Error('YouTube watch page is missing audio stream data')
  }
  return {
    attestation: parseAttestation(attestationSource),
    config: JSON.parse(configSource) as YouTubeConfig,
    playerResponse: JSON.parse(playerResponseSource) as RawPlayerResponse
  }
}

function validVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/u.test(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function challengeForPage(
  initial: InitialAttestationData,
  context: NonNullable<YouTubeConfig['INNERTUBE_CONTEXT']>,
  visitorData: string
): Promise<RawChallenge> {
  if (initial.R?.bgChallenge) return initial.R.bgChallenge
  const clientVersion = text(context.client?.clientVersion)
  if (!clientVersion) throw new Error('YouTube client version is unavailable')
  const response = await timedFetch(
    'https://www.youtube.com/youtubei/v1/att/get?prettyPrint=false&alt=json',
    {
      method: 'POST',
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        'x-goog-visitor-id': visitorData,
        'x-youtube-client-version': clientVersion,
        'x-youtube-client-name': '1'
      },
      body: JSON.stringify({
        engagementType: 'ENGAGEMENT_TYPE_UNBOUND',
        eacrToken: initial.T,
        context
      })
    }
  )
  if (!response.ok) throw new Error(`YouTube attestation request failed (${response.status})`)
  const result = await response.json() as { bgChallenge?: RawChallenge }
  if (!result.bgChallenge) throw new Error('YouTube attestation challenge is unavailable')
  return result.bgChallenge
}

async function normalizedChallenge(raw: RawChallenge): Promise<TitleMusicChallenge> {
  const program = text(raw.program)
  const globalName = text(raw.globalName)
  let interpreterJavascript = text(
    raw.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
  )
  const interpreterPath = text(
    raw.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  )
  if (!program || !globalName) throw new Error('YouTube attestation challenge is incomplete')
  if (!interpreterJavascript && interpreterPath) {
    const interpreterUrl = interpreterPath.startsWith('//')
      ? `https:${interpreterPath}`
      : interpreterPath
    const url = new URL(interpreterUrl)
    if (url.protocol !== 'https:' || (url.hostname !== 'www.google.com' && url.hostname !== 'www.youtube.com')) {
      throw new Error('YouTube attestation interpreter URL is invalid')
    }
    const response = await timedFetch(url)
    if (!response.ok) throw new Error(`YouTube interpreter request failed (${response.status})`)
    interpreterJavascript = await response.text()
  }
  if (!interpreterJavascript || interpreterJavascript.length > MAX_INTERPRETER_BYTES) {
    throw new Error('YouTube attestation interpreter is unavailable')
  }
  return { program, globalName, interpreterJavascript }
}

function validSabrUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (
      url.hostname === 'www.youtube.com' ||
      url.hostname.endsWith('.googlevideo.com')
    )
  } catch {
    return false
  }
}

export async function prepareTitleMusicAudioSource(videoId: string): Promise<TitleMusicAudioSource> {
  if (!validVideoId(videoId)) throw new Error('Invalid title music video ID')
  const response = await timedFetch(
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&bpctr=9999999999&has_verified=1`,
    {
      headers: {
        'accept-language': 'en-US',
        'user-agent': session.defaultSession.getUserAgent()
      }
    }
  )
  if (!response.ok) throw new Error(`YouTube watch page request failed (${response.status})`)
  const { attestation, config, playerResponse } = watchPageParts(await response.text())
  if (playerResponse.videoDetails?.videoId !== videoId) {
    throw new Error('YouTube returned a different title music video')
  }
  const context = config.INNERTUBE_CONTEXT
  if (!context?.client) throw new Error('YouTube client context is unavailable')
  const clientContext = context.client

  Platform.shim.eval = evaluateYouTubePlayerScript
  const youtube = await Innertube.create({
    enable_safety_mode: true,
    generate_session_locally: true,
    lang: 'en',
    location: 'US',
    player_id: config.PLAYER_JS_URL?.match(/player\/([^/]+)\//u)?.[1],
    visitor_data: text(clientContext.visitorData) ?? text(config.VISITOR_DATA),
    fetch: timedFetch
  })
  const visitorData = text(clientContext.visitorData)
    ?? text(config.VISITOR_DATA)
    ?? text(youtube.session.context.client.visitorData)
  if (!visitorData) throw new Error('YouTube visitor data is unavailable')
  clientContext.visitorData = visitorData

  const challenge = await normalizedChallenge(await challengeForPage(attestation, context, visitorData))
  const poToken = await generateTitleMusicPoToken(videoId, challenge, config)
  const rawSabrUrl = text(playerResponse.streamingData?.serverAbrStreamingUrl)
  const videoPlaybackUstreamerConfig = text(
    playerResponse.playerConfig?.mediaCommonConfig
      ?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig
  )
  const serverAbrStreamingUrl = rawSabrUrl
    ? await youtube.session.player?.decipher(rawSabrUrl)
    : undefined
  if (!serverAbrStreamingUrl || !validSabrUrl(serverAbrStreamingUrl)) {
    throw new Error('YouTube SABR audio URL is unavailable')
  }
  if (!videoPlaybackUstreamerConfig) throw new Error('YouTube audio stream config is unavailable')

  const formats = (playerResponse.streamingData?.adaptiveFormats ?? []).map(buildSabrFormat)
  const audioFormat = selectTitleMusicAudioFormat(formats)
  if (!audioFormat?.mimeType) throw new Error('Compatible YouTube audio is unavailable')
  const mimeType = audioFormat.mimeType
  const clientName = Number(config.INNERTUBE_CONTEXT_CLIENT_NAME ?? 1)
  const clientVersion = text(config.INNERTUBE_CLIENT_VERSION) ?? text(clientContext.clientVersion)
  if (!Number.isSafeInteger(clientName) || !clientVersion) {
    throw new Error('YouTube SABR client data is unavailable')
  }

  return {
    videoId,
    mimeType,
    open: async () => {
      const sabr = new SabrStream({
        formats,
        serverAbrStreamingUrl,
        videoPlaybackUstreamerConfig,
        poToken,
        clientInfo: {
          clientName,
          clientVersion,
          osName: text(clientContext.osName),
          osVersion: text(clientContext.osVersion)
        }
      })
      const { audioStream, selectedFormats } = await sabr.start({
        audioFormat,
        audioQuality: 'medium',
        enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
        maxRetries: 3,
        preferOpus: mimeType.includes('opus'),
        preferWebM: mimeType.startsWith('audio/webm'),
        stallDetectionMs: 15_000
      })
      return {
        stream: audioStream,
        mimeType: selectedFormats.audioFormat.mimeType ?? mimeType,
        abort: () => sabr.abort()
      }
    }
  }
}
