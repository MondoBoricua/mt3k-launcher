import type { GameProvider, GeForceNowLaunchMode, GeForceNowLibraryMatch, LibraryGame } from './ipc'

export const GEFORCE_NOW_APPLICATION_ID = 'launcher:geforce-now'
export const GEFORCE_NOW_WEB_URL = 'https://play.geforcenow.com/'
export const GEFORCE_NOW_CATALOG_URL =
  'https://api-prod.nvidia.com/services/gfngames/v1/gameList'

export function isGeForceNowLaunchMode(value: unknown): value is GeForceNowLaunchMode {
  return value === 'web' || value === 'native'
}

export function normalizeGeForceNowLaunchMode(value: unknown): GeForceNowLaunchMode {
  return value === 'native' ? 'native' : 'web'
}

/** Match NVIDIA's own Windows desktop shortcuts: cmsId identifies the store variant. */
export function createGeForceNowNativeLaunchArgument(
  match: Pick<GeForceNowLibraryMatch, 'geforceNowGameId' | 'variantId' | 'shortName'>
): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match.geforceNowGameId) ||
      !/^[1-9][0-9]{0,15}$/.test(match.variantId) || !Number.isSafeInteger(Number(match.variantId))) {
    throw new Error('Invalid GeForce NOW native game identity')
  }
  const parameters: Array<[string, string]> = [
    ['cmsId', match.variantId],
    ['launchSource', 'External'],
    ['parentGameId', match.geforceNowGameId.toLowerCase()]
  ]
  if (match.shortName !== undefined) {
    if (typeof match.shortName !== 'string' || match.shortName.length > 256 || /[\u0000-\u001f\u007f]/.test(match.shortName)) {
      throw new Error('Invalid GeForce NOW native short name')
    }
    if (match.shortName) parameters.push(['shortName', match.shortName])
  }
  return `--url-route=#?${parameters.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
}

const GEFORCE_NOW_STORES = {
  steam: 'STEAM',
  epic: 'EPIC',
  gog: 'GOG',
  xbox: 'XBOX',
  ea: 'EA_APP',
  ubisoft: 'UPLAY'
} as const satisfies Partial<Record<GameProvider, string>>

export function geForceNowStoreForProvider(provider: GameProvider): string | undefined {
  return GEFORCE_NOW_STORES[provider as keyof typeof GEFORCE_NOW_STORES]
}

export function geForceNowStoreIdForGame(game: LibraryGame): string | undefined {
  const metadataStoreId = game.metadata.providerStoreId?.trim()
  if (metadataStoreId) return metadataStoreId
  if (game.provider === 'steam' && Number.isInteger(game.appId) && (game.appId ?? 0) > 0) {
    return String(game.appId)
  }
  if (geForceNowStoreForProvider(game.provider)) return game.providerGameId.trim() || undefined
  return undefined
}

export function geForceNowStoreKey(appStore: string, storeId: string): string {
  return `${appStore.trim().toUpperCase()}:${storeId.trim().toLocaleLowerCase('en-US')}`
}

export function createGeForceNowDeepLink(gameId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gameId)) {
    throw new Error('Invalid GeForce NOW game ID')
  }
  const url = new URL('games', GEFORCE_NOW_WEB_URL)
  url.searchParams.set('game-id', gameId.toLowerCase())
  url.searchParams.set('utm_source', 'orbit')
  url.searchParams.set('utm_campaign', 'launcher')
  return url.toString()
}
