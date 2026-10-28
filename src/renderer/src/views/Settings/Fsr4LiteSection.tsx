/**
 * Tema de Experiencia para FSR 4.1 Lite.
 * En macOS, o hasta que el proceso principal diga que hay soporte, no se monta.
 * Apagado: solo el interruptor y una línea. El resto aparece al encenderlo.
 */
import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, Sparkles } from 'lucide-react'
import type { OrbitSettings } from '@shared/ipc'
import {
  FSR4_LITE_CREDIT_URL,
  FSR4_RENDER_SCALES,
  isFsr4RenderScale,
  type Fsr4LiteStatus,
  type Fsr4RenderScale
} from '@shared/fsr4LitePolicy'
import type { TranslationKey } from '@renderer/i18n/translations'
import { useT } from '@renderer/i18n/useT'
import { notify } from '@renderer/state/notificationStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { fsr4LiteErrorCode, fsr4LiteErrorKey } from '@renderer/components/Fsr4LiteGame'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'

const DEVICE_KEYS: Record<Fsr4LiteStatus['device']['support'], TranslationKey> = {
  supported: 'fsr4Lite.device.supported',
  'official-driver': 'fsr4Lite.device.official',
  experimental: 'fsr4Lite.device.experimental',
  unsupported: 'fsr4Lite.device.unsupported',
  unknown: 'fsr4Lite.device.unknown'
}

const SOURCE_KEYS: Record<Fsr4LiteStatus['fsrSource'], TranslationKey> = {
  'widget-cache': 'fsr4Lite.source.widget',
  downloaded: 'fsr4Lite.source.downloaded',
  imported: 'fsr4Lite.source.imported',
  missing: 'fsr4Lite.source.missing'
}

const SCALE_KEYS: Record<Fsr4RenderScale, TranslationKey> = {
  game: 'fsr4Lite.scale.game',
  native: 'fsr4Lite.scale.native',
  quality: 'fsr4Lite.scale.quality',
  balanced: 'fsr4Lite.scale.balanced',
  performance: 'fsr4Lite.scale.performance'
}

type Fsr4SettingsPartial = Partial<Pick<OrbitSettings, 'fsr4LiteEnabled' | 'fsr4LiteAutoUpdate' | 'fsr4LiteOverlayDefault' | 'fsr4LiteRenderScaleDefault'>>

