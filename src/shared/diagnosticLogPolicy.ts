export const LOG_MAX_BYTES = 2 * 1024 * 1024
export type DiagnosticLevel = 'info' | 'warn' | 'error'

/** Conservative heuristics: prefer losing an opaque identifier to leaking a credential. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s,"';]+/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:[\w-]*token|[\w-]*secret|[\w-]*key|authorization|steamLoginSecure)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi, '$1[REDACTED]')
    .replace(/\bmfa\.[\w-]+/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/[a-f\d]{32,}/gi, '[REDACTED]')
    .replace(/[A-Za-z0-9+/_-]{48,}={0,2}/g, '[REDACTED]')
}

export function formatLogLine(
  level: DiagnosticLevel,
  message: string,
  time = new Date()
): string {
  const safe = redactSecrets(message).replace(/\r/g, '\\r').replace(/\n/g, '\\n')
  const tagged = /^\[([^\]]+)\]\s*(.*)$/.exec(safe)
  return `${time.toISOString()} ${level.toUpperCase()} [${tagged?.[1] ?? 'main'}] ${tagged?.[2] ?? safe}\n`
}
