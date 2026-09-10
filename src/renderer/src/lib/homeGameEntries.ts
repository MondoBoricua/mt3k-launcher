import type { LibraryGame } from '@shared/ipc'
import { latestLibraryActivity, normalizeLibraryTimestamp } from '@shared/libraryTime'

/** Renderer-only continuation entries, never duplicate persistent library records. */
export interface HomeGameEntry extends LibraryGame {
  homeLaunchSource?: 'geforce-now'
}

export function isCloudHomeGame(game: LibraryGame): boolean {
  return (game as HomeGameEntry).homeLaunchSource === 'geforce-now'
}

export function homeGameKey(game: LibraryGame | null | undefined): string {
  return game ? `${isCloudHomeGame(game) ? 'geforce-now' : 'local'}:${game.id}` : ''
}

export function homeGameActivationTarget(game: LibraryGame): 'default' | 'geforce-now' {
  return isCloudHomeGame(game) ? 'geforce-now' : 'default'
}

export function homeGameLabel(game: LibraryGame): string {
  return isCloudHomeGame(game) ? `${game.name}. GeForce NOW` : game.name
}

export function isHomeGameRunning(
  game: LibraryGame, runningId: string | undefined, source: 'local' | 'geforce-now'
): boolean {
  return game.id === runningId && isCloudHomeGame(game) === (source === 'geforce-now')
}

export function buildHomeGameEntries(games: readonly LibraryGame[]): HomeGameEntry[] {
  return games.flatMap((game): HomeGameEntry[] => {
    const cloudAt = normalizeLibraryTimestamp(game.lastGeForceNowStartedAt)
    const entries: HomeGameEntry[] = []
    if (game.installed) {
      entries.push(cloudAt ? {
        ...game,
        lastStartedAt: game.lastLocalStartedAt ?? 0,
        lastPlayedTimestamp: game.lastLocalStartedAt ?? 0
      } : game)
    }
    if (cloudAt) entries.push({
      ...game,
      homeLaunchSource: 'geforce-now',
      lastStartedAt: cloudAt,
      lastPlayedTimestamp: cloudAt
    })
    return entries
  }).sort((a, b) => latestLibraryActivity(b) - latestLibraryActivity(a) ||
    normalizeLibraryTimestamp(b.addedAt) - normalizeLibraryTimestamp(a.addedAt) ||
    a.name.localeCompare(b.name) || homeGameKey(a).localeCompare(homeGameKey(b)))
}
