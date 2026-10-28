import { useEffect, useRef, useState } from 'react'
import { useAttractModeStore } from '@renderer/state/attractModeStore'
import { useGameDetailStore } from '@renderer/state/gameDetailStore'
import { usePreferencesStore } from '@renderer/state/preferencesStore'
import {
  OLED_CARE_DIALOG_SELECTOR,
  OLED_CARE_LAUNCH_PHASE_PENDING,
  oledCareCoverStyle,
  oledCareDialogIsOpen,
  shouldCoverWithOledCare,
  shouldResetOledCareIdle,
  shouldSwallowOledCareSurfaceInput
} from '@shared/oledCarePolicy'

/**
 * Publica la capa en el store (el mando lee `oledCover` desde ahí) y en
 * React. Al prenderla apaga la vitrina en el mismo instante, sin esperar
 * el próximo chequeo de 500 ms.
 */
function publishCover(active: boolean, setCovering: (active: boolean) => void): void {
  const current = useAttractModeStore.getState()
  if (current.oledCover !== active || (active && current.active)) {
    useAttractModeStore.setState(active ? { oledCover: true, active: false } : { oledCover: false })
  }
  setCovering(active)
}

/** Misma sonda que la vitrina: ficha de juego abierta, o un modal marcado. */
function launcherDialogOpen(): boolean {
  return oledCareDialogIsOpen(
    !!useGameDetailStore.getState().gameId,
    !!document.querySelector(OLED_CARE_DIALOG_SELECTOR)
  )
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
  // Centinela hasta la primera lectura buena. MainShell usa el mismo IPC
  // (`getLaunchStatus` + `onLaunchStatus`) pero arranca en `idle`; aquí no,
  // porque un juego ya corriendo no puede cubrirse en el primer sondeo.
  const [launchPhase, setLaunchPhase] = useState(OLED_CARE_LAUNCH_PHASE_PENDING)
  const coverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const applyPhase = (status: { phase?: string } | null | undefined): void => {
      if (cancelled) return
      if (typeof status?.phase === 'string' && status.phase.length > 0) setLaunchPhase(status.phase)
    }
    // El evento no repite la fase actual: si ya hay un juego, hay que leerla.
    void window.api.game.getLaunchStatus().then(applyPhase).catch((error) => {
      console.warn('[oled-care] No se pudo leer la fase de lanzamiento', error)
    })
    const unsubscribe = window.api.game.onLaunchStatus((status) => {
      applyPhase(status)
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
      useAttractModeStore.setState({ oledCover: false, inputSuppressUntil: 0 })
      touch()
    }
  }, [touch])

  useEffect(() => {
    return useAttractModeStore.subscribe((state, previous) => {
      // `touch()` ya apagó la capa en el store (mando, tecla o puntero).
      // Aquí solo se entera React para desmontar el nodo.
      if (previous.oledCover && !state.oledCover) setCovering(false)
    })
  }, [])

  useEffect(() => {
    const wakingKeys = new Set<string>()
    const input = (event: Event): void => {
      const store = useAttractModeStore.getState()
      const wasCover = store.oledCover
      const dialogOpen = launcherDialogOpen()
      const heldWakeKey = event instanceof KeyboardEvent && wakingKeys.has(event.code || event.key)
      const now = Date.now()
      const eventHitsCover = event.target instanceof Element
        && event.target.closest('[data-oled-care]') !== null
      if (shouldSwallowOledCareSurfaceInput({
        dialogOpen,
        coverActive: wasCover,
        heldWakeKey,
        now,
        suppressUntil: store.inputSuppressUntil,
        eventHitsCover,
        kind: event instanceof KeyboardEvent ? 'keyboard' : 'pointer'
      })) {
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
      }
      // La tecla que despertó se recuerda para no repetirla contra la UI.
      // La ventana de tiempo la arma `touch()` en el store, igual si el
      // despertar vino del mando.
      if (wasCover && !dialogOpen && event instanceof KeyboardEvent) {
        wakingKeys.add(event.code || event.key)
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
    const node = coverRef.current
    if (!node) return
    // El trago del puntero vive en la capa. Un modal con z más alto nunca
    // dispara estos listeners: el hit-test no pasa por este nodo.
    const swallowHit = (event: Event): void => {
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
    }
    const names = ['pointerdown', 'pointerup', 'click', 'wheel', 'touchstart'] as const
    for (const name of names) node.addEventListener(name, swallowHit)
    return () => {
      for (const name of names) node.removeEventListener(name, swallowHit)
    }
  }, [covering, mode])

  useEffect(() => {
    const check = (): void => {
      const dialogOpen = launcherDialogOpen()
      const idleMs = Date.now() - useAttractModeStore.getState().lastInputAt
      const allowed = shouldCoverWithOledCare({
        enabled: true,
        launchPhase,
        dialogOpen,
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        minimized: document.hidden,
        idleMs,
        idleMinutes: minutes
      })
      if (shouldResetOledCareIdle({
        dialogOpen,
        launchPhase,
        hidden: document.hidden,
        focused: document.hasFocus(),
        visible: document.visibilityState === 'visible'
      })) {
        // Fuera de la ventana útil, o con un diálogo abierto, se reinicia
        // el reloj aunque la vitrina no esté montada. Al volver no aparece
        // la capa de golpe.
        touch()
      }
      if (!allowed) {
        if (useAttractModeStore.getState().oledCover) publishCover(false, setCovering)
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
      ref={coverRef}
      data-oled-care={mode}
      aria-hidden="true"
      className="fixed inset-0 z-[260]"
      style={style}
    />
  )
}
