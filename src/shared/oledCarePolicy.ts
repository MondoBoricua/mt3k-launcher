/**
 * Decisión pura del cuidado OLED. No toca el DOM ni los ajustes:
 * el componente y el sondeo del mando solo preguntan aquí si toca
 * cubrir, qué opacidad usar y si la primera entrada se traga.
 */

export const OLED_CARE_IDLE_MINUTES = [1, 2, 3, 5, 10] as const
export const OLED_CARE_MODES = ['black', 'dim'] as const
export type OledCareMode = (typeof OLED_CARE_MODES)[number]

/** Tres minutos: bastante para ir a buscar agua, corto para no dejar el panel fijo. */
export const OLED_CARE_DEFAULT_MINUTES = 3
export const OLED_CARE_DEFAULT_MODE: OledCareMode = 'black'
/** 0.85 de negro deja la interfaz cerca de un 15 % de brillo. */
export const OLED_CARE_DIM_OPACITY = 0.85
/**
 * Ventana corta, una sola, para teclado y puntero después de cualquier
 * despertar (tecla, puntero o mando). El mando no usa este reloj: se traga
 * frame a frame hasta que sueltan el botón.
 */
export const OLED_CARE_WAKE_SUPPRESS_MS = 500
/**
 * Hasta que `getLaunchStatus` conteste, la fase no es `idle`.
 * Si arrancáramos en `idle`, un juego ya corriendo podría cubrirse en el
 * primer chequeo de 500 ms.
 */
export const OLED_CARE_LAUNCH_PHASE_PENDING = 'pending'
/**
 * Mismo marcador que la vitrina: diálogo, alertdialog o foco de modal.
 * PIN, confirmar perfil, editor de metadata y el resto usan esto.
 */
export const OLED_CARE_DIALOG_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [data-focus-scope="active"]'

export function normalizeOledCareIdleMinutes(value: unknown): number {
  return OLED_CARE_IDLE_MINUTES.includes(value as (typeof OLED_CARE_IDLE_MINUTES)[number])
    ? (value as number)
    : OLED_CARE_DEFAULT_MINUTES
}

export function normalizeOledCareMode(value: unknown): OledCareMode {
  return value === 'dim' || value === 'black' ? value : OLED_CARE_DEFAULT_MODE
}

export interface OledCareState {
  enabled: boolean
  /** Misma fase que el lanzamiento de juegos: solo 'idle' deja cubrir. */
  launchPhase: string
  /**
   * Igual que `shouldStartAttractMode`: un diálogo abierto bloquea la capa.
   * Si no, el reloj corre detrás del PIN o de confirmar un perfil.
   */
  dialogOpen: boolean
  visible: boolean
  focused: boolean
  minimized: boolean
  idleMs: number
  idleMinutes: number
}

/**
 * Cubre solo la ventana del launcher, quieta y al frente.
 * No mira la vista ni si hay juegos: el onboarding también es esa ventana.
 * Una sesión de juego, o la ventana oculta, minimizada o sin foco, no cubre.
 */
export function shouldCoverWithOledCare(state: OledCareState): boolean {
  if (!state.enabled || !state.visible || !state.focused || state.minimized) return false
  if (state.launchPhase !== 'idle') return false
  if (state.dialogOpen) return false
  if (!Number.isFinite(state.idleMs)) return false
  const threshold = normalizeOledCareIdleMinutes(state.idleMinutes) * 60_000
  return state.idleMs >= threshold
}

/**
 * El detalle de un juego cuenta como diálogo aunque el atributo de foco
 * esté en un hijo. Misma combinación que usa la vitrina.
 */
export function oledCareDialogIsOpen(gameDetailOpen: boolean, markedDialogPresent: boolean): boolean {
  return gameDetailOpen || markedDialogPresent
}

/**
 * Mientras haya diálogo, juego en marcha o la ventana no esté útil,
 * el reloj se reinicia. Así la capa no entra al cerrar el PIN, y no
 * depende de que la vitrina esté montada.
 */
export function shouldResetOledCareIdle(input: {
  dialogOpen: boolean
  launchPhase: string
  hidden: boolean
  focused: boolean
  visible: boolean
}): boolean {
  return input.dialogOpen || input.launchPhase !== 'idle' || input.hidden || !input.focused || !input.visible
}

export function oledCareLayerOpacity(mode: unknown): number {
  return normalizeOledCareMode(mode) === 'dim' ? OLED_CARE_DIM_OPACITY : 1
}

/**
 * La capa no se desvanece nunca. Con movimiento reducido o sin él,
 * aparece y se va al instante para no animar píxeles encendidos.
 */
