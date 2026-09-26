import { useEffect, useState } from 'react'
import { CheckCircle2, CircleAlert, FolderOpen, Loader2, RotateCcw, ScanLine } from 'lucide-react'
import type { OrbitSettings } from '@shared/ipc'
import type { LosslessScalingStatus } from '@shared/losslessScalingPolicy'
import { useT } from '@renderer/i18n/useT'
import { notify } from '@renderer/state/notificationStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'

type LosslessScalingSettingsPartial = Partial<
  Pick<OrbitSettings, 'losslessScalingEnabled' | 'losslessScalingDefaultForGames' | 'losslessScalingCloseOnExit'>
>

function reportError(messageKey: 'losslessScaling.saveError' | 'losslessScaling.pathError'): void {
  notify({ tone: 'error', titleKey: 'losslessScaling.title', messageKey, force: true })
}

/** Windows-only: renders nothing until the main process confirms support. */
export function LosslessScalingSection({
  settings,
  onSettings
}: {
  settings: OrbitSettings | null
  onSettings: (next: OrbitSettings) => void
}): JSX.Element | null {
  const t = useT()
  const [status, setStatus] = useState<LosslessScalingStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const enabled = settings?.losslessScalingEnabled === true

  const refresh = (): void => {
    void window.api.losslessScaling.status().then(setStatus).catch(() => setStatus(null))
  }

  useEffect(() => {
    refresh()
  }, [])

  if (!status?.supported) return null

  const save = (partial: LosslessScalingSettingsPartial): void => {
    if (busy) return
    setBusy(true)
    void window.api.settings.set(partial)
      .then((next) => {
        onSettings(next)
        usePreferencesStore.setState({
          losslessScalingEnabled: next.losslessScalingEnabled === true,
          losslessScalingDefaultForGames: next.losslessScalingDefaultForGames === true
        })
        if (partial.losslessScalingEnabled) refresh()
      })
      .catch(() => reportError('losslessScaling.saveError'))
      .finally(() => setBusy(false))
  }

  const choosePath = (clear: boolean): void => {
    if (busy) return
    setBusy(true)
    const request = clear ? window.api.losslessScaling.clearPath() : window.api.losslessScaling.choosePath()
    void request
      .then((next) => { if (next) setStatus(next) })
      .catch(() => reportError('losslessScaling.pathError'))
      .finally(() => setBusy(false))
  }

  const manualMissing = Boolean(status.manualPath && status.source !== 'manual')

  return (
    <SettingsSection id="lossless-scaling" icon={ScanLine} title={t('losslessScaling.title')} description={t('losslessScaling.body')}>
      <div className="space-y-3">
        <SettingsToggle id="losslessScalingEnabled" active={enabled} defaultInactive disabled={!settings || busy}
          title={t('losslessScaling.enable')} description={t('losslessScaling.body')} t={t}
          onChange={(active) => save({ losslessScalingEnabled: active })} />
        <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('losslessScaling.hint')}</p>
        {enabled && (
          <>
            <SettingsToggle id="losslessScalingDefaultForGames" active={settings?.losslessScalingDefaultForGames === true}
              defaultInactive disabled={busy} title={t('losslessScaling.defaultForGames')}
              description={t('losslessScaling.defaultForGamesBody')} t={t}
              onChange={(active) => save({ losslessScalingDefaultForGames: active })} />
            <SettingsToggle id="losslessScalingCloseOnExit" active={settings?.losslessScalingCloseOnExit !== false}
              defaultActive disabled={busy} title={t('losslessScaling.closeOnExit')}
              description={t('losslessScaling.closeOnExitBody')} t={t}
              onChange={(active) => save({ losslessScalingCloseOnExit: active })} />
            <div className="space-y-2 rounded-2xl border border-white/[0.07] bg-black/15 p-4 text-sm" role="status" aria-live="polite">
              {status.state === 'found' && status.path ? (
                <p className="flex items-start gap-2 break-all text-emerald-200">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                  {t(status.source === 'manual' ? 'losslessScaling.foundManual' : 'losslessScaling.foundSteam', { path: status.path })}
                </p>
              ) : (
                <p className="flex items-start gap-2 text-amber-200">
                  <CircleAlert size={16} className="mt-0.5 shrink-0" />
                  {t('losslessScaling.notFound')}
                </p>
              )}
              {manualMissing && (
                <p className="break-all text-xs text-amber-200/80">{t('losslessScaling.manualMissing', { path: status.manualPath ?? '' })}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <FocusableButton variant="solid" disabled={busy} onClick={() => choosePath(false)}>
                <span className="flex items-center gap-2">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                  {busy ? t('losslessScaling.busy') : t('losslessScaling.choose')}
                </span>
              </FocusableButton>
              {status.manualPath && (
                <FocusableButton variant="ghost" disabled={busy} onClick={() => choosePath(true)}>
                  <span className="flex items-center gap-2">
                    <RotateCcw size={16} />
                    {t('losslessScaling.useDetected')}
                  </span>
                </FocusableButton>
              )}
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  )
}
