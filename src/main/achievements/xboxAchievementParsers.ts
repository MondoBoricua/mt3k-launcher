import type { GameAchievement, GameAchievementsSnapshot, LibraryGame } from '@shared/ipc'
import { normalizeXboxTitleId } from '../xbox/xboxTitleIdentity'

export { normalizeXboxTitleId } from '../xbox/xboxTitleIdentity'

const MAX_TITLES_PER_PAGE = 2_000
const MAX_ACHIEVEMENTS = 2_000

export interface XboxTitleIdentity {
  titleId: string
  name: string
  devices: string[]
  storeIds: string[]
  packageFamilyNames: string[]
}

export interface XboxTitleHistoryPage {
  titles: XboxTitleIdentity[]
  continuationToken?: string
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown, maximum = 500): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= maximum ? normalized : undefined
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item, 160)).filter((item): item is string => Boolean(item))
    : []
}

function candidateText(target: string[], value: unknown, pattern: RegExp): void {
  const candidate = text(value, 200)
  if (candidate && pattern.test(candidate) && !target.includes(candidate)) target.push(candidate)
}

export function parseXboxTitleHistoryPage(payload: unknown): XboxTitleHistoryPage {
  const root = object(payload)
  const source = Array.isArray(root?.titles) ? root.titles.slice(0, MAX_TITLES_PER_PAGE) : []
  const titles: XboxTitleIdentity[] = []
  for (const candidate of source) {
    const record = object(candidate)
    if (!record) continue
    const titleId = normalizeXboxTitleId(record.titleId)
    const name = text(record.name, 200)
    if (!titleId || !name) continue
    const detail = object(record.detail)
    const storeIds: string[] = []
    const packageFamilyNames: string[] = []
    candidateText(storeIds, record.productId, /^[A-Z0-9]{12}$/i)
    candidateText(storeIds, detail?.productId, /^[A-Z0-9]{12}$/i)
    candidateText(packageFamilyNames, record.packageFamilyName, /^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/)
    candidateText(packageFamilyNames, detail?.packageFamilyName, /^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/)
    const alternates = Array.isArray(record.alternateTitleIds) ? record.alternateTitleIds : []
    for (const alternate of alternates.slice(0, 30)) {
      const entry = object(alternate)
      const kind = text(entry?.titleIdType, 80)?.toLowerCase() ?? ''
      if (kind.includes('product') || kind.includes('store')) {
        candidateText(storeIds, entry?.titleId, /^[A-Z0-9]{12}$/i)
      }
      if (kind.includes('package') || kind.includes('pfn')) {
        candidateText(packageFamilyNames, entry?.titleId, /^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/)
      }
    }
    titles.push({
      titleId,
      name,
      devices: textArray(record.devices),
      storeIds,
      packageFamilyNames
    })
  }
  const pagingInfo = object(root?.pagingInfo)
  return {
    titles,
    continuationToken: text(pagingInfo?.continuationToken, 2_048)
  }
}

function normalizedName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[™®©]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

export function selectXboxTitleId(
  game: LibraryGame,
  titles: readonly XboxTitleIdentity[]
): string | undefined {
  const direct = normalizeXboxTitleId(game.metadata.providerTitleId)
  if (direct) return direct
  const storeId = (game.metadata.providerStoreId ?? game.providerGameId).toUpperCase()
  const packageFamilyName = game.metadata.providerPackageFamilyName?.toLowerCase()
  const exactIdentity = titles.find(
    (title) =>
      title.storeIds.some((candidate) => candidate.toUpperCase() === storeId) ||
      Boolean(
        packageFamilyName &&
          title.packageFamilyNames.some(
            (candidate) => candidate.toLowerCase() === packageFamilyName
          )
      )
  )
  if (exactIdentity) return exactIdentity.titleId

  const targetName = normalizedName(game.name)
  const nameMatches = titles.filter((title) => normalizedName(title.name) === targetName)
  if (nameMatches.length === 1) return nameMatches[0]?.titleId
  const pcMatches = nameMatches.filter((title) =>
    title.devices.some((device) => /^(pc|windows|win32)$/i.test(device))
  )
  return pcMatches.length === 1 ? pcMatches[0]?.titleId : undefined
}

function httpsUrl(value: unknown): string | undefined {
  const candidate = text(value, 2_048)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function achievementIcon(record: Record<string, unknown>): string | undefined {
  const assets = Array.isArray(record.mediaAssets) ? record.mediaAssets : []
  for (const candidate of assets.slice(0, 30)) {
    const asset = object(candidate)
    const url = httpsUrl(asset?.url)
    if (url) return url
  }
  return undefined
}

function achievementProgress(record: Record<string, unknown>, unlocked: boolean): number | undefined {
  if (unlocked) return 1
  const progression = object(record.progression)
  const requirements = Array.isArray(progression?.requirements) ? progression.requirements : []
  const requirement = object(requirements[0])
  const current = Number(requirement?.current)
  const target = Number(requirement?.target)
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return undefined
  return Math.max(0, Math.min(1, current / target))
}

function achievementUnlockedAt(record: Record<string, unknown>): number | undefined {
  const progression = object(record.progression)
  const parsed = Date.parse(typeof progression?.timeUnlocked === 'string' ? progression.timeUnlocked : '')
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseXboxAchievements(
  game: LibraryGame,
  payload: unknown
): GameAchievementsSnapshot {
  const root = object(payload)
  const records = Array.isArray(root?.achievements)
    ? root.achievements.slice(0, MAX_ACHIEVEMENTS)
    : []
  const achievements: GameAchievement[] = []
  for (const candidate of records) {
    const record = object(candidate)
    if (!record) continue
    const id = text(record.id, 160)
    const name = text(record.name, 300)
    if (!id || !name) continue
    const unlocked = record.progressState === 'Achieved'
    const description = text(
      unlocked ? record.description : record.lockedDescription ?? record.description,
      1_000
    )
    achievements.push({
      id,
      name,
      description,
      iconUrl: achievementIcon(record),
      unlocked,
      unlockedAt: unlocked ? achievementUnlockedAt(record) : undefined,
      progress: achievementProgress(record, unlocked),
      hidden: record.isSecret === true
    })
  }
  if (achievements.length === 0) {
    return {
      gameId: game.id,
      provider: game.provider,
      state: 'unavailable',
      achievements: [],
      unlocked: 0,
      total: 0,
      fetchedAt: Date.now(),
      reason: 'unsupported'
    }
  }
  return {
    gameId: game.id,
    provider: game.provider,
    state: 'available',
    achievements,
    unlocked: achievements.filter((achievement) => achievement.unlocked).length,
    total: achievements.length,
    fetchedAt: Date.now(),
    source: 'xbox-network'
  }
}
