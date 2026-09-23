import { create } from 'zustand'
import type { CaptureItem } from '@shared/capturePolicy'
import { usePreferencesStore } from './preferencesStore'

interface CapturesState {
  items: CaptureItem[]
  loading: boolean
  error: boolean
  panelOpen: boolean
  showPanel: () => void
  closePanel: () => void
  refresh: () => Promise<void>
  open: (path: string) => Promise<void>
  openFolder: () => Promise<void>
}
let generation = 0
export const useCapturesStore = create<CapturesState>((set, get) => ({
  items: [], loading: false, error: false, panelOpen: false,
  showPanel: () => {
    if (usePreferencesStore.getState().captureShelfEnabled) set({ panelOpen: true })
  },
  closePanel: () => set({ panelOpen: false }),
  refresh: async () => {
    if (!usePreferencesStore.getState().captureShelfEnabled || get().loading) return
    const request = ++generation
    set({ loading: true, error: false })
    try {
      const items = await window.api.captures.list()
      if (request === generation && usePreferencesStore.getState().captureShelfEnabled) set({ items })
    } catch (error) {
      console.warn('[captures] Cannot load captures', error)
      if (request === generation) set({ error: true })
    } finally {
      if (request === generation) set({ loading: false })
    }
  },
  open: async (path) => {
    if (!usePreferencesStore.getState().captureShelfEnabled) return
    set({ error: false })
    try { await window.api.captures.open(path) }
    catch (error) { console.warn('[captures] Cannot open capture', error); set({ error: true }) }
  },
  openFolder: async () => {
    if (!usePreferencesStore.getState().captureShelfEnabled) return
    set({ error: false })
    try { await window.api.captures.openFolder() }
    catch (error) { console.warn('[captures] Cannot open folder', error); set({ error: true }) }
  }
}))

/** Called by the setting action; no subscription runs while disabled. */
export function clearCaptures(): void {
  generation++
  useCapturesStore.setState({ items: [], loading: false, error: false, panelOpen: false })
}
