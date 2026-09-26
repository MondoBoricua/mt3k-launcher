import { useEffect, useState } from 'react'
import type { LibraryGame } from '@shared/ipc'
import {
  LOSSLESS_SCALING_GAME_MODES,
  isLosslessScalingEligibleGame,
  type LosslessScalingGameMode
} from '@shared/losslessScalingPolicy'
import { useT } from '@renderer/i18n/useT'
import { notify } from '@renderer/state/notificationStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { FocusableButton } from './FocusableButton'

const MODE_LABELS = {
  always: 'losslessScaling.gameAlways',
  never: 'losslessScaling.gameNever'
} as const

/** Per-game tri-state. Renders nothing while the global toggle is off or for non-local games. */
export function LosslessScalingGameControl({ game }: { game: LibraryGame }): JSX.Element | null {
  const t = useT()
  const enabled = usePreferencesStore((s) => s.losslessScalingEnabled)
  const defaultForGames = usePreferencesStore((s) => s.losslessScalingDefaultForGames)
  const eligible = enabled && isLosslessScalingEligibleGame(game)
  const [mode, setMode] = useState<LosslessScalingGameMode | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!eligible) return
    let active = true
    void window.api.losslessScaling.getGameMode(game.id)
      .then((value) => { if (active) setMode(value) })
      .catch(() => { if (active) setMode('default') })
    return () => { active = false }
  }, [eligible, game.id])

  if (!eligible) return null

  const choose = (next: LosslessScalingGameMode): void => {
    if (busy || next === mode) return
    setBusy(true)
    void window.api.losslessScaling.setGameMode(game.id, next)
      .then(setMode)
      .catch(() => notify({ tone: 'error', titleKey: 'losslessScaling.title', messageKey: 'losslessScaling.gameError', force: true }))
      .finally(() => setBusy(false))
  }

  const label = (value: LosslessScalingGameMode): string =>
    value === 'default'
      ? t(defaultForGames ? 'losslessScaling.gameDefaultOn' : 'losslessScaling.gameDefaultOff')
      : t(MODE_LABELS[value])

  return (
    <section data-lossless-scaling-game className="space-y-3 rounded-2xl border border-white/[0.07] bg-black/15 p-4">
      <h3 className="text-base font-semibold text-white/90">{t('losslessScaling.title')}</h3>
      <p className="text-sm text-muted">{t('losslessScaling.gameHint')}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('losslessScaling.title')}>
        {LOSSLESS_SCALING_GAME_MODES.map((value) => (
          <FocusableButton key={value} type="button" variant={mode === value ? 'solid' : 'ghost'}
            aria-pressed={mode === value} disabled={busy || mode === null} onClick={() => choose(value)}>
            {label(value)}
          </FocusableButton>
        ))}
      </div>
    </section>
  )
}
