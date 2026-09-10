import { create } from 'zustand'
import {
  ORBIT_PLUS_FEATURES,
  ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS,
  orbitPlusBackgroundRefreshIsDue,
  orbitPlusHasFeature,
  orbitPlusMembershipDecisionAccess,
  type OrbitPlusCommercePlan,
  type OrbitPlusConnectionStatus,
  type OrbitPlusFeature,
  type OrbitPlusIssue,
  type OrbitPlusSnapshot
} from '@shared/ipc'
import { setUiAudioManualAccess } from '@renderer/lib/uiAudio'
import { useSettingsNavigationStore } from './settingsNavigationStore'
import { useNavigationStore } from './navigationStore'

export function openOrbitPlusSettings(): void {
  useSettingsNavigationStore.getState().setPage('plus')
  useNavigationStore.getState().setMainView('settings')
}

const DEFAULT_PATREON_MEMBERSHIP_URL =
  'https://www.patreon.com/cw/GAMINGCONSOLEMODE/membership'
const REFRESH_INTERVAL_MS = ORBIT_PLUS_PATREON_REFRESH_INTERVAL_MS
const ACCESS_RECHECK_LEAD_MS = 30_000

const EMPTY_SNAPSHOT: OrbitPlusSnapshot = {
  access: 'locked',
  connected: false,
  serviceAvailable: false,
  secureStorageAvailable: true,
  purchaseUrl: DEFAULT_PATREON_MEMBERSHIP_URL
}

interface OrbitPlusState {
  snapshot: OrbitPlusSnapshot
  activity: OrbitPlusConnectionStatus['state']
  issue?: OrbitPlusIssue
  initialized: boolean
  init: () => Promise<OrbitPlusSnapshot>
  refresh: (force?: boolean) => Promise<OrbitPlusSnapshot>
  connectPatreon: () => Promise<OrbitPlusSnapshot>
  cancelPatreon: () => Promise<OrbitPlusSnapshot>
  openCheckout: (plan: OrbitPlusCommercePlan) => Promise<void>
  activateLicense: (key: string) => Promise<OrbitPlusSnapshot>
  deactivateLicense: () => Promise<OrbitPlusSnapshot>
  setOwnerTestAccess: (enabled: boolean) => Promise<OrbitPlusSnapshot>
  disconnect: () => Promise<OrbitPlusSnapshot>
  openMembership: () => Promise<void>
  hasFeature: (feature: OrbitPlusFeature) => boolean
  dispose: () => void
}

let removeStatusListener: (() => void) | undefined
let refreshTimer: number | undefined
let expiryTimer: number | undefined
let removeWakeListeners: (() => void) | undefined
let requestGeneration = 0
let acceptingConnectionStatus = false
let recheckedAccessUntil: number | undefined

function applyAudioAccess(snapshot: OrbitPlusSnapshot): void {
  setUiAudioManualAccess(orbitPlusHasFeature(snapshot, 'manual-audio'))
}

