import {
  EDITABLE_GAME_METADATA_KEYS,
  type GameCompletionTimes,
  type GameMetadataOverrides,
  type GameMetadataUpdateInput,
  type GamePlatform,
  type GameSystemRequirements
} from '../../shared/ipc'
import { safeExternalHttpsUrl } from '../../shared/externalUrl'
import { youtubeVideoIdFromUrl } from '../../shared/gameTitleMusic'

const EDITABLE_KEYS = new Set<string>(EDITABLE_GAME_METADATA_KEYS)
const PLATFORMS = new Set<GamePlatform>(['windows', 'macos', 'linux'])
const LIST_LIMIT = 64

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function cleanText(value: unknown, label: string, maximumLength: number): string | null {
  if (value === null || value === '') return null
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`)
  }
  return value.trim() || null
}

function cleanUrl(
  value: unknown,
  label: string,
  allowedHosts?: (hostname: string) => boolean
): string | null {
  const text = cleanText(value, label, 4_096)
  if (text === null) return null
  const normalized = safeExternalHttpsUrl(text)
  if (!normalized) throw new Error(`Invalid ${label}`)
  const url = new URL(normalized)
  if (allowedHosts && !allowedHosts(url.hostname.toLocaleLowerCase('en-US'))) {
    throw new Error(`Invalid ${label}`)
  }
  return normalized
}

function cleanList(value: unknown, label: string): string[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > LIST_LIMIT) throw new Error(`Invalid ${label}`)
  const output = value.map((item) => cleanText(item, label, 160)).filter((item): item is string => Boolean(item))
  return output.length > 0 ? [...new Set(output)] : null
}

function cleanInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function cleanNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function cleanRequirements(value: unknown): GameSystemRequirements | null {
  if (value === null) return null
  const input = record(value, 'system requirements')
  if (Object.keys(input).some((key) => key !== 'minimum' && key !== 'recommended')) {
    throw new Error('Invalid system requirements')
  }
  const minimum = cleanText(input.minimum ?? null, 'minimum requirements', 20_000) ?? undefined
  const recommended = cleanText(input.recommended ?? null, 'recommended requirements', 20_000) ?? undefined
  return minimum || recommended ? { minimum, recommended } : null
}

function cleanCompletionTimes(value: unknown): GameCompletionTimes | null {
  if (value === null) return null
  const input = record(value, 'completion times')
  const state = input.state === 'available' ? 'available' : input.state === 'unavailable' ? 'unavailable' : undefined
  if (!state) throw new Error('Invalid completion-time state')
  const sourceUrl = cleanUrl(
    input.sourceUrl ?? null,
    'HowLongToBeat URL',
    (host) => host === 'howlongtobeat.com' || host.endsWith('.howlongtobeat.com')
  ) ?? undefined
  return {
    state,
    provider: 'howlongtobeat',
    mainStoryMinutes: cleanInteger(input.mainStoryMinutes ?? null, 'main story time', 1, 10_000_000) ?? undefined,
    mainExtraMinutes: cleanInteger(input.mainExtraMinutes ?? null, 'main plus extras time', 1, 10_000_000) ?? undefined,
    completionistMinutes: cleanInteger(input.completionistMinutes ?? null, 'completionist time', 1, 10_000_000) ?? undefined,
    allStylesMinutes: cleanInteger(input.allStylesMinutes ?? null, 'all styles time', 1, 10_000_000) ?? undefined,
    sourceGameId: cleanInteger(input.sourceGameId ?? null, 'HowLongToBeat game ID', 1, Number.MAX_SAFE_INTEGER) ?? undefined,
    sourceTitle: cleanText(input.sourceTitle ?? null, 'HowLongToBeat title', 240) ?? undefined,
    sourceUrl,
    confidence: cleanNumber(input.confidence ?? null, 'HowLongToBeat confidence', 0, 1) ?? undefined,
    fetchedAt: Date.now()
  }
}

function isYouTubeHost(host: string): boolean {
  return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
}

export function validateGameMetadataUpdate(value: unknown): GameMetadataUpdateInput {
  const input = record(value, 'game metadata payload')
  const gameId = cleanText(input.gameId, 'game ID', 512)
  if (!gameId) throw new Error('Invalid game ID')
  if (input.resetAll !== undefined && typeof input.resetAll !== 'boolean') {
    throw new Error('Invalid metadata reset state')
  }

  let name: string | null | undefined
  if (Object.hasOwn(input, 'name') && input.name !== undefined) {
    name = input.name === null ? null : cleanText(input.name, 'game name', 160)
    if (name === null && input.name !== null) throw new Error('Game name cannot be empty')
  }

  let metadata: GameMetadataOverrides | undefined
  if (input.metadata !== undefined) {
    const source = record(input.metadata, 'game metadata overrides')
    if (Object.keys(source).some((key) => !EDITABLE_KEYS.has(key))) {
      throw new Error('Unsupported game metadata field')
    }
    metadata = {}
    for (const [key, raw] of Object.entries(source)) {
      switch (key) {
        case 'summary': metadata.summary = cleanText(raw, 'summary', 2_000); break
        case 'description': metadata.description = cleanText(raw, 'description', 24_000); break
        case 'releaseDateText': metadata.releaseDateText = cleanText(raw, 'release date', 160); break
        case 'controllerSupport': metadata.controllerSupport = cleanText(raw, 'controller support', 240); break
        case 'contentDescriptorNotes': metadata.contentDescriptorNotes = cleanText(raw, 'content descriptor', 8_000); break
        case 'genres': metadata.genres = cleanList(raw, 'genres'); break
        case 'features': metadata.features = cleanList(raw, 'features'); break
        case 'developers': metadata.developers = cleanList(raw, 'developers'); break
        case 'publishers': metadata.publishers = cleanList(raw, 'publishers'); break
        case 'languages': metadata.languages = cleanList(raw, 'languages'); break
        case 'platforms': {
          const platforms = cleanList(raw, 'platforms')
          if (platforms?.some((platform) => !PLATFORMS.has(platform as GamePlatform))) {
            throw new Error('Invalid platforms')
          }
          metadata.platforms = platforms as GamePlatform[] | null
          break
        }
        case 'comingSoon':
          if (raw !== null && typeof raw !== 'boolean') throw new Error('Invalid coming-soon state')
          metadata.comingSoon = raw as boolean | null
          break
        case 'criticScore': metadata.criticScore = cleanInteger(raw, 'critic score', 0, 100); break
        case 'recommendationCount': metadata.recommendationCount = cleanInteger(raw, 'recommendation count', 0, 1_000_000_000); break
        case 'requiredAge': metadata.requiredAge = cleanInteger(raw, 'required age', 0, 99); break
        case 'achievementCount': metadata.achievementCount = cleanInteger(raw, 'achievement count', 0, 1_000_000); break
        case 'website': metadata.website = cleanUrl(raw, 'website'); break
        case 'storeUrl': metadata.storeUrl = cleanUrl(raw, 'store URL'); break
        case 'trailerUrl': metadata.trailerUrl = cleanUrl(raw, 'trailer URL'); break
        case 'titleMusicUrl': {
          const url = cleanUrl(raw, 'title music URL', isYouTubeHost)
          if (url && !youtubeVideoIdFromUrl(url)) throw new Error('Invalid title music URL')
          metadata.titleMusicUrl = url
          break
        }
        case 'achievementsUrl': metadata.achievementsUrl = cleanUrl(raw, 'achievements URL'); break
        case 'systemRequirements': metadata.systemRequirements = cleanRequirements(raw); break
        case 'completionTimes': metadata.completionTimes = cleanCompletionTimes(raw); break
      }
    }
  }

  const output: GameMetadataUpdateInput = { gameId }
  if (name !== undefined) output.name = name
  if (metadata !== undefined) output.metadata = metadata
  if (input.resetAll === true) output.resetAll = true
  return output
}

export function sanitizeStoredMetadataOverrides(value: unknown): GameMetadataOverrides | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const metadata: GameMetadataOverrides = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!EDITABLE_KEYS.has(key)) continue
    try {
      const valid = validateGameMetadataUpdate({
        gameId: 'stored',
        metadata: { [key]: raw }
      }).metadata
      if (valid && Object.hasOwn(valid, key)) {
        const output = metadata as Record<string, unknown>
        output[key] = (valid as Record<string, unknown>)[key]
      }
    } catch {
      // Preserve other valid user edits if one legacy or damaged field is bad.
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined
}