export function Fsr4LiteSection({
  settings,
  onSettings
}: {
  settings: OrbitSettings | null
  onSettings: (next: OrbitSettings) => void
}): JSX.Element | null {
  const t = useT()
  const [status, setStatus] = useState<Fsr4LiteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const enabled = settings?.fsr4LiteEnabled === true
  const rawScale = settings?.fsr4LiteRenderScaleDefault
  const scale = isFsr4RenderScale(rawScale) ? rawScale : 'game'

  useEffect(() => {
    void window.api.fsr4Lite.status().then(setStatus).catch(() => setStatus(null))
  }, [])

  if (!status?.supported) return null

  const remember = (next: OrbitSettings): void => {
    onSettings(next)
    usePreferencesStore.setState({
      fsr4LiteEnabled: next.fsr4LiteEnabled === true,
      fsr4LiteAutoUpdate: next.fsr4LiteAutoUpdate !== false,
      fsr4LiteOverlayDefault: next.fsr4LiteOverlayDefault === true,
      fsr4LiteRenderScaleDefault: isFsr4RenderScale(next.fsr4LiteRenderScaleDefault) ? next.fsr4LiteRenderScaleDefault : 'game'
    })
  }

  const save = (partial: Fsr4SettingsPartial): void => {
    if (busy) return
    setBusy(true)
    void window.api.settings.set(partial)
      .then(remember)
      .catch(() => notify({ tone: 'error', titleKey: 'fsr4Lite.title', messageKey: 'fsr4Lite.saveError', force: true }))
      .finally(() => setBusy(false))
  }

  const importFiles = (): void => {
    if (busy) return
    setBusy(true)
    void window.api.fsr4Lite.importFiles()
      .then(setStatus)
      .catch((error: unknown) => {
        const code = fsr4LiteErrorCode(error)
        notify({ tone: 'error', titleKey: 'fsr4Lite.title', messageKey: fsr4LiteErrorKey(code), force: true })
      })
      .finally(() => setBusy(false))
  }

  return (
    <SettingsSection id="fsr4-lite" icon={Sparkles} title={t('fsr4Lite.title')} description={t('fsr4Lite.body')}>
      <div className="space-y-3">
        <SettingsToggle id="fsr4LiteEnabled" active={enabled} defaultInactive disabled={!settings || busy}
          title={t('fsr4Lite.enable')} description={t('fsr4Lite.body')} t={t}
          onChange={(active) => save({ fsr4LiteEnabled: active })} />
        <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('fsr4Lite.hint')}</p>
        {enabled && (
          <>
            <SettingsToggle id="fsr4LiteAutoUpdate" active={settings?.fsr4LiteAutoUpdate !== false}
              defaultActive disabled={busy} title={t('fsr4Lite.autoUpdate')}
              description={t('fsr4Lite.autoUpdateBody')} t={t}
              onChange={(active) => save({ fsr4LiteAutoUpdate: active })} />
            <SettingsToggle id="fsr4LiteOverlayDefault" active={settings?.fsr4LiteOverlayDefault === true}
              defaultInactive disabled={busy} title={t('fsr4Lite.overlay')}
              description={t('fsr4Lite.overlayBody')} t={t}
              onChange={(active) => save({ fsr4LiteOverlayDefault: active })} />
            <div>
              <p className="mb-2 text-sm font-semibold text-white/85">{t('fsr4Lite.renderScale')}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('fsr4Lite.renderScale')}>
                {FSR4_RENDER_SCALES.map((value) => (
                  <FocusableButton key={value} type="button" variant={scale === value ? 'solid' : 'ghost'}
                    data-fsr4-scale={value} aria-pressed={scale === value} disabled={busy}
                    onClick={() => save({ fsr4LiteRenderScaleDefault: value })}>
                    {t(SCALE_KEYS[value])}
                  </FocusableButton>
                ))}
              </div>
            </div>
            <div className="space-y-2 rounded-2xl border border-white/[0.07] bg-black/15 p-4 text-sm" role="status">
              <p className="text-white/80">{t(DEVICE_KEYS[status.device.support])}</p>
              {status.device.gpuNames.length > 0 ? (
                <p className="break-words text-xs text-muted">{t('fsr4Lite.device.gpus', { names: status.device.gpuNames.join(', ') })}</p>
              ) : null}
              {status.device.egpuNote ? <p className="text-xs leading-relaxed text-amber-100">{t('fsr4Lite.device.egpu')}</p> : null}
              <p className="text-xs text-muted">{t(SOURCE_KEYS[status.fsrSource])}</p>
              {status.optiBuild ? <p className="break-all text-xs text-muted">{t('fsr4Lite.optiBuild', { build: status.optiBuild })}</p> : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <FocusableButton variant="solid" disabled={busy} onClick={importFiles}>
                <span className="flex items-center gap-2">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
                  {busy ? t('fsr4Lite.importing') : t('fsr4Lite.import')}
                </span>
              </FocusableButton>
            </div>
            <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('fsr4Lite.anticheatHint')}</p>
            <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('fsr4Lite.gamePassHint')}</p>
            <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('fsr4Lite.gpl')}</p>
            <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('fsr4Lite.credits')}</p>
            <p className="max-w-3xl break-all text-xs text-white/45">{FSR4_LITE_CREDIT_URL}</p>
            <FocusableButton variant="ghost" onClick={() => void window.api.app.openExternal(FSR4_LITE_CREDIT_URL)}>
              {t('fsr4Lite.openCredit')}
            </FocusableButton>
          </>
        )}
      </div>
    </SettingsSection>
  )
}
