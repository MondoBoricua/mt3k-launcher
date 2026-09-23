import { create } from 'zustand'
import type { LibrarySnapshot } from '@shared/ipc'
import { visibleGames } from '@shared/guestModePolicy'

interface LibraryState {
  /** What the launcher surfaces render. Guest mode narrows it to the allowed set. */
  snapshot: LibrarySnapshot
  /** The unfiltered snapshot from the main process. */
  sourceSnapshot: LibrarySnapshot
  /** `null` while guest mode is off; otherwise the only game IDs a guest may see. */
  guestAllowedIds: string[] | null
  isRefreshing: boolean
  init: () => Promise<void>
  scheduleRefresh: (delayMs?: number) => void
  refreshStartup: () => Promise<void>
  refresh: () => Promise<void>
  applySnapshot: (snapshot: LibrarySnapshot) => void
  setGuestAllowedIds: (allowedIds: string[] | null) => void
}

const EMPTY_SNAPSHOT: LibrarySnapshot = {
  games: [],
  providerGames: [],
  excludedGames: [],
  recentGameIds: [],
  loadedAt: 0,
  isLoadingMetadata: false
}

function projectSnapshot(
  snapshot: LibrarySnapshot,
  guestAllowedIds: string[] | null
): LibrarySnapshot {
  if (guestAllowedIds === null) return snapshot
  const games = visibleGames(snapshot.games, guestAllowedIds, true)
  const visibleIds = new Set(games.map((game) => game.id))
  return {
    ...snapshot,
    games,
    providerGames: visibleGames(snapshot.providerGames, guestAllowedIds, true),
    // Hidden games stay hidden: restoring them is an owner action.
    excludedGames: [],
    recentGameIds: snapshot.recentGameIds.filter((gameId) => visibleIds.has(gameId))
  }
}

const FIRST_INTERACTIVE_REFRESH_DELAY_MS = 2_500

let listening = false
let initialized = false
let refreshTimer: number | undefined
let startupRefreshCompleted = false
let startupRefreshPromise: Promise<void> | undefined
let refreshPromise: Promise<void> | undefined
let activeRefreshCount = 0

function beginRefresh(set: (state: Partial<LibraryState>) => void): void {
  activeRefreshCount += 1
  if (activeRefreshCount === 1) set({ isRefreshing: true })
}

function endRefresh(set: (state: Partial<LibraryState>) => void): void {
  activeRefreshCount = Math.max(0, activeRefreshCount - 1)
  if (activeRefreshCount === 0) set({ isRefreshing: false })
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  const receive = (sourceSnapshot: LibrarySnapshot): void =>
    set({ sourceSnapshot, snapshot: projectSnapshot(sourceSnapshot, get().guestAllowedIds) })

  return {
    snapshot: EMPTY_SNAPSHOT,
    sourceSnapshot: EMPTY_SNAPSHOT,
    guestAllowedIds: null,
    isRefreshing: false,
    applySnapshot: receive,
    setGuestAllowedIds: (guestAllowedIds) =>
      set((state) => ({
        guestAllowedIds,
        snapshot: projectSnapshot(state.sourceSnapshot, guestAllowedIds)
      })),

    init: async () => {
      if (initialized) return
      initialized = true
      if (!listening) {
        listening = true
        window.api.library.onUpdated((snapshot) => receive(snapshot))
      }
      // Hydrate only the durable local snapshot here. MainShell schedules provider
      // reconciliation after its first interactive frame so startup work cannot
      // compete with navigation and layout.
      try {
        const snapshot = await window.api.library.get()
        receive(snapshot)
      } catch (err) {
        console.error('Cached library hydration failed, attempting a fresh sync', err)
      }
    },

    scheduleRefresh: (delayMs = FIRST_INTERACTIVE_REFRESH_DELAY_MS) => {
      if (startupRefreshCompleted || startupRefreshPromise) return
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        void get().refreshStartup()
      }, Math.max(0, delayMs))
    },

    refreshStartup: async () => {
      if (startupRefreshCompleted) return
      if (startupRefreshPromise) return startupRefreshPromise
      beginRefresh(set)
      const request = (async (): Promise<void> => {
        try {
          const snapshot = await window.api.library.refreshStartup()
          receive(snapshot)
          startupRefreshCompleted = true
        } catch (err) {
          console.error('Startup library reconciliation failed, keeping cached snapshot', err)
        } finally {
          endRefresh(set)
        }
      })()
      startupRefreshPromise = request
      try {
        await request
      } finally {
        if (startupRefreshPromise === request) startupRefreshPromise = undefined
      }
    },

    refresh: async () => {
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer)
        refreshTimer = undefined
      }
      if (refreshPromise) return refreshPromise
      beginRefresh(set)
      const request = (async (): Promise<void> => {
        try {
          const snapshot = await window.api.library.refresh()
          receive(snapshot)
        } catch (err) {
          console.error('Library refresh failed, keeping cached snapshot', err)
        } finally {
          endRefresh(set)
        }
      })()
      refreshPromise = request
      try {
        await request
      } finally {
        if (refreshPromise === request) refreshPromise = undefined
      }
    }
  }
})
