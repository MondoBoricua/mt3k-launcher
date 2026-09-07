import { create } from 'zustand'

interface TitleMusicState {
  homeGameId: string | null
  fullScreenTrailerGameId: string | null
  playingGameId: string | null
  setHomeGameId: (gameId: string | null) => void
  clearHomeGameId: (gameId: string | null) => void
  setFullScreenTrailerOpen: (gameId: string, open: boolean) => void
  setPlayingGameId: (gameId: string | null) => void
}

export const useTitleMusicStore = create<TitleMusicState>((set) => ({
  homeGameId: null,
  fullScreenTrailerGameId: null,
  playingGameId: null,
  setHomeGameId: (homeGameId) => set({ homeGameId }),
  clearHomeGameId: (gameId) =>
    set((state) => (state.homeGameId === gameId ? { homeGameId: null } : state)),
  setFullScreenTrailerOpen: (gameId, open) =>
    set((state) => {
      if (open) return { fullScreenTrailerGameId: gameId }
      return state.fullScreenTrailerGameId === gameId
        ? { fullScreenTrailerGameId: null }
        : state
    }),
  setPlayingGameId: (playingGameId) => set({ playingGameId })
}))
