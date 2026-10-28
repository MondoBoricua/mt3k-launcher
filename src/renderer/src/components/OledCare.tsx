import { useEffect, useState } from 'react'
import { useAttractModeStore } from '@renderer/state/attractModeStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import {
  oledCareCoverStyle,
  oledCareSuppressUntil,
  shouldCoverWithOledCare,
  shouldSwallowOledCareWake
} from '@shared/oledCarePolicy'

/**
 * Bandera que el sondeo del mando lee sin esperar a React.
 * Si la capa está puesta, ese primer movimiento se traga.
 */
let coverActive = false

export function oledCareCoverActive(): boolean {
  return coverActive
}

function publishCover(active: boolean, setCovering: (active: boolean) => void): void {
  coverActive = active
  setCovering(active)
}

/**
 * Capa a pantalla completa, montada solo si el ajuste está encendido.
 * Reusa el reloj de la vitrina (`lastInputAt`) para que teclado, ratón
 * y mando cuenten como la misma última entrada.
 */
export function OledCare(): JSX.Element | null {
  const minutes = usePreferencesStore((s) => s.oledCareIdleMinutes)
  const mode = usePreferencesStore((s) => s.oledCareMode)
  const touch = useAttractModeStore((s) => s.touch)
  const [covering, setCovering] = useState(false)
  const [launchPhase, setLaunchPhase] = useState('idle')

  useEffect(() => {
    let cancelled = false
    // El evento no repite la fase actual: si ya hay un juego, hay que leerla.
    void window.api.game.getLaunchStatus().then((status) => {
      if (!cancelled && status?.phase) setLaunchPhase(status.phase)
    }).catch((error) => {
      console.warn('[oled-care] No se pudo leer la fase de lanzamiento', error)
    })
    const unsubscribe = window.api.game.onLaunchStatus((status) => {
      setLaunchPhase(status.phase)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    // Al encender el ajuste el reloj empieza ahora; si no, una sesión
    // vieja cubriría la ventana en el primer chequeo.
    touch()
    return () => {
      coverActive = false
      touch()
    }
  }, [touch])

  useEffect(() => {
    return useAttractModeStore.subscribe((state, previous) => {
      if (state.lastInputAt !== previous.lastInputAt && coverActive) {
        coverActive = false
        setCovering(false)
      }
    })
  }, [])

  useEffect(() => {
    let suppressUntil = 0
    const wakingKeys = new Set<string>()
    const input = (event: Event): void => {
      const wasCover = coverActive
      const heldWakeKey = event instanceof KeyboardEvent && wakingKeys.has(event.code || event.key)
      const now = Date.now()
      if (shouldSwallowOledCareWake({
        coverActive: wasCover,
        heldWakeKey,
        now,
        suppressUntil
      })) {
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
      }
      if (wasCover) {
        suppressUntil = oledCareSuppressUntil(now, true, suppressUntil)
        if (event instanceof KeyboardEvent) wakingKeys.add(event.code || event.key)
      }
      if (event instanceof KeyboardEvent && event.type === 'keyup') wakingKeys.delete(event.code || event.key)
      touch()
    }
    const reset = (): void => touch()
    const events = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'pointermove', 'wheel', 'touchstart']
    for (const event of events) window.addEventListener(event, input, { capture: true, passive: false })
    window.addEventListener('blur', reset)
    window.addEventListener('focus', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      for (const event of events) window.removeEventListener(event, input, true)
      window.removeEventListener('blur', reset)
      window.removeEventListener('focus', reset)
      document.removeEventListener('visibilitychange', reset)
      touch()
    }
  }, [touch])

  useEffect(() => {
    const check = (): void => {
      const idleMs = Date.now() - useAttractModeStore.getState().lastInputAt
      const allowed = shouldCoverWithOledCare({
        enabled: true,
        launchPhase,
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        minimized: document.hidden,
        idleMs,
        idleMinutes: minutes
      })
      if (!allowed) {
        // Fuera de la ventana útil se reinicia el reloj, igual que la vitrina,
        // para que al volver no aparezca la capa de golpe.
        if (
          launchPhase !== 'idle' ||
          document.hidden ||
          !document.hasFocus() ||
          document.visibilityState !== 'visible'
        ) {
          touch()
        }
        if (coverActive) publishCover(false, setCovering)
        return
      }
      publishCover(true, setCovering)
    }
    check()
    const timer = window.setInterval(check, 500)
    return () => window.clearInterval(timer)
  }, [launchPhase, minutes, touch])

  if (!covering) return null
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const style = oledCareCoverStyle(mode, reducedMotion)
  return (
    <div
      data-oled-care={mode}
      aria-hidden="true"
      className="fixed inset-0 z-[260]"
      style={style}
    />
  )
}
