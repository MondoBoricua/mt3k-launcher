import { create } from 'zustand'

export type SettingsPage =
  | 'appearance'
  | 'experience'
  | 'plus'
  | 'libraries'
  | 'hardware'
  | 'updates'
  | 'system'

export const SETTINGS_PAGE_ORDER: SettingsPage[] = [
  'appearance',
  'experience',
  'plus',
  'libraries',
  'hardware',
  'updates',
  'system'
]

interface SettingsNavigationState {
  page: SettingsPage
  direction: 1 | -1
  /** Pages this build does not offer, e.g. ORBIT Plus in the MT3K community edition. */
  hiddenPages: SettingsPage[]
  setPage: (page: SettingsPage) => void
  cyclePage: (step: 1 | -1) => void
  setHiddenPages: (pages: SettingsPage[]) => void
}

export const useSettingsNavigationStore = create<SettingsNavigationState>((set, get) => ({
  page: 'appearance',
  direction: 1,
  hiddenPages: [],
  setPage: (page) => {
    if (get().hiddenPages.includes(page)) return
    const currentIndex = SETTINGS_PAGE_ORDER.indexOf(get().page)
    const nextIndex = SETTINGS_PAGE_ORDER.indexOf(page)
    set({ page, direction: nextIndex >= currentIndex ? 1 : -1 })
  },
  cyclePage: (step) => {
    const { hiddenPages, page } = get()
    const visible = SETTINGS_PAGE_ORDER.filter((item) => !hiddenPages.includes(item))
    const index = Math.max(0, visible.indexOf(page))
    const nextIndex = (index + step + visible.length) % visible.length
    set({ page: visible[nextIndex], direction: step })
  },
  setHiddenPages: (pages) => {
    const { hiddenPages, page } = get()
    if (pages.length === hiddenPages.length && pages.every((item) => hiddenPages.includes(item))) return
    const visible = SETTINGS_PAGE_ORDER.filter((item) => !pages.includes(item))
    set({ hiddenPages: [...pages], page: pages.includes(page) ? visible[0] : page })
  }
}))
