import type { MainView } from '@renderer/state/navigationStore'

export const mainViewLoaders = {
  applications: () => import('@renderer/views/Applications/ApplicationsView'),
  friends: () => import('@renderer/views/Friends/FriendsView'),
  library: () => import('@renderer/views/Library/LibraryView'),
  store: () => import('@renderer/views/Store/StoreView'),
  settings: () => import('@renderer/views/Settings/SettingsView')
} as const

export function preloadMainView(view: MainView): void {
  if (view === 'home') return
  void mainViewLoaders[view]().catch(() => undefined)
}
