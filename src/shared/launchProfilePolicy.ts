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
  | { kind: 'closed' | 'error' | 'restored' }

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

export function isRestoreJournal(value: unknown): value is RestoreJournal {
  if (!value || typeof value !== 'object') return false
  const j = value as RestoreJournal
  const valid = (s: DisplaySnapshot): boolean => Boolean(s &&
    typeof s.deviceName === 'string' && /^\\\\\.\\DISPLAY\d{1,3}$/.test(s.deviceName) &&
    typeof s.identity === 'string' && s.identity.length > 0 && s.identity.length <= 512 && isProfile(s.profile))
  return j.version === 1 && valid(j.previous) && valid(j.applied) &&
    j.previous.deviceName === j.applied.deviceName && j.previous.identity === j.applied.identity
}
