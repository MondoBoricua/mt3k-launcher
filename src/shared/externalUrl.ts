/** Normalizes an untrusted URL before it crosses into the operating system.
 * Credentials and custom ports are rejected because ORBIT never needs them for
 * user-facing metadata links. */
export function safeExternalHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4_096) return undefined
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port
    ) {
      return undefined
    }
    return url.href
  } catch {
    return undefined
  }
}
