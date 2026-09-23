import { useEffect, useState } from 'react'
import { Archive, FolderOpen, RotateCcw } from 'lucide-react'
import type { SaveBackupDirectoryStatus } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import { notify } from '@renderer/state/notificationStore'
import { FocusableButton } from '@renderer/components/FocusableButton'
import { SettingsSection } from './SettingsSection'

export function SaveBackupDirectorySection(): JSX.Element {
  const t = useT()
  const [status, setStatus] = useState<SaveBackupDirectoryStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void window.api.settings.getSaveBackupDirectory().then(setStatus).catch(() => setStatus(null))
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleChoose = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const next = await window.api.settings.chooseSaveBackupDirectory()
      if (next) setStatus(next)
    } catch {
      notify({
        tone: 'error',
        titleKey: 'settings.saveBackups.errorTitle',
        messageKey: 'settings.saveBackups.errorBody',
        force: true
      })
    } finally {
      setBusy(false)
    }
  }

  const handleUseDefault = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const next = await window.api.settings.useDefaultSaveBackupDirectory()
      setStatus(next)
    } catch {
      notify({
        tone: 'error',
        titleKey: 'settings.saveBackups.errorTitle',
        messageKey: 'settings.saveBackups.errorBody',
        force: true
      })
    } finally {
      setBusy(false)
    }
  }

  const folderLabel =
    status?.isDefault === false && status.configuredPath
      ? status.configuredPath
      : status?.effectivePath ?? t('settings.saveBackups.defaultLabel')

  return (
    <SettingsSection
      id="save-backups"
      icon={Archive}
      title={t('settings.saveBackups.title')}
      description={t('settings.section.saveBackupsBody')}
    >
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('settings.saveBackups.hint')}</p>
      <p className="mt-3 break-all text-sm text-white/80">
        <span className="text-white/45">{t('settings.saveBackups.current')}: </span>
        {folderLabel}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <FocusableButton variant="solid" disabled={busy} onClick={() => void handleChoose()}>
          <span className="flex items-center gap-2">
            <FolderOpen size={16} />
            {busy ? t('settings.saveBackups.busy') : t('settings.saveBackups.choose')}
          </span>
        </FocusableButton>
        {!status?.isDefault ? (
          <FocusableButton variant="ghost" disabled={busy} onClick={() => void handleUseDefault()}>
            <span className="flex items-center gap-2">
              <RotateCcw size={16} />
              {t('settings.saveBackups.useDefault')}
            </span>
          </FocusableButton>
        ) : null}
      </div>
    </SettingsSection>
  )
}
