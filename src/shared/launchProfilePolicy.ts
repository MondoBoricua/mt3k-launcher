export type DisplayMode = 'handheld' | 'docked'
export interface LaunchProfile { width: number; height: number; refreshHz: number; hdr?: boolean }
export type LaunchProfileEntry = Partial<Record<DisplayMode, LaunchProfile>>
export interface DisplaySnapshot { deviceName: string; identity: string; profile: LaunchProfile }
export interface RestoreJournal { version: 1; previous: DisplaySnapshot; applied: DisplaySnapshot }
export interface DisplayModeList {
  mode: DisplayMode
  modes: LaunchProfile[]
  hdrAvailable: boolean
  supported: boolean
}
export type LaunchProfileEvent =
  | { kind: 'confirm'; token: string; profile: LaunchProfile }
  | { kind: 'closed' | 'restored' }
  | { kind: 'error'; reason?: 'pending-journal' }

/** Lo que el botón de olvidar le devuelve al renderer. */
export type LaunchProfileDiscardResult = 'forgotten' | 'busy' | 'absent'

export type LaunchWithPendingJournalDecision = 'launch' | 'apply-profile' | 'refuse-pending-journal'

export function detectDisplayMode(displays: readonly { internal?: boolean }[]): DisplayMode {
  if (displays.some((display) => display.internal === false)) return 'docked'
  if (displays.every((display) => typeof display.internal === 'boolean')) return 'handheld'
  return displays.length > 1 ? 'docked' : 'handheld'
}

// Do not borrow a TV profile for the internal panel (or vice versa).
export function selectProfile(entry: LaunchProfileEntry | undefined, mode: DisplayMode): LaunchProfile | undefined {
  const profile = entry?.[mode]
  return profile ? { ...profile } : undefined
}

export function isProfile(value: unknown): value is LaunchProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as LaunchProfile
  return Number.isInteger(p.width) && p.width >= 320 && p.width <= 32768 &&
    Number.isInteger(p.height) && p.height >= 200 && p.height <= 32768 &&
    Number.isInteger(p.refreshHz) && p.refreshHz >= 1 && p.refreshHz <= 1000 &&
    (p.hdr === undefined || typeof p.hdr === 'boolean') &&
    Object.keys(value).every((key) => ['width', 'height', 'refreshHz', 'hdr'].includes(key))
}

export function sameProfile(a: LaunchProfile, b: LaunchProfile): boolean {
  return a.width === b.width && a.height === b.height && a.refreshHz === b.refreshHz && a.hdr === b.hdr
}

export function validateProfile(profile: unknown, availableModes: readonly LaunchProfile[]): profile is LaunchProfile {
  return isProfile(profile) && availableModes.some((mode) => sameProfile(profile, mode))
}

export function restorePlan(previous: DisplaySnapshot, applied: DisplaySnapshot): DisplaySnapshot | null {
  if (previous.deviceName !== applied.deviceName || previous.identity !== applied.identity) return null
  return sameProfile(previous.profile, applied.profile) ? null : { ...previous, profile: { ...previous.profile } }
}

/**
 * Un journal pendiente no puede tapar un juego que no tiene perfil
 * para el modo de ahora. Solo se niega el lanzamiento que aplicaría
 * otro perfil encima de una restauración que todavía no se pudo hacer.
 */
export function decideLaunchWithPendingJournal(input: {
  journalPending: boolean
  hasProfileForMode: boolean
}): LaunchWithPendingJournalDecision {
  if (input.journalPending) {
    return input.hasProfileForMode ? 'refuse-pending-journal' : 'launch'
  }
  return input.hasProfileForMode ? 'apply-profile' : 'launch'
}

/**
 * El escritorio se devuelve al cerrar la sesión, también si el
 * lanzamiento terminó en error y nunca llegó a idle.
 */
export function shouldRestoreLaunchProfile(phase: string): boolean {
  return phase === 'idle' || phase === 'error' || phase === 'complete'
}

/**
 * Al arrancar se lee el journal aunque el toggle esté apagado:
 * devolver el escritorio no depende de que la función siga prendida.
 */
export function shouldRecoverDisplayJournalOnStartup(journalOnDisk: boolean): boolean {
  return journalOnDisk
}

/** Reintentar solo cuando el monitor puede haber vuelto, y no en medio de una confirmación. */
export function shouldRetryPendingDisplayRestore(input: {
  eventName: string
  confirmationPending: boolean
  journalPending: boolean
}): boolean {
  if (input.confirmationPending || !input.journalPending) return false
  return input.eventName === 'display-added' || input.eventName === 'display-metrics-changed'
}

/**
 * Olvidar el journal es explícito. Si todavía hay un "¿ves esta pantalla?"
 * en curso, no se borra: primero hay que cerrar ese aviso.
 */
export function decideDiscardPendingRestore(input: {
  confirmed: boolean
  confirmationPending: boolean
  journalPending: boolean
}): 'forget' | 'keep' | 'busy' {
  if (!input.confirmed) return 'keep'
  if (input.confirmationPending) return 'busy'
  if (!input.journalPending) return 'keep'
  return 'forget'
}

/**
 * Identidad distinta o monitor ausente: el journal se queda y se puede
 * reintentar. Otro fallo (el modo no pasó la prueba, por ejemplo) también
 * conserva el journal, pero no es "el monitor se fue".
 */
export function displayRestoreFailureIsMonitor(message: string): boolean {
  return (
    message.includes('Display identity changed') ||
    message.includes('Display disconnected') ||
    message.includes('Display monitor disconnected') ||
    message.includes('Display monitor identity unavailable') ||
    message.includes('Primary display unavailable')
  )
}

export function isRestoreJournal(value: unknown): value is RestoreJournal {
  if (!value || typeof value !== 'object') return false
  const j = value as RestoreJournal
  const valid = (s: DisplaySnapshot): boolean => Boolean(s &&
    typeof s.deviceName === 'string' && /^\\\\\.\\DISPLAY\d{1,3}$/.test(s.deviceName) &&
    typeof s.identity === 'string' && s.identity.length > 0 && s.identity.length <= 512 && isProfile(s.profile))
  return j.version === 1 && valid(j.previous) && valid(j.applied) &&
    j.previous.deviceName === j.applied.deviceName && j.previous.identity === j.applied.identity
}
