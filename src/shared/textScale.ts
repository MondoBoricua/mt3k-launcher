export const TEXT_SCALE_DEFAULT = 100
export const TEXT_SCALE_MIN = 100
export const TEXT_SCALE_MAX = 150

export function isTextScale(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= TEXT_SCALE_MIN && value <= TEXT_SCALE_MAX
}

export function normalizeTextScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, Math.round(value)))
    : TEXT_SCALE_DEFAULT
}
