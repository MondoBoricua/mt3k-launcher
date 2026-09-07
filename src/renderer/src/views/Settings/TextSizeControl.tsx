import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { useT } from '@renderer/i18n/useT'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { flushTextScaleSave } from '@renderer/lib/textScalePreference'
import { TEXT_SCALE_DEFAULT, TEXT_SCALE_MIN, TEXT_SCALE_MAX } from '@shared/textScale'

export function TextSizeControl(): JSX.Element {
  const t = useT()
  const scale = usePreferencesStore((state) => state.textScale)
  const saveState = usePreferencesStore((state) => state.textScaleSaveState)
  const setScale = usePreferencesStore((state) => state.setTextScale)
  const change = (value: number): void => { void setScale(value).catch(() => {}) }

  useEffect(() => () => { void flushTextScaleSave() }, [])

  return (
    <div className="space-y-5" data-text-size-control>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="settings-text-scale" className="text-sm font-semibold text-white/85">
          {t('settings.textSize.label')}
        </label>
        <output htmlFor="settings-text-scale" className="text-xl font-bold tabular-nums text-accent">
          {scale}%
        </output>
      </div>
      <input
        id="settings-text-scale"
        data-focusable
        type="range"
        min={TEXT_SCALE_MIN}
        max={TEXT_SCALE_MAX}
        step={1}
        value={scale}
        aria-valuetext={`${scale}%`}
        aria-describedby="settings-text-scale-hint"
        onChange={(event) => change(Number(event.currentTarget.value))}
        onBlur={() => { void flushTextScaleSave() }}
        onPointerUp={() => { void flushTextScaleSave() }}
        className="text-scale-slider block h-10 w-full cursor-pointer rounded-xl accent-accent"
      />
      <div className="flex justify-between gap-3 text-xs text-muted">
        <span>{t('settings.textSize.standard')} · {TEXT_SCALE_MIN}%</span>
        <span>{TEXT_SCALE_MAX}%</span>
      </div>
      <p id="settings-text-scale-hint" className="text-xs leading-relaxed text-muted">
        {t('settings.textSize.hint')}
      </p>
      <div className="space-y-2 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <p className="text-base font-semibold text-white/90">{t('settings.textSize.previewTitle')}</p>
        <p className="text-sm leading-relaxed text-white/70">{t('settings.textSize.previewBody')}</p>
        <p className="text-[11px] leading-relaxed text-muted">{t('settings.textSize.previewSmall')}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FocusableButton
          data-text-scale-reset
          variant="ghost"
          onClick={() => change(TEXT_SCALE_DEFAULT)}
        >
          <span className="flex items-center gap-2"><RotateCcw size={15} />{t('settings.textSize.reset')}</span>
        </FocusableButton>
        <span role="status" className="text-xs text-muted">
          {t(saveState === 'saving' ? 'settings.textSize.saving' : saveState === 'error' ? 'settings.textSize.error' : 'settings.textSize.saved')}
        </span>
        {saveState === 'error' && (
          <FocusableButton data-text-scale-retry onClick={() => change(scale)}>{t('settings.textSize.retry')}</FocusableButton>
        )}
      </div>
    </div>
  )
}
