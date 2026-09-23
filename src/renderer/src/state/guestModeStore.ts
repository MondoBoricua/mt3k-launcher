import { create } from 'zustand'
import type { GuestModeStatus, GuestModeVerifyResult } from '@shared/ipc'
import type { TranslationKey } from '@renderer/i18n/translations'
import { setMainViewGuard, useNavigationStore } from './navigationStore'
import { useLibraryStore } from './libraryStore'
import { useLibraryCollectionsStore } from './libraryCollectionsStore'
import { usePreferencesStore } from './preferencesStore'

export type PinPadMode = 'enter' | 'create'

export interface PinRequest {
  id: number
  titleKey: TranslationKey
  bodyKey: TranslationKey
  mode: PinPadMode
  /** Runs the guarded action with the typed PIN; the dialog shows any failure. */
  submit: (pin: string) => Promise<GuestModeVerifyResult>
}

interface GuestModeState {
  status: GuestModeStatus
  /** True once the main process has answered `guestMode.status()` at least once. */
  hydrated: boolean
  /**
   * Persisted `guestModeEnabled` from the settings snapshot. Until the live
   * status arrives the protected surfaces fail closed on this flag.
   */
  presumedEnabled: boolean
  /** Mirror of the main-owned Settings unlock; the main process is the authority. */
  settingsUnlocked: boolean
  pinRequest: PinRequest | null
  init: () => Promise<void>
  applyStatus: (status: GuestModeStatus) => void
  requestPin: (request: Omit<PinRequest, 'id'>) => Promise<boolean>
  resolvePinRequest: (id: number, ok: boolean) => void
}

const IDLE_STATUS: GuestModeStatus = { enabled: false, hasPin: false, attemptsLeft: 5 }
const STATUS_RETRY_BASE_MS = 1_000
const STATUS_RETRY_MAX_MS = 30_000

let initialized = false
let nextRequestId = 1
let statusRetryTimer: number | undefined
let statusRetryDelay = STATUS_RETRY_BASE_MS
let unlockExpiryTimer: number | undefined
const pendingResolvers = new Map<number, (ok: boolean) => void>()

/** Fails closed: before the first live status, the persisted switch decides. */
export function isGuestModeActive(
  state: Pick<GuestModeState, 'status' | 'hydrated' | 'presumedEnabled'>
): boolean {
  return state.hydrated ? state.status.enabled : state.presumedEnabled
}

function allowedGameIds(status: GuestModeStatus): string[] | null {
  if (!status.enabled) return null
  const collection = useLibraryCollectionsStore
    .getState()
    .collections.find((candidate) => candidate.id === status.allowedCollectionId)
  // No collection or an empty one shows nothing, never the whole library.
  return collection ? [...collection.gameIds] : []
}

function syncLibraryFilter(): void {
  const state = useGuestModeStore.getState()
  // Until the main process answers, a persisted "on" hides everything.
  const next = state.hydrated
    ? allowedGameIds(state.status)
    : state.presumedEnabled
      ? []
      : null
  const current = useLibraryStore.getState().guestAllowedIds
  const unchanged =
    (next === null && current === null) ||
    (next !== null &&
      current !== null &&
      next.length === current.length &&
      next.every((id, index) => id === current[index]))
  if (!unchanged) useLibraryStore.getState().setGuestAllowedIds(next)
}

function settingsUnlockLive(status: GuestModeStatus, now = Date.now()): boolean {
  return typeof status.settingsUnlockedUntil === 'number' && status.settingsUnlockedUntil > now
}

function scheduleUnlockExpiry(status: GuestModeStatus): void {
  if (unlockExpiryTimer !== undefined) window.clearTimeout(unlockExpiryTimer)
  unlockExpiryTimer = undefined
  if (!settingsUnlockLive(status)) return
  const delay = Math.max(0, (status.settingsUnlockedUntil ?? 0) - Date.now())
  unlockExpiryTimer = window.setTimeout(() => {
    unlockExpiryTimer = undefined
    useGuestModeStore.setState({ settingsUnlocked: false })
  }, delay)
}

