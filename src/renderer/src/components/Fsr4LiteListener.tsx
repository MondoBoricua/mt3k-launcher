/**
 * Un aviso por sesión, solo si el estado de FSR 4.1 Lite cambió.
 * Se monta cuando el interruptor está prendido.
 */
import { useEffect } from 'react'
import type { TranslationKey } from '@renderer/i18n/translations'
import { notify } from '@renderer/state/notificationStore'

const TOAST: Record<'active' | 'not-lite' | 'not-loaded' | 'unknown', TranslationKey> = {
  active: 'fsr4Lite.toast.active',
  'not-lite': 'fsr4Lite.toast.notLite',
  'not-loaded': 'fsr4Lite.toast.notLoaded',
  unknown: 'fsr4Lite.toast.unknown'
}

export function Fsr4LiteListener(): null {
  useEffect(() => window.api.fsr4Lite.onEvent((event) => {
    if (event.kind === 'repair') {
      notify({
        tone: 'error',
        titleKey: 'fsr4Lite.title',
        messageKey: 'fsr4Lite.toast.repair',
        force: true,
        replace: true
      })
      return
    }
    if (event.kind !== 'session') return
    notify({
      tone: event.status === 'active' ? 'success' : 'info',
      titleKey: 'fsr4Lite.title',
      messageKey: TOAST[event.status],
      vars: { resolution: event.resolution ?? '' },
      force: true,
      replace: true
    })
  }), [])
  return null
}