function snapshotWithoutPatreon(
  snapshot: OrbitPlusSnapshot,
  now = Date.now()
): OrbitPlusSnapshot {
  const activeSources = snapshot.activeSources?.filter((source) => source !== 'patreon')
  const licenseSource = activeSources?.[0]
  const license = snapshot.license
  const licenseState = license?.state
  const retainsIndependentAccess =
    Boolean(licenseSource) &&
    Boolean(license?.configured) &&
    (licenseState === 'active' || licenseState === 'grace')
  const licenseDeadlines = [license?.expiresAt, license?.offlineAccessUntil].filter(
    (deadline): deadline is number => deadline !== undefined
  )
  const licenseAccessUntil = retainsIndependentAccess
    ? licenseDeadlines.length > 0
      ? Math.min(...licenseDeadlines)
      : snapshot.entitlement?.source === licenseSource
        ? snapshot.accessUntil
        : now + ACCESS_RECHECK_LEAD_MS
    : undefined
  const licenseAccessIsCurrent =
    retainsIndependentAccess &&
    (licenseAccessUntil === undefined || licenseAccessUntil >= now)

  return {
    ...snapshot,
    connected: false,
    accountName: undefined,
    membership: undefined,
    ownerTestAccess: undefined,
    activeSources: licenseAccessIsCurrent ? activeSources : [],
    checkedAt: licenseAccessIsCurrent ? license?.checkedAt : undefined,
    issue: undefined,
    ...(licenseAccessIsCurrent && licenseSource && licenseState && license
      ? {
          access: licenseState,
          accessUntil: licenseAccessUntil,
          offlineAccessUntil: license.offlineAccessUntil,
          entitlement: {
            source: licenseSource,
            plan: license.plan ?? (licenseSource === 'lifetime-key' ? 'lifetime' : 'annual'),
            features: [...ORBIT_PLUS_FEATURES],
            verifiedAt: license.checkedAt ?? now,
            expiresAt: license.expiresAt,
            offlineUntil: license.offlineAccessUntil
          }
        }
      : {
          access: 'locked' as const,
          accessUntil: undefined,
          offlineAccessUntil: undefined,
          entitlement: undefined
        })
  }
}