async function fetchStatus(): Promise<void> {
  try {
    const status = await window.api.guestMode.status()
    statusRetryDelay = STATUS_RETRY_BASE_MS
    useGuestModeStore.getState().applyStatus(status)
  } catch (error) {
    // Keep the last known (or presumed) state and try again; never fall open.
    console.warn('[guest-mode] status unavailable, keeping the last known state', error)
    if (statusRetryTimer !== undefined) window.clearTimeout(statusRetryTimer)
    statusRetryTimer = window.setTimeout(() => {
      statusRetryTimer = undefined
      void fetchStatus()
    }, statusRetryDelay)
    statusRetryDelay = Math.min(STATUS_RETRY_MAX_MS, statusRetryDelay * 2)
  }
}

function lockSettingsInMain(): void {
  void window.api.guestMode
    .lockSettings()
    .then((status) => useGuestModeStore.getState().applyStatus(status))
    .catch((error) => console.warn('[guest-mode] could not lock Settings', error))
}

export const useGuestModeStore = create<GuestModeState>((set, get) => ({
  status: IDLE_STATUS,
  hydrated: false,
  presumedEnabled: usePreferencesStore.getState().guestModeEnabled,
  settingsUnlocked: false,
  pinRequest: null,

  init: async () => {
    if (initialized) return
    initialized = true
    window.api.guestMode.onStatus((status) => get().applyStatus(status))
    usePreferencesStore.subscribe((state, previous) => {
      if (state.guestModeEnabled !== previous.guestModeEnabled) {
        set({ presumedEnabled: state.guestModeEnabled })
        syncLibraryFilter()
      }
    })
    useLibraryCollectionsStore.subscribe((state, previous) => {
      if (state.collections !== previous.collections) syncLibraryFilter()
    })
    useNavigationStore.subscribe((state, previous) => {
      if (state.mainView !== previous.mainView && state.mainView !== 'settings') {
        if (get().settingsUnlocked) {
          set({ settingsUnlocked: false })
          lockSettingsInMain()
        }
      }
    })
    setMainViewGuard((view) => {
      const state = get()
      if (!isGuestModeActive(state)) return true
      // Store, friends and applications are hidden for guests; nothing may deep-link into them.
      if (view === 'store' || view === 'friends' || view === 'applications') return false
      if (view !== 'settings' || state.settingsUnlocked) return true
      if (state.pinRequest) return false
      void state
        .requestPin({
          titleKey: 'guestMode.pin.unlockSettingsTitle',
          bodyKey: 'guestMode.pin.unlockSettingsBody',
          mode: 'enter',
          submit: async (pin) => {
            const result = await window.api.guestMode.verify(pin)
            get().applyStatus(result.status)
            return result
          }
        })
        .then((ok) => {
          if (!ok || !get().settingsUnlocked) return
          useNavigationStore.getState().setMainView('settings')
        })
      return false
    })
    set({ presumedEnabled: usePreferencesStore.getState().guestModeEnabled })
    syncLibraryFilter()
    await fetchStatus()
  },

  applyStatus: (status) => {
    set({ status, hydrated: true, settingsUnlocked: settingsUnlockLive(status) })
    scheduleUnlockExpiry(status)
    syncLibraryFilter()
  },

  requestPin: (request) =>
    new Promise<boolean>((resolve) => {
      const previous = get().pinRequest
      if (previous) {
        // Only one PIN pad at a time; the newer request wins so flows never stall.
        pendingResolvers.get(previous.id)?.(false)
        pendingResolvers.delete(previous.id)
      }
      const id = nextRequestId++
      pendingResolvers.set(id, resolve)
      set({ pinRequest: { ...request, id } })
    }),

  resolvePinRequest: (id, ok) => {
    const resolver = pendingResolvers.get(id)
    pendingResolvers.delete(id)
    if (get().pinRequest?.id === id) set({ pinRequest: null })
    resolver?.(ok)
  }
}))
