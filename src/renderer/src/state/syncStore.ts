import { create } from 'zustand'
import type { SyncPipelineId, SystemSyncStatus } from '@shared/ipc'

const now = Date.now()
const initialStatus: SystemSyncStatus = {
  updatedAt: now,
  pipelines: {
    library: { id: 'library', state: 'idle', completed: 0, total: 0, updatedAt: now },
    metadata: { id: 'metadata', state: 'idle', completed: 0, total: 0, updatedAt: now },
    artwork: { id: 'artwork', state: 'idle', completed: 0, total: 0, updatedAt: now },
    achievements: { id: 'achievements', state: 'idle', completed: 0, total: 0, updatedAt: now },
    store: { id: 'store', state: 'idle', completed: 0, total: 0, updatedAt: now }
  }
}

interface SyncState {
  status: SystemSyncStatus
  init: () => Promise<void>
}

let listening = false
let initialized = false
let initializationPromise: Promise<void> | undefined

export const SYNC_PIPELINE_ORDER: SyncPipelineId[] = [
  'library',
  'metadata',
  'artwork',
  'achievements',
  'store'
]

export const useSyncStore = create<SyncState>((set) => ({
  status: initialStatus,
  init: async () => {
    if (initialized) return
    if (initializationPromise) return initializationPromise
    if (!listening) {
      listening = true
      window.api.sync.onUpdated((status) => set({ status }))
    }
    const request = (async (): Promise<void> => {
      try {
        set({ status: await window.api.sync.get() })
        initialized = true
      } catch {
        // Keep the safe idle snapshot. MainShell may retry initialization after mount.
      }
    })()
    initializationPromise = request
    try {
      await request
    } finally {
      if (initializationPromise === request) initializationPromise = undefined
    }
  }
}))
