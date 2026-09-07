import { languageLocale } from '@shared/language'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { useEffect, useState } from 'react'
import { AppUpdateStatusChip } from './AppUpdateStatusChip'
import { SyncStatusIndicator } from './SyncStatusIndicator'

function currentClock(language: string): string {
  return new Date().toLocaleTimeString(languageLocale(language), { hour: '2-digit', minute: '2-digit' })
}

export function BottomStatusHud(): JSX.Element {
  const language = usePreferencesStore((s) => s.language)
  const [clock, setClock] = useState(() => currentClock(language))

  useEffect(() => {
    setClock(currentClock(language))
    const id = window.setInterval(() => setClock(currentClock(language)), 15_000)
    return () => window.clearInterval(id)
  }, [language])

  return (
    <aside className="absolute bottom-3 left-4 z-30 flex items-center gap-2 text-sm text-muted xl:bottom-4 xl:left-8">
      <SyncStatusIndicator />
      <AppUpdateStatusChip />
      <span className="rounded-full border border-white/[0.06] bg-black/20 px-3 py-1.5 font-medium tabular-nums text-text/65 shadow-[0_8px_24px_rgba(0,0,0,0.16)] backdrop-blur-xl">
        {clock}
      </span>
    </aside>
  )
}
