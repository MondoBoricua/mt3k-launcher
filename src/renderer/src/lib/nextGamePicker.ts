import type { GameCompletionTimes, LibraryGame } from '@shared/ipc'

export type NextGameReason =
  | { kind: 'fresh'; genre?: string }
  | { kind: 'comeback'; genre?: string }
  | { kind: 'familiar'; genre?: string }
  | { kind: 'ready'; genre?: string }
  | { kind: 'discovery'; genre?: string }

export type GameCommitment = 'compact' | 'balanced' | 'long'

export interface NextGameSpinEntry {
  key: string
  game: LibraryGame
}

const COMEBACK_AFTER_MS = 45 * 24 * 60 * 60 * 1000
const FAMILIAR_PLAYTIME_MINUTES = 5 * 60

function normalizedRandom(random: () => number): number {
  const value = random()
  if (!Number.isFinite(value)) return 0
  return Math.min(0.999999999, Math.max(0, value))
}

function randomItem<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(normalizedRandom(random) * items.length)] as T
}

function normalizedTitleKey(value: string): string {
  return value
    .replace(/[™®©]/g, '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

function gameActivity(game: LibraryGame): number {
  return Math.max(game.lastPlayedTimestamp ?? 0, game.lastStartedAt ?? 0)
}

function gamePlaytimeSeconds(game: LibraryGame): number {
  return game.playtimeSeconds ?? (game.playtimeMinutes ?? 0) * 60
}

function preferredDuplicate(candidate: LibraryGame, current: LibraryGame): boolean {
  if (candidate.installed !== current.installed) return candidate.installed
  const activityDifference = gameActivity(candidate) - gameActivity(current)
  if (activityDifference !== 0) return activityDifference > 0
  return gamePlaytimeSeconds(candidate) > gamePlaytimeSeconds(current)
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(normalizedRandom(random) * (index + 1))
    const current = result[index] as T
    result[index] = result[target] as T
    result[target] = current
  }
  return result
}

/**
 * Keep unreleased titles out, make backlog inclusion explicit, and avoid
 * weighting one title more heavily just because it exists in several stores.
 */
export function nextGameCandidates(
  games: readonly LibraryGame[],
  includeUninstalled = true
): LibraryGame[] {
  const uniqueTitles = new Map<string, LibraryGame>()
  for (const game of games) {
    if (game.metadata.comingSoon || (!includeUninstalled && !game.installed)) continue
    const key = normalizedTitleKey(game.name) || game.id
    const current = uniqueTitles.get(key)
    if (!current || preferredDuplicate(game, current)) uniqueTitles.set(key, game)
  }

  return [...uniqueTitles.values()]
}

export function chooseNextGame(
  games: readonly LibraryGame[],
  previousGameId?: string,
  random: () => number = Math.random,
  includeUninstalled = true
): LibraryGame | null {
  const candidates = nextGameCandidates(games, includeUninstalled)
  if (candidates.length === 0) return null
  const withoutPrevious =
    candidates.length > 1
      ? candidates.filter((game) => game.id !== previousGameId)
      : candidates
  return randomItem(withoutPrevious, random)
}

export function nextGameReason(game: LibraryGame, now = Date.now()): NextGameReason {
  const genre = game.metadata.genres?.find((value) => value.trim().length > 0)?.trim()
  const playtimeMinutes =
    game.playtimeSeconds !== undefined
      ? Math.round(game.playtimeSeconds / 60)
      : (game.playtimeMinutes ?? 0)
  const lastPlayedAt = Math.max(game.lastPlayedTimestamp ?? 0, game.lastStartedAt ?? 0)

  if (playtimeMinutes <= 0) return { kind: 'fresh', genre }
  if (lastPlayedAt > 0 && now - lastPlayedAt >= COMEBACK_AFTER_MS) {
    return { kind: 'comeback', genre }
  }
  if (playtimeMinutes >= FAMILIAR_PLAYTIME_MINUTES) return { kind: 'familiar', genre }
  if (game.installed) return { kind: 'ready', genre }
  return { kind: 'discovery', genre }
}

export function gameCommitment(
  completionTimes: GameCompletionTimes | null | undefined
): GameCommitment | null {
  if (completionTimes?.state !== 'available') return null
  const minutes =
    completionTimes.mainStoryMinutes ??
    completionTimes.allStylesMinutes ??
    completionTimes.mainExtraMinutes
  if (!minutes) return null
  if (minutes <= 12 * 60) return 'compact'
  if (minutes <= 30 * 60) return 'balanced'
  return 'long'
}

/** Builds a finite reel with two cards on either side of the final winner. */
export function buildNextGameSpinSequence(
  games: readonly LibraryGame[],
  winner: LibraryGame,
  random: () => number = Math.random,
  spinSteps = 14,
  includeUninstalled = true
): { entries: NextGameSpinEntry[]; winnerIndex: number } {
  const candidates = nextGameCandidates(games, includeUninstalled)
  const source = candidates.length > 0 ? candidates : [winner]
  const winnerIndex = Math.max(4, spinSteps)
  const entries: NextGameSpinEntry[] = []
  let bag: LibraryGame[] = []

  for (let index = 0; index < winnerIndex + 3; index += 1) {
    if (index === winnerIndex) {
      entries.push({ key: `spin-${index}`, game: winner })
      bag = bag.filter((game) => game.id !== winner.id)
      continue
    }
    if (bag.length === 0) bag = shuffled(source, random)
    const recentKeys = new Set(
      entries
        .slice(-Math.min(4, Math.max(0, source.length - 1)))
        .map((entry) => normalizedTitleKey(entry.game.name) || entry.game.id)
    )
    let bagIndex = bag.findIndex(
      (game) => !recentKeys.has(normalizedTitleKey(game.name) || game.id)
    )
    if (bagIndex < 0) bagIndex = 0
    const [game] = bag.splice(bagIndex, 1)
    entries.push({ key: `spin-${index}`, game: game as LibraryGame })
  }

  // The settled carousel exposes five cards. Make that final composition fully
  // distinct whenever the library has enough unique titles, regardless of the
  // forced winner's earlier position in the shuffle bag.
  const surrounding = shuffled(
    source.filter((game) => game.id !== winner.id),
    random
  )
  if (surrounding.length >= 4) {
    entries[winnerIndex - 2] = {
      key: `spin-${winnerIndex - 2}`,
      game: surrounding[0] as LibraryGame
    }
    entries[winnerIndex - 1] = {
      key: `spin-${winnerIndex - 1}`,
      game: surrounding[1] as LibraryGame
    }
    entries[winnerIndex] = { key: `spin-${winnerIndex}`, game: winner }
    entries[winnerIndex + 1] = {
      key: `spin-${winnerIndex + 1}`,
      game: surrounding[2] as LibraryGame
    }
    entries[winnerIndex + 2] = {
      key: `spin-${winnerIndex + 2}`,
      game: surrounding[3] as LibraryGame
    }
  }
  return { entries, winnerIndex }
}
