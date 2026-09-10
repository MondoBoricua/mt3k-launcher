import { useCallback } from 'react'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import {
  resolveGameCardActivation,
  type GameCardActivationTarget
} from '@renderer/lib/gameCardActivation'
import { useLaunchGame } from './useLaunchGame'
import { playUiSound } from '@renderer/lib/uiAudio'
import { openOrbitPlusSettings, useOrbitPlusStore } from '@renderer/state/orbitPlusStore'
import { useLibraryStore } from '@renderer/state/libraryStore'
import { canRequestGameInstall } from '@shared/gameInstallation'

export function useActivateGameCard(): (
  gameId: string,
  target?: GameCardActivationTarget
) => void {
  const primaryAction = usePreferencesStore((state) => state.gameCardPrimaryAction)
  const openGame = useGameDetailStore((state) => state.openGame)
  const launchGame = useLaunchGame()

  return useCallback(
    (gameId, target = 'default') => {
      if (target === 'geforce-now' && !useOrbitPlusStore.getState().hasFeature('cloud-gaming')) {
        openOrbitPlusSettings()
        return
      }
      const library = useLibraryStore.getState().snapshot
      const game =
        library.games.find((candidate) => candidate.id === gameId) ??
        library.providerGames.find((candidate) => candidate.id === gameId)
      if (target === 'default' && game && canRequestGameInstall(game)) {
        openGame(gameId)
        return
      }
      const activation = resolveGameCardActivation(primaryAction, target)
      if (activation.kind === 'details') {
        openGame(gameId, activation.preferredAction)
        return
      }
      if (activation.target === 'geforce-now') {
        void window.api.geforceNow.launchGame(gameId).catch(() => playUiSound('error'))
        return
      }
      launchGame(gameId)
    },
    [launchGame, openGame, primaryAction]
  )
}
