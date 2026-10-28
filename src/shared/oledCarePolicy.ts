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
/** Igual que la vitrina: la tecla que despertó no se repite contra la UI. */
export const OLED_CARE_WAKE_SUPPRESS_MS = 500

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
  if (!Number.isFinite(state.idleMs)) return false
  const threshold = normalizeOledCareIdleMinutes(state.idleMinutes) * 60_000
  return state.idleMs >= threshold
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
