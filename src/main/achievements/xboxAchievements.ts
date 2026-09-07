import { acceptLanguages } from '@shared/language'
import type { GameAchievementsSnapshot, LibraryGame } from '@shared/ipc'
import { settingsStore } from '../settingsStore'
import { xboxAuthManager } from '../xbox/xboxAuth'
import {
  parseXboxAchievements,
  parseXboxTitleHistoryPage,
  selectXboxTitleId,
  type XboxTitleIdentity
} from './xboxAchievementParsers'

const TITLE_HISTORY_TTL_MS = 15 * 60 * 1000
const MAX_TITLE_HISTORY_PAGES = 20

interface TitleHistoryCache {
  xuid: string
  fetchedAt: number
  titles: XboxTitleIdentity[]
}

let titleHistoryCache: TitleHistoryCache | null = null

function unavailable(
  game: LibraryGame,
  reason: GameAchievementsSnapshot['reason']
): GameAchievementsSnapshot {
  return {
    gameId: game.id,
    provider: game.provider,
    state: 'unavailable',
    achievements: [],
    unlocked: 0,
    total: 0,
    fetchedAt: Date.now(),
    reason
  }
}

async function fetchTitleHistory(xuid: string): Promise<XboxTitleIdentity[]> {
  if (
    titleHistoryCache?.xuid === xuid &&
    Date.now() - titleHistoryCache.fetchedAt < TITLE_HISTORY_TTL_MS
  ) {
    return titleHistoryCache.titles
  }
  const titles: XboxTitleIdentity[] = []
  let continuationToken: string | undefined
  for (let pageIndex = 0; pageIndex < MAX_TITLE_HISTORY_PAGES; pageIndex++) {
    const url = new URL(
      `https://titlehub.xboxlive.com/users/xuid(${encodeURIComponent(xuid)})/titles/titlehistory/decoration/detail`
    )
    url.searchParams.set('maxItems', '1000')
    if (continuationToken) url.searchParams.set('continuationToken', continuationToken)
    const response = await xboxAuthManager.fetchXboxService(
      url,
      {
        headers: {
          'Accept-Language': acceptLanguages(settingsStore.store.language)
        },
        signal: AbortSignal.timeout(20_000)
      },
      '2'
    )
    if (!response.ok) throw new Error(`Xbox title history is unavailable (${response.status})`)
    const page = parseXboxTitleHistoryPage(await response.json())
    titles.push(...page.titles)
    continuationToken = page.continuationToken
    if (!continuationToken) break
  }
  titleHistoryCache = { xuid, fetchedAt: Date.now(), titles }
  return titles
}

export function clearXboxAchievementCaches(): void {
  titleHistoryCache = null
}

export async function fetchXboxAchievements(
  game: LibraryGame
): Promise<GameAchievementsSnapshot> {
  const connection = xboxAuthManager.getConnectionSnapshot()
  if (!connection.available || !connection.account) return unavailable(game, 'not-connected')
  try {
    const titles = game.metadata.providerTitleId
      ? []
      : await fetchTitleHistory(connection.account.xuid)
    const titleId = selectXboxTitleId(game, titles)
    if (!titleId) return unavailable(game, 'unsupported')

    const url = new URL(
      `https://achievements.xboxlive.com/users/xuid(${encodeURIComponent(connection.account.xuid)})/achievements`
    )
    url.searchParams.set('titleId', titleId)
    url.searchParams.set('maxItems', '1000')
    const response = await xboxAuthManager.fetchXboxService(
      url,
      {
        headers: {
          'Accept-Language': acceptLanguages(settingsStore.store.language)
        },
        signal: AbortSignal.timeout(20_000)
      },
      '2'
    )
    if (response.status === 404) return unavailable(game, 'unsupported')
    if (response.status === 403) return unavailable(game, 'private')
    if (!response.ok) return unavailable(game, 'unavailable')
    return parseXboxAchievements(game, await response.json())
  } catch {
    return unavailable(game, 'unavailable')
  }
}
