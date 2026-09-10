import type { GameProvider } from './ipc'

export const GAME_TRACKING_METHODS = [
  'provider-process',
  'process-tree',
  'install-directory',
  'package-identity',
  'executable',
  'provider-handoff',
  'geforce-now-window'
] as const

export type GameTrackingMethod = (typeof GAME_TRACKING_METHODS)[number]

/**
 * Provider-specific tracking order. Every entry after the first method is an
 * always-on fallback, not a user-disabled alternative. The order mirrors the
 * strongest stable identity each launcher exposes during its hand-off.
 */
export const GAME_TRACKING_METHODS_BY_PROVIDER = {
  local: ['process-tree', 'executable', 'install-directory'],
  steam: ['provider-process', 'install-directory', 'executable', 'provider-handoff'],
  epic: ['install-directory', 'executable', 'provider-handoff'],
  gog: ['process-tree', 'install-directory', 'executable', 'provider-handoff'],
  xbox: ['package-identity', 'install-directory', 'executable', 'provider-handoff'],
  playstation: ['process-tree', 'executable'],
  retro: ['process-tree', 'executable', 'install-directory'],
  ea: ['install-directory', 'executable', 'provider-handoff'],
  ubisoft: ['install-directory', 'executable', 'provider-handoff']
} as const satisfies Record<GameProvider, readonly GameTrackingMethod[]>

export function gameTrackingMethodsForProvider(
  provider: GameProvider
): readonly GameTrackingMethod[] {
  return GAME_TRACKING_METHODS_BY_PROVIDER[provider]
}
