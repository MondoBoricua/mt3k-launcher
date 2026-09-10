import { create } from 'zustand'
import type { LauncherDownloadSnapshot } from '@shared/ipc'
import {
  orderedLauncherDownloads,
  shouldApplyLauncherDownloadSnapshot
} from '@shared/launcherDownloads'

const EMPTY_SNAPSHOT: LauncherDownloadSnapshot = {
  revision: -1,
  checkedAt: 0,
  updatedAt: 0,
  activities: []
}

interface DownloadState {
  snapshot: LauncherDownloadSnapshot
  centerOpen: boolean
  selectedActivityId: string | null
  init: () => Promise<void>
  refresh: () => Promise<void>
  openCenter: (activityId?: string) => void
  closeCenter: () => void
  selectActivity: (activityId: string) => void
}

let listening = false
let initialized = false

export const useDownloadStore = create<DownloadState>((set, get) => {
  const applySnapshot = (incoming: LauncherDownloadSnapshot): void => {
    set((state) => {
      if (!shouldApplyLauncherDownloadSnapshot(state.snapshot, incoming)) return state
      if (incoming.revision === state.snapshot.revision) {
        return {
          snapshot: { ...state.snapshot, checkedAt: incoming.checkedAt }
        }
      }
      const ordered = orderedLauncherDownloads(incoming.activities)
      const selectedStillExists = ordered.some(
        (activity) => activity.id === state.selectedActivityId
      )
      return {
        snapshot: incoming,
        selectedActivityId: selectedStillExists
          ? state.selectedActivityId
          : (ordered[0]?.id ?? null)
      }
    })
  }

  const refreshSnapshot = async (): Promise<boolean> => {
    try {
      applySnapshot(await window.api.downloads.get())
      return true
    } catch {
      return false
    }
  }

  return {
    snapshot: EMPTY_SNAPSHOT,
    centerOpen: false,
    selectedActivityId: null,
    init: async () => {
      if (initialized) return
      initialized = true
      if (!listening) {
        listening = true
        window.api.downloads.onUpdated(applySnapshot)
      }
      if (!(await refreshSnapshot())) initialized = false
    },
    refresh: async () => {
      await refreshSnapshot()
    },
    openCenter: (activityId) => {
      const activities = orderedLauncherDownloads(get().snapshot.activities)
      const selected = activities.some((activity) => activity.id === activityId)
        ? activityId
        : activities[0]?.id
      set({ centerOpen: true, selectedActivityId: selected ?? null })
    },
    closeCenter: () => set({ centerOpen: false }),
    selectActivity: (selectedActivityId) => set({ selectedActivityId })
  }
})
