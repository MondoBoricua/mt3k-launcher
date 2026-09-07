import type { LibraryAccessKind, LibraryGame } from './ipc'

/**
 * Steam does not expose the lending family member through GetOwnedGames. A
 * title is therefore considered shared only when the authenticated ownership
 * list is available and the active Steam client/session exposes an additional
 * app. Without that comparison we keep the access kind unknown.
 */
export function classifySteamSessionAccess(
  appId: number,
  authoritativeOwnedAppIds?: ReadonlySet<number>
): LibraryAccessKind | undefined {
  if (!authoritativeOwnedAppIds) return undefined
  return authoritativeOwnedAppIds.has(appId) ? 'owned' : 'shared'
}

export function isSteamSharedLibraryGame(
  game: Pick<LibraryGame, 'provider' | 'libraryAccess'>
): boolean {
  return game.provider === 'steam' && game.libraryAccess === 'shared'
}

export function projectSteamSharedVisibility<
  T extends Pick<LibraryGame, 'provider' | 'libraryAccess'>
>(games: T[], includeShared: boolean): T[] {
  return includeShared ? games : games.filter((game) => !isSteamSharedLibraryGame(game))
}
