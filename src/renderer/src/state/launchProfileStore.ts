import { create } from 'zustand'
import type { DisplayMode, DisplayModeList, LaunchProfile, LaunchProfileEntry, LaunchProfileEvent } from '@shared/launchProfilePolicy'
import type { TranslationKey } from '@renderer/i18n/translations'
import { notify } from './notificationStore'

export function reportLaunchProfileError(
  error: unknown,
  messageKey: TranslationKey = 'launchProfiles.error'
): void {
  console.warn('[launch-profiles] Request failed:', error)
  notify({ titleKey: 'launchProfiles.title', messageKey, tone: 'error', force: true })
}
interface LaunchProfileState {
  gameId: string | null
  entry: LaunchProfileEntry
  display: DisplayModeList | null
  editingMode: DisplayMode
  selection: number
  busy: boolean
  error: boolean
  pending: Extract<LaunchProfileEvent, { kind: 'confirm' }> | null
  load: (gameId: string) => Promise<void>
  editMode: (mode: DisplayMode) => void
  cycle: (direction: number) => void
  save: (profile: LaunchProfile | null) => Promise<void>
  receive: (event: LaunchProfileEvent) => void
  confirm: () => Promise<void>
  revert: () => Promise<void>
}
let generation = 0
export const useLaunchProfileStore = create<LaunchProfileState>((set, get) => ({
  gameId: null, entry: {}, display: null, editingMode: 'handheld', selection: 0, busy: false, error: false, pending: null,
  load: async (gameId) => {
    const request = ++generation
    set({ gameId, entry: {}, display: null, busy: true, error: false, selection: 0 })
    try {
      const [entry, display] = await Promise.all([window.api.launchProfiles.get(gameId), window.api.display.listModes()])
      if (request === generation) {
        const saved = entry[display.mode]
        const selection = saved ? Math.max(0, display.modes.findIndex((p) => p.width === saved.width && p.height === saved.height && p.refreshHz === saved.refreshHz)) : 0
        set({ entry, display, editingMode: display.mode, selection })
      }
    } catch (error) { if (request === generation) set({ error: true }); reportLaunchProfileError(error) }
    finally { if (request === generation) set({ busy: false }) }
  },
  editMode: (editingMode) => set({ editingMode }),
  cycle: (direction) => {
    const { display, selection } = get()
    if (display?.modes.length) set({ selection: (selection + direction + display.modes.length) % display.modes.length })
  },
  save: async (profile) => {
    const { gameId, editingMode, busy } = get()
    if (!gameId || busy) return
    const request = generation
    set({ busy: true, error: false })
    try {
      const entry = await window.api.launchProfiles.save(gameId, editingMode, profile)
      if (request === generation) set({ entry })
    } catch (error) { if (request === generation) set({ error: true }); reportLaunchProfileError(error) }
    finally { if (request === generation) set({ busy: false }) }
  },
  receive: (event) => {
    set({ pending: event.kind === 'confirm' ? event : null })
    if (event.kind === 'error') {
      reportLaunchProfileError(
        'Display operation failed',
        event.reason === 'pending-journal' ? 'launchProfiles.pendingBlocksLaunch' : 'launchProfiles.error'
      )
    }
    if (event.kind === 'restored') notify({ titleKey: 'launchProfiles.title', messageKey: 'launchProfiles.restored', force: true })
  },
  confirm: async () => {
    const pending = get().pending
    if (!pending) return
    try { if (!await window.api.launchProfiles.confirm(pending.token)) set({ pending: null }) }
    catch (error) { reportLaunchProfileError(error) }
  },
  revert: async () => {
    try { await window.api.launchProfiles.revert() }
    catch (error) { reportLaunchProfileError(error) }
  }
}))
