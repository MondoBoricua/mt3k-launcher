import { useEffect } from 'react'
import type { LaunchProfile } from '@shared/launchProfilePolicy'
import { languageLocale } from '@shared/language'
import { useT } from '@renderer/i18n/useT'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useLaunchProfileStore } from '@renderer/state/launchProfileStore'
import { FocusableButton } from './FocusableButton'

export function LaunchProfileEditor({ gameId }: { gameId: string }): JSX.Element {
  const t = useT()
  const language = usePreferencesStore((s) => s.language)
  const { display, entry, editingMode, selection, busy, error, load, editMode, cycle, save } = useLaunchProfileStore()
  useEffect(() => { void load(gameId) }, [gameId, load])
  const format = (p: LaunchProfile): string => t('launchProfiles.resolution', {
    width: p.width.toLocaleString(languageLocale(language)), height: p.height.toLocaleString(languageLocale(language)),
    hz: p.refreshHz.toLocaleString(languageLocale(language))
  })
  const current = display?.mode === editingMode
  const selected = display?.modes[selection]
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4" data-launch-profile-editor>
      <h3 className="text-base font-semibold text-white/90">{t('launchProfiles.title')}</h3>
      <p className="text-sm text-muted">{t('launchProfiles.editorHint')}</p>
      {display && <p className="text-sm">{t('launchProfiles.current', { mode: t(`launchProfiles.${display.mode}`) })}</p>}
      <div className="flex flex-wrap gap-2">
        {(['handheld', 'docked'] as const).map((mode) => (
          <FocusableButton key={mode} type="button" variant={editingMode === mode ? 'solid' : 'ghost'} aria-pressed={editingMode === mode} disabled={busy} onClick={() => editMode(mode)}>{t(`launchProfiles.${mode}`)}</FocusableButton>
        ))}
        <FocusableButton type="button" variant="ghost" disabled={busy} onClick={() => void load(gameId)}>{t('launchProfiles.refresh')}</FocusableButton>
      </div>
      <p className="text-sm" role="status">{t('launchProfiles.saved', { profile: entry[editingMode] ? format(entry[editingMode]!) : t('launchProfiles.none') })}</p>
      {busy && <p role="status">{t('launchProfiles.loading')}</p>}
      {error && <p role="alert" className="text-red-300">{t('launchProfiles.error')}</p>}
      {display && !display.supported && <p className="text-sm text-muted">{t('launchProfiles.unavailable')}</p>}
      {display?.supported && !current && <p className="text-sm text-muted">{t('launchProfiles.connect')}</p>}
      {display?.supported && current && (
        <div className="space-y-3">
          <p className="text-sm tabular-nums" aria-live="polite">{selected ? format(selected) : t('launchProfiles.none')}</p>
          <div className="flex flex-wrap gap-3">
            <FocusableButton type="button" className="px-4 disabled:opacity-40" variant="ghost" disabled={busy || !selected} onClick={() => cycle(-1)}>{t('launchProfiles.previous')}</FocusableButton>
            <FocusableButton type="button" className="px-4 disabled:opacity-40" variant="ghost" disabled={busy || !selected} onClick={() => cycle(1)}>{t('launchProfiles.next')}</FocusableButton>
          </div>
          <FocusableButton type="button" disabled={busy || !selected} onClick={() => selected && void save(selected)}>{t('launchProfiles.save')}</FocusableButton>
        </div>
      )}
      <p className="text-xs text-muted">{t('launchProfiles.hdrUnavailable')}</p>
      <FocusableButton type="button" variant="ghost" disabled={busy || !entry[editingMode]} onClick={() => void save(null)}>{t('launchProfiles.clear')}</FocusableButton>
    </div>
  )
}
