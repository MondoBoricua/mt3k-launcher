import { create } from 'zustand'
import {
  orbitPlusHasFeature,
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
const REFRESH_INTERVAL_MS = 15 * 60_000

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
  refresh: () => Promise<OrbitPlusSnapshot>
  connectPatreon: () => Promise<OrbitPlusSnapshot>
  cancelPatreon: () => Promise<OrbitPlusSnapshot>
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

function applyAudioAccess(snapshot: OrbitPlusSnapshot): void {
  setUiAudioManualAccess(orbitPlusHasFeature(snapshot, 'manual-audio'))
}

export const useOrbitPlusStore = create<OrbitPlusState>((set, get) => {
  const applySnapshot = (
    snapshot: OrbitPlusSnapshot,
    activity: OrbitPlusConnectionStatus['state'] = 'idle',
    issue = snapshot.issue
  ): OrbitPlusSnapshot => {
    if (snapshot.accessUntil !== undefined && snapshot.accessUntil < Date.now()) {
      snapshot = { ...snapshot, access: 'locked', entitlement: undefined }
    }
    applyAudioAccess(snapshot)
    set({ snapshot, activity, issue, initialized: true })
    scheduleExpiry(snapshot)
    return snapshot
  }

  const expireAccess = (): void => {
    const snapshot = get().snapshot
    if (snapshot.accessUntil === undefined || snapshot.access === 'locked') return
    if (snapshot.accessUntil < Date.now()) {
      applySnapshot({ ...snapshot, access: 'locked', entitlement: undefined }, get().activity)
    } else {
      scheduleExpiry(snapshot)
    }
  }

  const scheduleExpiry = (snapshot: OrbitPlusSnapshot): void => {
    if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
    expiryTimer = undefined
    if (snapshot.accessUntil === undefined || snapshot.access === 'locked') return
    expiryTimer = window.setTimeout(expireAccess, Math.min(2_147_483_647, Math.max(1, snapshot.accessUntil - Date.now() + 1)))
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
    expireAccess()
    if (get().snapshot.connected && ['idle', 'error'].includes(get().activity)) void get().refresh()
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

    refresh: async () => {
      if (!['idle', 'error'].includes(get().activity)) return get().snapshot
      return request(() => window.api.orbitPlus.refresh(), 'verifying')
    },

    connectPatreon: async () => {
      installRuntime()
      return request(() => window.api.orbitPlus.connectPatreon(), 'opening-browser')
    },

    cancelPatreon: async () => {
      return request(() => window.api.orbitPlus.cancelPatreon(), 'verifying')
    },

    setOwnerTestAccess: async (enabled) => {
      return request(() => window.api.orbitPlus.setOwnerTestAccess(enabled), 'verifying')
    },

    disconnect: async () => {
      applySnapshot({
        ...get().snapshot,
        access: 'locked', connected: false, entitlement: undefined,
        accessUntil: undefined, ownerTestAccess: undefined, accountName: undefined
      }, 'verifying')
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
      removeWakeListeners?.()
      removeWakeListeners = undefined
    }
  }
})
