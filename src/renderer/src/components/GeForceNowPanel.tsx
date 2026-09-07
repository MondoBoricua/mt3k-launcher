import { useEffect, useState } from 'react'
import {
  CircleAlert,
  CloudLightning,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { GEFORCE_NOW_APPLICATION_ID } from '@shared/geforceNow'
import type { OrbitApplication } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import { useGeForceNowStore } from '@renderer/state/geForceNowStore'

interface Props {
  matchCount: number
}

export function GeForceNowPanel({ matchCount }: Props): JSX.Element {
  const t = useT()
  const snapshot = useGeForceNowStore((state) => state.snapshot)
  const refreshing = useGeForceNowStore((state) => state.isRefreshing)
  const refreshCatalog = useGeForceNowStore((state) => state.refresh)
  const [nativeApplication, setNativeApplication] = useState<OrbitApplication | null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchFailed, setLaunchFailed] = useState(false)

  useEffect(() => {
    let active = true
    void window.api.applications
      .get()
      .then((applicationSnapshot) => {
        if (!active) return
        const installed = applicationSnapshot.applications.find(
          (application) =>
            application.id === GEFORCE_NOW_APPLICATION_ID &&
            application.target === 'native' &&
            application.available
        )
        setNativeApplication(installed ?? null)
      })
      .catch(() => {
        if (active) setNativeApplication(null)
      })
    return () => {
      active = false
    }
  }, [])

  const launchGeForceNow = async (): Promise<void> => {
    if (!nativeApplication || launching) return
    setLaunching(true)
    setLaunchFailed(false)
    try {
      await window.api.applications.launch(nativeApplication.id)
    } catch {
      setLaunchFailed(true)
    } finally {
      setLaunching(false)
    }
  }

  const catalogUnavailable = snapshot.state === 'error'
  const catalogStale = snapshot.state === 'stale'

  return (
    <section
      aria-busy={launching || refreshing || snapshot.state === 'loading'}
      data-geforce-now-panel
      data-geforce-now-native-launcher={nativeApplication ? 'true' : undefined}
      className="min-w-0 shrink-0 rounded-xl border border-white/10 bg-surface/60 px-3 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <CloudLightning aria-hidden="true" size={20} className="shrink-0 text-[#b7f16f]" />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-sm font-bold leading-snug text-white">GeForce NOW</h1>
            <p className="text-xs leading-snug text-muted">
              {t('library.geforceNow.catalog.matches', { count: matchCount })}
            </p>
          </div>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          {nativeApplication && <button
            data-focusable
            data-view-entry="true"
            type="button"
            disabled={launching}
            data-disabled={launching ? 'true' : undefined}
            onClick={() => void launchGeForceNow()}
            aria-label={t(launching ? 'library.geforceNow.web.launching' : 'library.geforceNow.web.launch')}
            className="flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold leading-snug text-white transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-55"
          >
            {launching ? (
              <Loader2 aria-hidden="true" size={18} className="shrink-0 animate-spin" />
            ) : null}
            {t('library.geforceNow.native.open')}
          </button>}
          <button
            data-focusable
            data-geforce-now-refresh
            type="button"
            disabled={refreshing}
            data-disabled={refreshing ? 'true' : undefined}
            onClick={() => void refreshCatalog()}
            aria-label={t('library.geforceNow.catalog.refresh')}
            title={t('library.geforceNow.catalog.refresh')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/75 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" size={18} className={refreshing ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>

      {(catalogUnavailable || catalogStale) && (
        <p role="status" className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-amber-100/80">
          <CircleAlert aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
          {t(catalogUnavailable ? 'library.geforceNow.catalog.unavailable' : 'library.geforceNow.catalog.stale')}
        </p>
      )}
      {launchFailed && (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-rose-200">
          {t('library.geforceNow.web.launchFailed')}
        </p>
      )}
    </section>
  )
}
