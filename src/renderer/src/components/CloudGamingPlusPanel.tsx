import { CloudLightning, Sparkles } from 'lucide-react'
import { useT } from '@renderer/i18n/useT'
import { openOrbitPlusSettings } from '@renderer/state/orbitPlusStore'

export function CloudGamingPlusPanel(): JSX.Element {
  const t = useT()
  return (
    <section data-cloud-gaming-locked className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-surface/60 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <CloudLightning aria-hidden="true" size={20} className="shrink-0 text-muted" />
        <h1 className="text-sm font-bold leading-snug text-white">GeForce NOW</h1>
      </div>
      <button data-focusable data-view-entry="true" data-cloud-gaming-unlock type="button"
        aria-label={t('library.geforceNow.plus.unlock')}
        onClick={openOrbitPlusSettings}
        className="flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/10 px-4 py-2 text-sm font-bold leading-snug text-amber-200 transition-colors hover:bg-amber-200/15">
        <Sparkles aria-hidden="true" size={14} className="shrink-0" />{t('library.geforceNow.plus.unlockShort')}
      </button>
    </section>
  )
}
