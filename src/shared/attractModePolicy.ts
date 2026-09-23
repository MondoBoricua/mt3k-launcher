export const ATTRACT_IDLE_MINUTES = [2, 5, 10, 15] as const
export function normalizeAttractIdleMinutes(value: unknown): number {
  return ATTRACT_IDLE_MINUTES.includes(value as 2 | 5 | 10 | 15) ? value as number : 5
}

export interface AttractState {
  enabled: boolean
  view: string
  launchPhase: string
  dialogOpen: boolean
  visible: boolean
  focused: boolean
  gameCount: number
  idleMs: number
  idleMinutes: number
}

export function shouldStartAttractMode(state: AttractState): boolean {
  return state.enabled && (state.view === 'home' || state.view === 'library') &&
    state.launchPhase === 'idle' && !state.dialogOpen && state.visible && state.focused &&
    state.gameCount > 0 && state.idleMs >= normalizeAttractIdleMinutes(state.idleMinutes) * 60_000
}

/** Uniform choice among the remaining indices; the current slide cannot repeat. */
export function nextAttractIndex(count: number, current: number, random = Math.random()): number {
  if (!Number.isInteger(count) || count <= 0) return -1
  if (count === 1) return 0
  const sample = Number.isFinite(random) ? Math.max(0, Math.min(0.999999999, random)) : 0
  if (current < 0 || current >= count) return Math.floor(sample * count)
  const next = Math.floor(sample * (count - 1))
  return next >= current ? next + 1 : next
}

export function attractDwellMs(reducedMotion: boolean): number {
  return reducedMotion ? 16_000 : 8_000
}
