import { create } from 'zustand'

interface AttractModeState {
  active: boolean
  lastInputAt: number
  touch: () => void
}
export const useAttractModeStore = create<AttractModeState>((set) => ({
  active: false,
  lastInputAt: Date.now(),
  touch: () => set({ active: false, lastInputAt: Date.now() })
}))
