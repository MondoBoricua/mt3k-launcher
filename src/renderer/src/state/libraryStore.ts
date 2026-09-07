import { create } from 'zustand'
import type { LibrarySnapshot } from '@shared/ipc'

interface LibraryState {
  snapshot: LibrarySnapshot
  isRefreshing: boolean
  init: () => Promise<void>
  scheduleRefresh: (delayMs?: number) => void
  refresh: () => Promise<void>
  applySnapshot: (snapshot: LibrarySnapshot) => void
}

const FIRST_INTERACTIVE_REFRESH_DELAY_MS = 2_500

let listening = false
let initialized = false
let refreshTimer: number | undefined
let refreshPromise: Promise<void> | undefined

export const useLibraryStore = create<LibraryState>((set, get) => ({
  snapshot: {
    games: [],
    providerGames: [],
    excludedGames: [],
    recentGameIds: [],
    loadedAt: 0,
    isLoadingMetadata: false
  },
  isRefreshing: false,
  applySnapshot: (snapshot) => set({ snapshot }),

  init: async () => {
    if (initialized) return
    initialized = true
    if (!listening) {
      listening = true
      window.api.library.onUpdated((snapshot) => set({ snapshot }))
    }
    // Hydrate only the durable local snapshot here. MainShell schedules provider
    // reconciliation after its first interactive frame so startup work cannot
    // compete with navigation and layout.
    try {
      const snapshot = await window.api.library.get()
      set({ snapshot })
    } catch (err) {
      console.error('Cached library hydration failed, attempting a fresh sync', err)
    }
  },

  scheduleRefresh: (delayMs = FIRST_INTERACTIVE_REFRESH_DELAY_MS) => {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined
      void get().refresh()
    }, Math.max(0, delayMs))
  },

  refresh: async () => {
    if (refreshTimer !== undefined) {
      window.clearTimeout(refreshTimer)
      refreshTimer = undefined
    }
    if (refreshPromise) return refreshPromise
    set({ isRefreshing: true })
    const request = (async (): Promise<void> => {
      try {
        const snapshot = await window.api.library.refresh()
        set({ snapshot })
      } catch (err) {
        console.error('Library refresh failed, keeping cached snapshot', err)
      } finally {
        set({ isRefreshing: false })
      }
    })()
    refreshPromise = request
    try {
      await request
    } finally {
      if (refreshPromise === request) refreshPromise = undefined
    }
  }
}))
