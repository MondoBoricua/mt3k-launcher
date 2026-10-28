/**
 * Opciones de FSR 4.1 Lite dentro de Editar detalles.
 * No pinta nada si la función está apagada o el juego no es local.
 */
import { useState } from 'react'
import type { LibraryGame } from '@shared/ipc'
import { isFsr4LiteEligibleGame } from '@shared/fsr4LitePolicy'
import { useT } from '@renderer/i18n/useT'
import { notify } from '@renderer/state/notificationStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { Fsr4LiteOptions, fsr4LiteErrorCode, fsr4LiteErrorKey, useFsr4LiteGame } from './Fsr4LiteGame'

export function Fsr4LiteGameControl({ game }: { game: LibraryGame }): JSX.Element | null {
  const t = useT()
  const enabled = usePreferencesStore((state) => state.fsr4LiteEnabled)
  const eligible = enabled && isFsr4LiteEligibleGame(game)
  const { view, replace } = useFsr4LiteGame(eligible ? game.id : null)
  const [busy, setBusy] = useState(false)
  if (!eligible || !view || view.phase === 'hidden' || view.phase === 'blocked' || view.phase === 'widget') return null

  return (
    <section data-fsr4-lite-game className="space-y-3 rounded-2xl border border-white/[0.07] bg-black/15 p-4">
      <h3 className="text-base font-semibold text-white/90">{t('fsr4Lite.title')}</h3>
      <p className="text-sm text-muted">{t('fsr4Lite.editor.hint')}</p>
      <Fsr4LiteOptions view={view} busy={busy} onChange={(next) => {
        if (busy) return
        setBusy(true)
        void window.api.fsr4Lite.setOptions(game.id, next)
          .then(replace)
          .catch((error: unknown) => {
            const code = fsr4LiteErrorCode(error)
            notify({
              tone: 'error',
              titleKey: 'fsr4Lite.title',
              messageKey: fsr4LiteErrorKey(code),
              vars: code === 'anti-cheat' ? { name: '' } : undefined,
              force: true
            })
          })
          .finally(() => setBusy(false))
      }} />
    </section>
  )
}