export const useOrbitPlusStore = create<OrbitPlusState>((set, get) => {
  const applySnapshot = (
    snapshot: OrbitPlusSnapshot,
    activity: OrbitPlusConnectionStatus['state'] = 'idle',
    issue = snapshot.issue
  ): OrbitPlusSnapshot => {
    if (snapshot.membership) {
      const decisionAccess = orbitPlusMembershipDecisionAccess(
        snapshot.membership,
        snapshot.entitlement,
        Date.now(),
        snapshot.offlineAccessUntil
      )
      snapshot = {
        ...snapshot,
        ...decisionAccess,
        entitlement: decisionAccess.access === 'locked' ? undefined : snapshot.entitlement
      }
    } else if (snapshot.accessUntil !== undefined && snapshot.accessUntil <= Date.now()) {
      snapshot = { ...snapshot, access: 'locked', accessUntil: undefined, entitlement: undefined }
    }
    applyAudioAccess(snapshot)
    set({ snapshot, activity, issue, initialized: true })
    scheduleExpiry(snapshot)
    return snapshot
  }

  const expireAccess = (): void => {
    const snapshot = get().snapshot
    if (snapshot.accessUntil === undefined || snapshot.access === 'locked') return
    const now = Date.now()
    if (snapshot.accessUntil <= now) {
      applySnapshot(snapshot, get().activity)
      return
    }
    if (['idle', 'error'].includes(get().activity)) {
      recheckedAccessUntil = snapshot.accessUntil
      expiryTimer = window.setTimeout(expireAccess, snapshot.accessUntil - now + 1)
      void get().refresh()
      return
    }
    expiryTimer = window.setTimeout(
      expireAccess,
      Math.min(5_000, snapshot.accessUntil - now + 1)
    )
  }

  const scheduleExpiry = (snapshot: OrbitPlusSnapshot): void => {
    if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
    expiryTimer = undefined
    if (snapshot.accessUntil === undefined || snapshot.access === 'locked') {
      recheckedAccessUntil = undefined
      return
    }
    const alreadyRechecked = recheckedAccessUntil === snapshot.accessUntil
    expiryTimer = window.setTimeout(
      expireAccess,
      Math.min(
        2_147_483_647,
        Math.max(
          1,
          snapshot.accessUntil - Date.now() - (alreadyRechecked ? 0 : ACCESS_RECHECK_LEAD_MS)
        )
      )
    )
  }

  const request = async (
    action: () => Promise<OrbitPlusSnapshot>,
    activity: OrbitPlusConnectionStatus['state'],
    failure: OrbitPlusIssue = 'network-unavailable'
  ): Promise<OrbitPlusSnapshot> => {
    const generation = ++requestGeneration
    acceptingConnectionStatus = activity === 'opening-browser'
    set({ activity, issue: undefined })
    try {
      const snapshot = await action()
      return generation === requestGeneration ? applySnapshot(snapshot) : get().snapshot
    } catch {
      if (generation !== requestGeneration) return get().snapshot
      return applySnapshot({ ...get().snapshot, issue: failure }, 'error', failure)
    } finally {
      if (generation === requestGeneration) acceptingConnectionStatus = false
    }
  }

  const refreshWhenIdle = (): void => {
    const snapshot = get().snapshot
    if (
      snapshot.accessUntil !== undefined &&
      snapshot.accessUntil <= Date.now() &&
      snapshot.access !== 'locked'
    ) {
      applySnapshot(snapshot, get().activity)
    }
    if (
      orbitPlusBackgroundRefreshIsDue(get().snapshot) &&
      ['idle', 'error'].includes(get().activity)
    ) {
      void get().refresh()
    }
  }

  const installRuntime = (): void => {
    removeStatusListener ??= window.api.orbitPlus.onStatus((status) => {
      if (!acceptingConnectionStatus) return
      applySnapshot(status.snapshot, status.state, status.state === 'error' ? status.issue : status.snapshot.issue)
    })
    refreshTimer ??= window.setInterval(refreshWhenIdle, REFRESH_INTERVAL_MS)
    if (!removeWakeListeners) {
      const onVisible = (): void => { if (!document.hidden) refreshWhenIdle() }
      window.addEventListener('focus', refreshWhenIdle)
      document.addEventListener('visibilitychange', onVisible)
      removeWakeListeners = () => {
        window.removeEventListener('focus', refreshWhenIdle)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }
  }

  return {
    snapshot: EMPTY_SNAPSHOT,
    activity: 'idle',
    initialized: false,

    init: async () => {
      installRuntime()
      return request(() => window.api.orbitPlus.get(), 'verifying', 'verification-failed')
    },

    refresh: async (force = false) => {
      if (!['idle', 'error'].includes(get().activity)) return get().snapshot
      return request(() => window.api.orbitPlus.refresh(force), 'verifying')
    },

    connectPatreon: async () => {
      installRuntime()
      return request(() => window.api.orbitPlus.connectPatreon(), 'opening-browser')
    },

    cancelPatreon: async () => {
      return request(() => window.api.orbitPlus.cancelPatreon(), 'verifying')
    },

    openCheckout: (plan) => window.api.orbitPlus.openCheckout(plan),

    activateLicense: async (key) => {
      return request(
        () => window.api.orbitPlus.activateLicense(key),
        'verifying',
        'license-invalid'
      )
    },

    deactivateLicense: async () => {
      return request(() => window.api.orbitPlus.deactivateLicense(), 'verifying')
    },

    setOwnerTestAccess: async (enabled) => {
      return request(() => window.api.orbitPlus.setOwnerTestAccess(enabled), 'verifying')
    },

    disconnect: async () => {
      // Revocation is reflected synchronously so feature consumers cannot use
      // stale Patreon access while the main process closes the remote session.
      applySnapshot(snapshotWithoutPatreon(get().snapshot), 'verifying')
      return request(() => window.api.orbitPlus.disconnect(), 'verifying')
    },

    openMembership: () => window.api.app.openExternal(get().snapshot.purchaseUrl),

    hasFeature: (feature) => orbitPlusHasFeature(get().snapshot, feature),

    dispose: () => {
      requestGeneration++
      acceptingConnectionStatus = false
      removeStatusListener?.()
      removeStatusListener = undefined
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
      refreshTimer = undefined
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
      expiryTimer = undefined
      recheckedAccessUntil = undefined
      removeWakeListeners?.()
      removeWakeListeners = undefined
    }
  }
})
