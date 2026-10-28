import { useState } from 'react'
import { MonitorOff } from 'lucide-react'
import { OLED_CARE_IDLE_MINUTES, OLED_CARE_MODES } from '@shared/oledCarePolicy'
import type { OrbitSettings } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'

/**
 * Último tema de Experiencia. Apagado no muestra opciones;
 * encendido deja escoger los minutos y si la capa es negra o tenue.
 */
export function OledCareSection(): JSX.Element {
  const t = useT()
  const enabled = usePreferencesStore((s) => s.oledCareEnabled)
  const minutes = usePreferencesStore((s) => s.oledCareIdleMinutes)
  const mode = usePreferencesStore((s) => s.oledCareMode)
  const save = usePreferencesStore((s) => s.setOledCareSettings)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const update = async (
    partial: Partial<Pick<OrbitSettings, 'oledCareEnabled' | 'oledCareIdleMinutes' | 'oledCareMode'>>
  ): Promise<void> => {
    setSaving(true)
    setFailed(false)
    try {
      await save(partial)
    } catch (error) {
      console.warn('[oled-care] No se pudieron guardar los ajustes', error)
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection
      id="oled-care"
      icon={MonitorOff}
      title={t('oledCare.title')}
      description={t('oledCare.body')}
    >
      {failed && (
        <p role="alert" className="mb-3 text-sm text-amber-200">
          {t('oledCare.saveError')}
        </p>
      )}
      <SettingsToggle
        id="oledCareEnabled"
        active={enabled}
        title={t('oledCare.enable')}
        description={t('oledCare.body')}
        defaultInactive
        disabled={saving}
        onChange={(active) => void update({ oledCareEnabled: active })}
        t={t}
      />
      {enabled && (
        <div className="mt-4 space-y-4" data-oled-care-options>
          <div>
            <p className="mb-2 text-sm text-white/70">{t('oledCare.delay')}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('oledCare.delay')} data-oled-care-idle>
              {OLED_CARE_IDLE_MINUTES.map((option) => (
                <FocusableButton
                  variant="ghost"
                  key={option}
                  data-oled-care-minutes={option}
                  disabled={saving}
                  aria-pressed={minutes === option}
                  className={`rounded-full border px-5 py-3 text-sm data-[focused=true]:ring-2 data-[focused=true]:ring-accent ${
                    minutes === option ? '!border-accent !bg-accent/20 !text-white' : 'border-white/10 text-muted'
                  }`}
                  onClick={() => void update({ oledCareIdleMinutes: option })}
                >
                  {option === 1 ? t('oledCare.minute') : t('oledCare.minutes', { minutes: option })}
                </FocusableButton>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-white/70">{t('oledCare.mode')}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('oledCare.mode')} data-oled-care-mode>
              {OLED_CARE_MODES.map((option) => (
                <FocusableButton
                  variant="ghost"
                  key={option}
                  data-oled-care-mode-value={option}
                  disabled={saving}
                  aria-pressed={mode === option}
                  className={`rounded-full border px-5 py-3 text-sm data-[focused=true]:ring-2 data-[focused=true]:ring-accent ${
                    mode === option ? '!border-accent !bg-accent/20 !text-white' : 'border-white/10 text-muted'
                  }`}
                  onClick={() => void update({ oledCareMode: option })}
                >
                  {t(option === 'black' ? 'oledCare.modeBlack' : 'oledCare.modeDim')}
                </FocusableButton>
              ))}
            </div>
          </div>
          <p className="max-w-3xl text-xs leading-relaxed text-muted">{t('oledCare.hint')}</p>
        </div>
      )}
    </SettingsSection>
  )
}
