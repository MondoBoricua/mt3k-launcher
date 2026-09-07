import { create } from 'zustand'
import type { GameCardActivationTarget } from '@renderer/lib/gameCardActivation'

interface GameDetailState {
  gameId: string | null
  preferredAction: GameCardActivationTarget
  openGame: (gameId: string, preferredAction?: GameCardActivationTarget) => void
  closeGame: () => void
}

export const useGameDetailStore = create<GameDetailState>((set) => ({
  gameId: null,
  preferredAction: 'default',
  openGame: (gameId, preferredAction = 'default') => set({ gameId, preferredAction }),
  closeGame: () => set({ gameId: null, preferredAction: 'default' })
}))
