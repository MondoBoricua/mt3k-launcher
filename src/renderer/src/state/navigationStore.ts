import { create } from 'zustand'

export type MainView = 'home' | 'applications' | 'friends' | 'library' | 'store' | 'settings'

export const MAIN_VIEW_ORDER: MainView[] = [
  'home',
  'applications',
  'friends',
  'library',
  'store',
  'settings'
]

export function getVisibleMainViews({
  showFriendsHub,
  showStoreTab,
  guestModeActive = false
}: {
  showFriendsHub: boolean
  showStoreTab: boolean
  /** Guest mode hides the store and friends hub regardless of the visibility toggles. */
  guestModeActive?: boolean
}): MainView[] {
  return MAIN_VIEW_ORDER.filter(
    (view) =>
      (view !== 'friends' || (showFriendsHub && !guestModeActive)) &&
      (view !== 'store' || (showStoreTab && !guestModeActive))
  )
}

type MainViewGuard = (view: MainView) => boolean

let mainViewGuard: MainViewGuard | null = null

/**
 * Lets a feature intercept navigation (guest mode asks for its PIN before
 * Settings opens). Returning `false` cancels the change; the guard is then
 * responsible for navigating later if it wants to.
 */
export function setMainViewGuard(guard: MainViewGuard | null): void {
  mainViewGuard = guard
}

export type OnboardingStep = 'welcome' | 'steam-login' | 'epic-login' | 'success'
export type AppPhase = 'onboarding' | 'main'

interface NavigationState {
  phase: AppPhase
  onboardingStep: OnboardingStep
  mainView: MainView
  mainViewDirection: 1 | -1
  setPhase: (phase: AppPhase) => void
  setOnboardingStep: (step: OnboardingStep) => void
  setMainView: (view: MainView, direction?: 1 | -1) => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  phase: 'onboarding',
  onboardingStep: 'welcome',
  mainView: 'home',
  mainViewDirection: 1,
  setPhase: (phase) => set({ phase }),
  setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
  setMainView: (mainView, direction) =>
    set((state) => {
      if (mainView !== state.mainView && mainViewGuard && !mainViewGuard(mainView)) return state
      const currentIndex = MAIN_VIEW_ORDER.indexOf(state.mainView)
      const nextIndex = MAIN_VIEW_ORDER.indexOf(mainView)
      return {
        mainView,
        mainViewDirection: direction ?? (nextIndex >= currentIndex ? 1 : -1)
      }
    })
}))
