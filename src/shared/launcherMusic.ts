export const LAUNCHER_MUSIC_SOURCES = ['orbit', 'custom'] as const
export type LauncherMusicSource = (typeof LAUNCHER_MUSIC_SOURCES)[number]

export interface CustomLauncherMusic {
  /** Opaque orbit-media URL. The original local path never reaches the renderer. */
  url: string
  name: string
}

export const LAUNCHER_MUSIC_ENABLED_DEFAULT = true
export const LAUNCHER_MUSIC_SOURCE_DEFAULT: LauncherMusicSource = 'orbit'
export const LAUNCHER_MUSIC_VOLUME_MIN = 0
export const LAUNCHER_MUSIC_VOLUME_MAX = 100
export const LAUNCHER_MUSIC_VOLUME_DEFAULT = 10
export const LAUNCHER_MUSIC_VOLUME_STEP = 5

export function normalizeLauncherMusicVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return LAUNCHER_MUSIC_VOLUME_DEFAULT
  }
  return Math.round(
    Math.max(LAUNCHER_MUSIC_VOLUME_MIN, Math.min(LAUNCHER_MUSIC_VOLUME_MAX, value))
  )
}

export function isLauncherMusicVolume(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= LAUNCHER_MUSIC_VOLUME_MIN &&
    value <= LAUNCHER_MUSIC_VOLUME_MAX
  )
}

export function isLauncherMusicSource(value: unknown): value is LauncherMusicSource {
  return LAUNCHER_MUSIC_SOURCES.includes(value as LauncherMusicSource)
}
