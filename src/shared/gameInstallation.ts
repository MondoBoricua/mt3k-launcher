import type { LibraryGame } from './ipc'

export type ManagedGameInstallProvider = Extract<
  LibraryGame['provider'],
  'steam' | 'epic' | 'xbox' | 'ubisoft'
>

export type ManagedGameUninstallProvider = Extract<
  ManagedGameInstallProvider,
  'steam' | 'xbox'
>

export type ProviderOperationMode = 'automatic' | 'provider' | 'unavailable'
export type ProviderAutomationLevel = 'automatic' | 'assisted' | 'manual'

export interface ProviderInstallationCapability {
  provider: ManagedGameInstallProvider
  install: ProviderOperationMode
  progress: ProviderOperationMode
  controls: ProviderOperationMode
  uninstall: ProviderOperationMode
}

export const PROVIDER_INSTALLATION_CAPABILITIES: readonly ProviderInstallationCapability[] = [
  {
    provider: 'xbox',
    install: 'automatic',
    progress: 'automatic',
    controls: 'automatic',
    uninstall: 'automatic'
  },
  {
    provider: 'steam',
    install: 'automatic',
    progress: 'automatic',
    controls: 'provider',
    uninstall: 'provider'
  },
  {
    provider: 'epic',
    install: 'provider',
    progress: 'automatic',
    controls: 'provider',
    uninstall: 'unavailable'
  },
  {
    provider: 'ubisoft',
    install: 'provider',
    progress: 'unavailable',
    controls: 'provider',
    uninstall: 'unavailable'
  }
]

export function providerAutomationLevel(
  capability: ProviderInstallationCapability
): ProviderAutomationLevel {
  const modes = [
    capability.install,
    capability.progress,
    capability.controls,
    capability.uninstall
  ]
  if (modes.every((mode) => mode === 'automatic')) return 'automatic'
  if (modes.every((mode) => mode !== 'automatic')) return 'manual'
  return 'assisted'
}

export function canRequestGameInstall(game: LibraryGame): boolean {
  if (game.installed) return false
  if (game.provider === 'steam') {
    return Number.isSafeInteger(game.appId) && (game.appId ?? 0) > 0
  }
  if (game.provider === 'xbox') {
    return /^[A-Z0-9]{12}$/iu.test(
      game.metadata.providerStoreId ?? game.providerGameId
    )
  }
  return (
    (game.provider === 'epic' || game.provider === 'ubisoft') &&
    Boolean(game.providerGameId.trim())
  )
}

export function canRequestGameUninstall(game: LibraryGame): boolean {
  if (!game.installed) return false
  if (game.provider === 'steam') {
    return Number.isSafeInteger(game.appId) && (game.appId ?? 0) > 0
  }
  return (
    game.provider === 'xbox' &&
    Boolean(game.metadata.providerPackageFamilyName?.trim())
  )
}
