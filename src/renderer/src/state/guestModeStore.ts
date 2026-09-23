import { create } from 'zustand'
import type { GuestModeStatus, GuestModeVerifyResult } from '@shared/ipc'
import type { TranslationKey } from '@renderer/i18n/translations'
import { setMainViewGuard, useNavigationStore } from './navigationStore'
import { useLibraryStore } from './libraryStore'
import { useLibraryCollectionsStore } from './libraryCollectionsStore'

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
  hydrated: boolean
  /** Settings stays open after a successful PIN until the owner leaves the view. */
  settingsUnlocked: boolean
  pinRequest: PinRequest | null
  init: () => Promise<void>
  applyStatus: (status: GuestModeStatus) => void
  requestPin: (request: Omit<PinRequest, 'id'>) => Promise<boolean>
  resolvePinRequest: (id: number, ok: boolean) => void
  /** Keeps Settings open after the owner enables guest mode from inside it. */
  unlockSettings: () => void
}

const IDLE_STATUS: GuestModeStatus = { enabled: false, hasPin: false, attemptsLeft: 5 }

let initialized = false
let nextRequestId = 1
const pendingResolvers = new Map<number, (ok: boolean) => void>()

export function isGuestModeActive(state: Pick<GuestModeState, 'status' | 'hydrated'>): boolean {
  return state.hydrated && state.status.enabled
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
  const next = state.hydrated ? allowedGameIds(state.status) : null
  const current = useLibraryStore.getState().guestAllowedIds
  const unchanged =
    (next === null && current === null) ||
    (next !== null &&
      current !== null &&
      next.length === current.length &&
      next.every((id, index) => id === current[index]))
  if (!unchanged) useLibraryStore.getState().setGuestAllowedIds(next)
}

export const useGuestModeStore = create<GuestModeState>((set, get) => ({
  status: IDLE_STATUS,
  hydrated: false,
  settingsUnlocked: false,
  pinRequest: null,

  init: async () => {
    if (initialized) return
    initialized = true
    window.api.guestMode.onStatus((status) => get().applyStatus(status))
    useLibraryCollectionsStore.subscribe((state, previous) => {
      if (state.collections !== previous.collections) syncLibraryFilter()
    })
    useNavigationStore.subscribe((state, previous) => {
      if (state.mainView !== previous.mainView && state.mainView !== 'settings') {
        if (get().settingsUnlocked) set({ settingsUnlocked: false })
      }
    })
    setMainViewGuard((view) => {
      const state = get()
      if (!isGuestModeActive(state)) return true
      // The store and friends hub are hidden for guests; nothing may deep-link into them.
      if (view === 'store' || view === 'friends') return false
      if (view !== 'settings' || state.settingsUnlocked) return true
      if (state.pinRequest) return false
      void state
        .requestPin({
          titleKey: 'guestMode.pin.unlockSettingsTitle',
          bodyKey: 'guestMode.pin.unlockSettingsBody',
          mode: 'enter',
          submit: (pin) => window.api.guestMode.verify(pin)
        })
        .then((ok) => {
          if (!ok) return
          set({ settingsUnlocked: true })
          useNavigationStore.getState().setMainView('settings')
        })
      return false
    })
    try {
      const status = await window.api.guestMode.status()
      set({ status, hydrated: true })
    } catch (error) {
      console.warn('[guest-mode] status unavailable, treating guest mode as off', error)
      set({ status: IDLE_STATUS, hydrated: true })
    }
    syncLibraryFilter()
  },

  applyStatus: (status) => {
    set({ status, hydrated: true })
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

  unlockSettings: () => set({ settingsUnlocked: true }),

  resolvePinRequest: (id, ok) => {
    const resolver = pendingResolvers.get(id)
    pendingResolvers.delete(id)
    if (get().pinRequest?.id === id) set({ pinRequest: null })
    resolver?.(ok)
  }
}))
