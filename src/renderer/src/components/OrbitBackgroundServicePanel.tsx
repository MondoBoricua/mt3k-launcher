import { useEffect, useState } from 'react'
import { Check, Loader2, Monitor } from 'lucide-react'
import type { OrbitBackgroundServiceStatus } from '@shared/ipc'
import { useT } from '@renderer/i18n/useT'

export function OrbitBackgroundServicePanel(): JSX.Element {
  const t = useT()
  const [background, setBackground] = useState(true)
  const [startup, setStartup] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<OrbitBackgroundServiceStatus>()
  useEffect(() => {
    let alive = true
    const refreshStatus = (): void => {
      if (document.hidden) return
      void window.api.backgroundService.getStatus()
        .then((next) => { if (alive) setStatus(next) })
        .catch(() => { /* Keep the last known status during a transient IPC failure. */ })
    }
    const refreshTimer = window.setInterval(refreshStatus, 5000)
    window.addEventListener('focus', refreshStatus)
    const off = window.api.backgroundService.onStatus((next) => { if (alive) setStatus(next) })
    void Promise.all([window.api.settings.get(), window.api.backgroundService.getStatus()])
      .then(([settings, current]) => {
        if (!alive) return
        setBackground(settings.backgroundModeEnabled !== false)
        setStartup(current.startWithWindows ?? settings.startWithWindows === true)
        setStatus(current)
      }).catch((failure) => { if (alive) setError(String(failure)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => {
      alive = false; off()
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', refreshStatus)
    }
  }, [])
  const save = async (key: 'backgroundModeEnabled' | 'startWithWindows', value: boolean): Promise<void> => {
    setBusy(true); setError('')
    try {
      const next = await window.api.settings.set({ [key]: value })
      setBackground(next.backgroundModeEnabled !== false)
      setStartup(next.startWithWindows === true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-3">
    <p className="px-1 text-xs leading-relaxed text-white/50">{t('settings.backgroundMode.body')}</p>
    {([
      ['backgroundModeEnabled', background, 'settings.backgroundMode.keep', 'settings.backgroundMode.keepBody'],
      ['startWithWindows', startup, 'settings.backgroundMode.startup', 'settings.backgroundMode.startupBody']
    ] as const).filter(([key]) => key !== 'startWithWindows' || status?.startsThroughXboxMode !== true)
      .map(([key, checked, label, body]) => <div key={key} className="flex items-center justify-between gap-5 rounded-2xl border border-white/[0.07] bg-black/25 p-4">
      <div className="flex items-start gap-3"><Monitor size={19} className="mt-1 shrink-0 text-accent" />
        <div><h3 className="text-sm font-bold text-white/85">{t(label)}</h3>
          <p className="mt-1 text-xs leading-relaxed text-white/45">{t(body)}</p></div></div>
      <button data-focusable type="button" role="switch" aria-label={t(label)} aria-checked={checked}
        disabled={loading || busy || status?.backgroundModeAvailable === false} onClick={() => void save(key, !checked)}
        className={'flex min-w-28 shrink-0 items-center justify-between gap-3 rounded-full px-4 py-3 text-xs font-bold disabled:opacity-40 ' + (checked ? 'bg-accent text-black' : 'bg-white/10 text-white/60')}>
        {t(checked ? 'settings.hardwareControl.on' : 'settings.hardwareControl.off')}
        {loading || busy ? <Loader2 size={14} className="animate-spin" /> : checked ? <Check size={14} /> : <span className="h-3 w-3 rounded-full border border-white/25" />}
      </button>
    </div>)}
    {(error || status?.detail) && <p role="alert" className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs text-amber-200">{error || status?.detail}</p>}
    {status?.backgroundModeAvailable === false && <p className="text-xs text-white/50">{t('settings.backgroundService.status.unsupportedPackage')}</p>}
    {status?.lastActivationResult === 'failed' && <p role="status" className="p-3 text-xs text-amber-200">{t('settings.backgroundMode.focusFailed')}</p>}
  </div>
}
