/** Xbox title IDs are unsigned 32-bit decimal values on the REST surface. */
export function normalizeXboxTitleId(value: unknown, assumeHex = false): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff
      ? String(value)
      : undefined
  }
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  if (!candidate || candidate.length > 16) return undefined
  try {
    const isHex =
      /^0x[0-9a-f]+$/i.test(candidate) ||
      (assumeHex && /^[0-9a-f]+$/i.test(candidate))
    const parsed = isHex
      ? BigInt(`0x${candidate.replace(/^0x/i, '')}`)
      : /^\d+$/.test(candidate)
        ? BigInt(candidate)
        : -1n
    return parsed >= 0n && parsed <= 0xffffffffn ? parsed.toString(10) : undefined
  } catch {
    return undefined
  }
}
