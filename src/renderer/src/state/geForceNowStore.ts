import { create } from 'zustand'
import type { GeForceNowCatalogSnapshot, GeForceNowLibraryMatch } from '@shared/ipc'
import { useOrbitPlusStore } from './orbitPlusStore'

interface GeForceNowState {
  snapshot: GeForceNowCatalogSnapshot
  matchesByGameId: Record<string, GeForceNowLibraryMatch>
  isRefreshing: boolean
  init: () => Promise<void>
  refresh: () => Promise<void>
  dispose: () => void
}

const EMPTY_SNAPSHOT: GeForceNowCatalogSnapshot = {
  state: 'locked',
  matches: [],
  catalogSize: 0,
  region: 'DE'
}

let initialized = false
let removeCatalogListener: (() => void) | undefined
let removeAccessListener: (() => void) | undefined
let accessGeneration = 0

function hasCloudAccess(): boolean {
  return useOrbitPlusStore.getState().hasFeature('cloud-gaming')
}

function indexedMatches(
  snapshot: GeForceNowCatalogSnapshot
): Record<string, GeForceNowLibraryMatch> {
  return Object.fromEntries(snapshot.matches.map((match) => [match.gameId, match]))
}

export const useGeForceNowStore = create<GeForceNowState>((set) => {
  const applySnapshot = (snapshot: GeForceNowCatalogSnapshot): void => {
    if (!initialized || !hasCloudAccess()) return
    set({ snapshot, matchesByGameId: indexedMatches(snapshot) })
  }

  const reset = (): void => {
    accessGeneration++
    set({ snapshot: EMPTY_SNAPSHOT, matchesByGameId: {}, isRefreshing: false })
  }

  const load = async (): Promise<void> => {
    if (!hasCloudAccess()) return
    const generation = accessGeneration
    set({ snapshot: { ...EMPTY_SNAPSHOT, state: 'loading' } })
    try {
      const snapshot = await window.api.geforceNow.getCatalog()
      if (generation === accessGeneration) applySnapshot(snapshot)
    } catch {
      if (generation === accessGeneration && hasCloudAccess()) {
        applySnapshot({ ...EMPTY_SNAPSHOT, state: 'error', issue: 'catalog-unavailable' })
      }
    }
  }

  return {
    snapshot: EMPTY_SNAPSHOT,
    matchesByGameId: {},
    isRefreshing: false,
    init: async () => {
      if (initialized) return
      initialized = true
      removeCatalogListener = window.api.geforceNow.onCatalogUpdated(applySnapshot)
      let unlocked = hasCloudAccess()
      removeAccessListener = useOrbitPlusStore.subscribe(() => {
        const next = hasCloudAccess()
        if (next === unlocked) return
        unlocked = next
        reset()
        if (next) void load()
      })
      await load()
    },
    refresh: async () => {
      if (!initialized || !hasCloudAccess()) return
      const generation = accessGeneration
      set({ isRefreshing: true })
      try {
        const snapshot = await window.api.geforceNow.refreshCatalog()
        if (generation === accessGeneration) applySnapshot(snapshot)
      } catch {
        if (generation !== accessGeneration || !hasCloudAccess()) return
        set((current) => ({
          snapshot: {
            ...current.snapshot,
            state: current.snapshot.matches.length > 0 ? 'stale' : 'error',
            issue: 'catalog-unavailable'
          }
        }))
      } finally {
        if (generation === accessGeneration) set({ isRefreshing: false })
      }
    },
    dispose: () => {
      initialized = false
      removeCatalogListener?.()
      removeAccessListener?.()
      removeCatalogListener = undefined
      removeAccessListener = undefined
      reset()
    }
  }
})
