import type { GameProvider } from '../../shared/ipc'

const DEFAULT_LIBRARY_REFRESH_SETTLE_MS = 1_500
const EXTERNAL_ACTIVITY_REFRESH_THRESHOLD_MS = 15_000

export type InstalledLibraryProvider = Extract<
  GameProvider,
  'steam' | 'epic' | 'gog' | 'xbox' | 'ea' | 'ubisoft'
>

export interface InstalledLibraryRefreshTarget {
  provider: InstalledLibraryProvider
  providerGameId?: string
}

const LAUNCHER_PROVIDERS = new Map<string, InstalledLibraryProvider>([
  ['launcher:steam', 'steam'],
  ['launcher:epic', 'epic'],
  ['launcher:gog', 'gog'],
  ['launcher:xbox', 'xbox'],
  ['launcher:ea', 'ea'],
  ['launcher:ubisoft', 'ubisoft']
])

const PASSIVE_LOCAL_REFRESH_TARGETS: readonly InstalledLibraryRefreshTarget[] = [
  { provider: 'gog' },
  { provider: 'ea' },
  { provider: 'ubisoft' }
]

export function launcherProviderForApplicationId(
  applicationId: string
): InstalledLibraryProvider | undefined {
  return LAUNCHER_PROVIDERS.get(applicationId)
}

export function isLauncherApplicationId(applicationId: string): boolean {
  return launcherProviderForApplicationId(applicationId) !== undefined
}

/** Coalesces installed-game reconciliation by provider. A provider-wide
 * request subsumes game-specific requests, while unrelated providers remain
 * independent members of the same small batch. */
export class LibraryRefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined
  private inactiveSince: number | undefined
  private awaitingLauncherProviders = new Set<InstalledLibraryProvider>()
  private pendingTargets = new Map<InstalledLibraryProvider, Set<string> | null>()
  private disposed = false
  private readonly refreshInstalledProviders: (
    targets: readonly InstalledLibraryRefreshTarget[]
  ) => Promise<unknown>
  private readonly settleMs: number

  constructor(
    refreshInstalledProviders: (
      targets: readonly InstalledLibraryRefreshTarget[]
    ) => Promise<unknown>,
    settleMs = DEFAULT_LIBRARY_REFRESH_SETTLE_MS
  ) {
    this.refreshInstalledProviders = refreshInstalledProviders
    this.settleMs = settleMs
  }

  request(
    target: InstalledLibraryRefreshTarget | readonly InstalledLibraryRefreshTarget[],
    delayMs = this.settleMs
  ): void {
    if (this.disposed) return
    const targets = Array.isArray(target) ? target : [target]
    for (const candidate of targets) this.mergeTarget(candidate)
    if (this.pendingTargets.size === 0) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      const pending = this.consumePendingTargets()
      void this.refreshInstalledProviders(pending).catch(() => undefined)
    }, Math.max(0, delayMs))
    this.timer.unref()
  }

  expectLauncherReturn(applicationId: string): void {
    const provider = launcherProviderForApplicationId(applicationId)
    if (provider) this.awaitingLauncherProviders.add(provider)
  }

  handleWindowBlurred(now = Date.now()): void {
    if (this.inactiveSince === undefined) this.inactiveSince = now
  }

  handleWindowFocused(now = Date.now(), allowPassiveRefresh = true): boolean {
    const inactiveFor = this.inactiveSince === undefined ? 0 : now - this.inactiveSince
    this.inactiveSince = undefined
    const launcherTargets = [...this.awaitingLauncherProviders].map((provider) => ({ provider }))
    this.awaitingLauncherProviders.clear()
    if (launcherTargets.length > 0) {
      this.request(launcherTargets)
      return true
    }
    if (allowPassiveRefresh && inactiveFor >= EXTERNAL_ACTIVITY_REFRESH_THRESHOLD_MS) {
      this.request(PASSIVE_LOCAL_REFRESH_TARGETS)
      return true
    }
    return false
  }

  dispose(): void {
    this.disposed = true
    this.awaitingLauncherProviders.clear()
    this.pendingTargets.clear()
    this.inactiveSince = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private mergeTarget(target: InstalledLibraryRefreshTarget): void {
    const providerGameId = target.providerGameId?.trim()
    const current = this.pendingTargets.get(target.provider)
    if (!providerGameId) {
      this.pendingTargets.set(target.provider, null)
      return
    }
    if (current === null) return
    const ids = current ?? new Set<string>()
    ids.add(providerGameId)
    this.pendingTargets.set(target.provider, ids)
  }

  private consumePendingTargets(): InstalledLibraryRefreshTarget[] {
    const targets: InstalledLibraryRefreshTarget[] = []
    for (const [provider, providerGameIds] of this.pendingTargets) {
      if (providerGameIds === null) targets.push({ provider })
      else {
        for (const providerGameId of providerGameIds) {
          targets.push({ provider, providerGameId })
        }
      }
    }
    this.pendingTargets.clear()
    return targets
  }
}
