export interface GameTrailer {
  url: string
  format: 'hls' | 'file' | 'external'
  title: string
  source: 'steam' | 'xbox' | 'custom'
  /** True when the trailer comes from another store's exact-title match. */
  matchedByTitle: boolean
}

/** Only provider media hosts; never accept arbitrary renderer/network URLs. */
export function trailerMediaUrl(value: unknown, allowCustomHost = false): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return undefined
    if (!allowCustomHost && !/(^|\.)(steamstatic\.com|steamcdn-a\.akamaihd\.net|xboxservices\.com|xboxlive\.com|s-microsoft\.com)$/.test(url.hostname) &&
        url.hostname !== 'xbl-smooth-ssl-xboxlive-com.akamaized.net') return undefined
    url.protocol = 'https:'
    return url.href
  } catch { return undefined }
}