export function oledCareCoverStyle(
  mode: unknown,
  _reducedMotion: boolean
): { background: '#000'; opacity: number; transition: 'none' } {
  return {
    background: '#000',
    opacity: oledCareLayerOpacity(mode),
    transition: 'none'
  }
}

/** Lo que el usuario ve si la vitrina y el cuidado OLED coinciden. */
export type OledCareSurface = 'oled' | 'attract' | 'launcher'

/**
 * El cuidado OLED cuenta su propio tiempo desde la última entrada
 * y, si ya cubre, tapa también el slideshow de la vitrina.
 */
export function oledCareVisibleSurface(input: {
  oledCover: boolean
  attractActive: boolean
}): OledCareSurface {
  if (input.oledCover) return 'oled'
  if (input.attractActive) return 'attract'
  return 'launcher'
}

export function shouldSwallowOledCareWake(input: {
  coverActive: boolean
  heldWakeKey: boolean
  now: number
  suppressUntil: number
}): boolean {
  return input.coverActive || input.heldWakeKey || input.now < input.suppressUntil
}

/** Hasta cuándo se ignoran repeticiones de la tecla que quitó la capa. */
export function oledCareSuppressUntil(now: number, coverWasActive: boolean, previous: number): number {
  return coverWasActive ? now + OLED_CARE_WAKE_SUPPRESS_MS : previous
}

export interface AttractUnderOledCoverPlan {
  /** La vitrina sigue montada y ciclando carátulas. */
  active: boolean
  /** Toca pasar a la siguiente carátula en este chequeo. */
  advanceSlide: boolean
}

/**
 * Con la capa puesta, la vitrina se apaga y no cambia de carátula
 * (en modo dim se vería el movimiento debajo). Al quitarse, vuelven
 * las reglas normales: arranca si el idle ya da, y solo avanza si
 * todavía no estaba activa o si ya cumplió el tiempo en pantalla.
 */
export function attractPlanUnderOledCover(input: {
  coverActive: boolean
  attractAllowed: boolean
  attractCurrentlyActive: boolean
  dwellElapsed: boolean
}): AttractUnderOledCoverPlan {
  if (input.coverActive) return { active: false, advanceSlide: false }
  if (!input.attractAllowed) return { active: false, advanceSlide: false }
  return {
    active: true,
    advanceSlide: !input.attractCurrentlyActive || input.dwellElapsed
  }
}

/**
 * Teclado y puntero comparten la decisión de tragar. Un diálogo abierto
 * gana siempre: aunque la bandera de la capa siga en true por un chequeo,
 * el clic o la tecla van al modal. El puntero solo se traga si cayó en la
 * capa, o si sigue la ventana corta de un despertar y no hay modal.
 */
export function shouldSwallowOledCareSurfaceInput(input: {
  dialogOpen: boolean
  coverActive: boolean
  heldWakeKey: boolean
  now: number
  suppressUntil: number
  eventHitsCover: boolean
  kind: 'keyboard' | 'pointer'
}): boolean {
  if (input.dialogOpen) return false
  if (input.kind === 'pointer') {
    if (input.eventHitsCover) return true
    return input.now < input.suppressUntil
  }
  return shouldSwallowOledCareWake({
    coverActive: input.coverActive,
    heldWakeKey: input.heldWakeKey,
    now: input.now,
    suppressUntil: input.suppressUntil
  })
}

export interface OledCareControllerPlan {
  /** Hay que reiniciar el reloj de inactividad. */
  touch: boolean
  /** Esta muestra del mando no puede llegar a la navegación. */
  swallow: boolean
  /** Sigue tragando mientras el botón que despertó siga presionado. */
  consumeWake: boolean
}

/**
 * Misma idea que la vitrina: si el cuidado o la vitrina están activos,
 * el movimiento del mando reinicia el reloj. Si la capa (o la vitrina)
 * estaba puesta, esa primera entrada se traga.
 */
export function oledCareControllerPlan(input: {
  careEnabled: boolean
  attractEnabled: boolean
  coverActive: boolean
  attractActive: boolean
  controllerActivity: boolean
  consumeWake: boolean
}): OledCareControllerPlan {
  if (!input.careEnabled && !input.attractEnabled) {
    return { touch: false, swallow: false, consumeWake: false }
  }
  let consume = input.consumeWake
  if (input.controllerActivity) {
    consume = consume || input.attractActive || input.coverActive
  }
  const swallow = consume
  return {
    touch: input.controllerActivity,
    swallow,
    consumeWake: swallow ? input.controllerActivity : consume
  }
}
