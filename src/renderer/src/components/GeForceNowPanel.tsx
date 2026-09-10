import { useEffect, useRef, useState } from 'react'
import {
  CircleAlert,
  CloudLightning,
  ExternalLink,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { GEFORCE_NOW_APPLICATION_ID } from '@shared/geforceNow'
import type { GeForceNowLaunchMode } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'
import { useGeForceNowStore } from '@renderer/state/geForceNowStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import { focusElement } from '@renderer/lib/spatialNavigation'

interface Props {
  matchCount: number
}

export function GeForceNowPanel({ matchCount }: Props): JSX.Element {
  const t = useT()
  const snapshot = useGeForceNowStore((state) => state.snapshot)
  const refreshing = useGeForceNowStore((state) => state.isRefreshing)
  const refreshCatalog = useGeForceNowStore((state) => state.refresh)
  const [nativeAvailable, setNativeAvailable] = useState<boolean | null>(null)
  const launchMode = usePreferencesStore((state) => state.geForceNowLaunchMode)
  const modeSaving = usePreferencesStore((state) => state.geForceNowLaunchModeSaving)
  const setLaunchMode = usePreferencesStore((state) => state.setGeForceNowLaunchMode)
  const effectiveMode = nativeAvailable && launchMode === 'native' ? 'native' : 'web'
  const mounted = useRef(false)
  const webChoice = useRef<HTMLButtonElement>(null)
  const restoreModeFocus = useRef(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchFailed, setLaunchFailed] = useState(false)

  useEffect(() => {
    let active = true
    let generation = 0
    mounted.current = true
    const applyAvailability = (available: boolean): void => {
      if (!available && document.activeElement?.matches('[data-geforce-now-native-open], [data-geforce-now-mode="native"]')) {
        restoreModeFocus.current = true
      }
      setNativeAvailable(available)
    }
    const checkInstalled = (): void => {
      const request = ++generation
      void window.api.geforceNow.isNativeAvailable()
        .then((available) => {
          if (active && request === generation) applyAvailability(available)
        })
        .catch(() => {
          if (active && request === generation) applyAvailability(false)
        })
    }
    checkInstalled()
    window.addEventListener('focus', checkInstalled)
    return () => {
      active = false
      mounted.current = false
      window.removeEventListener('focus', checkInstalled)
    }
  }, [])

  useEffect(() => {
    if (nativeAvailable === false && restoreModeFocus.current) {
      restoreModeFocus.current = false
      focusElement(webChoice.current)
    }
  }, [nativeAvailable])

  const changeLaunchMode = async (mode: GeForceNowLaunchMode): Promise<void> => {
    if (modeSaving || (mode === 'native' && !nativeAvailable)) return
    setSaveFailed(false)
    try {
      await setLaunchMode(mode)
    } catch {
      if (mounted.current) setSaveFailed(true)
    }
  }

  const launchGeForceNow = async (): Promise<void> => {
    if (!nativeAvailable || launching) return
    setLaunching(true)
    setLaunchFailed(false)
    try {
      await window.api.applications.launch(GEFORCE_NOW_APPLICATION_ID)
    } catch {
      if (mounted.current) setLaunchFailed(true)
    } finally {
      if (mounted.current) setLaunching(false)
    }
  }

  const catalogUnavailable = snapshot.state === 'error'
  const catalogStale = snapshot.state === 'stale'

  return (
    <section
      aria-busy={launching || refreshing || modeSaving || snapshot.state === 'loading'}
      data-geforce-now-panel
      data-geforce-now-native-launcher={nativeAvailable ? 'true' : undefined}
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
          <div role="group" aria-label={t('library.geforceNow.mode.label')}
            className="flex max-w-full flex-wrap items-center gap-1 rounded-full border border-white/15 bg-black/20 p-1">
            {(['web', 'native'] as const).map((mode) => {
              const unavailable = mode === 'native' && !nativeAvailable
              return <button
                key={mode}
                ref={mode === 'web' ? webChoice : undefined}
                data-focusable
                data-view-entry={mode === 'web' ? 'true' : undefined}
                data-geforce-now-mode={mode}
                type="button"
                aria-pressed={effectiveMode === mode}
                disabled={unavailable}
                aria-disabled={unavailable || modeSaving}
                data-disabled={unavailable || modeSaving ? 'true' : undefined}
                title={unavailable ? t(nativeAvailable === null ? 'library.geforceNow.mode.checking' : 'library.geforceNow.mode.unavailable') : undefined}
                onClick={() => void changeLaunchMode(mode)}
                className={`flex min-h-9 items-center justify-center rounded-full px-3 py-1.5 text-xs font-bold leading-snug transition-colors disabled:opacity-40 ${effectiveMode === mode ? 'bg-white/15 text-white' : 'text-muted hover:bg-white/5'}`}
              >{t(mode === 'web' ? 'library.geforceNow.mode.web' : 'library.geforceNow.mode.native')}</button>
            })}
          </div>
          {nativeAvailable && effectiveMode === 'native' && <button
            data-focusable
            data-geforce-now-native-open
            type="button"
            disabled={launching}
            data-disabled={launching ? 'true' : undefined}
            onClick={() => void launchGeForceNow()}
            aria-label={t(launching ? 'library.geforceNow.web.launching' : 'library.geforceNow.web.launch')}
            title={t('library.geforceNow.web.launch')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/75 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-55"
          >
            {launching ? (
              <Loader2 aria-hidden="true" size={18} className="shrink-0 animate-spin" />
            ) : <ExternalLink aria-hidden="true" size={18} />}
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

      {nativeAvailable === false && (
        <p role="status" className="mt-2 text-xs leading-relaxed text-muted">
          {t('library.geforceNow.mode.unavailable')}
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-rose-200">{t('settings.saveFailed')}</p>
      )}
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
