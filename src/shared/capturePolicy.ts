export interface CaptureItem {
  path: string
  kind: 'image' | 'video'
  capturedAt: number
  sizeBytes: number
  gameTitleGuess: string
  thumbnailUrl?: string
}

export function captureKind(name: string): CaptureItem['kind'] | null {
  if (/\.(png|jpg)$/i.test(name)) return 'image'
  return /\.mp4$/i.test(name) ? 'video' : null
}

export function normalizeCaptureTitle(title: string): string {
  return title.replace(/[™®©]/g, '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function captureTitleGuess(fileName: string): string {
  return fileName.replace(/\.(png|jpg|mp4)$/i, '')
    .replace(/\s+\d{4}[-_.]\d{2}[-_.]\d{2}(?:[\s_].*)?$/, '').trim()
}

export function matchCaptureGame<T extends { id: string; name: string }>(
  fileName: string, games: readonly T[]
): T | undefined {
  const title = normalizeCaptureTitle(captureTitleGuess(fileName))
  // Prefer the longest whole title so Hades II never falls into Hades.
  return [...games].sort((a, b) => b.name.length - a.name.length).find((game) => {
    const name = normalizeCaptureTitle(game.name)
    return name.length > 0 && (title === name || title.startsWith(`${name} `))
  })
}

export function newestCaptures(items: readonly CaptureItem[]): CaptureItem[] {
  return [...items].sort((a, b) => b.capturedAt - a.capturedAt || a.path.localeCompare(b.path)).slice(0, 500)
}

/** Only direct children; reject traversal, device paths, ADS and Windows aliases.
 * The caller must ALSO resolve real paths to reject symlink/junction escapes. */
export function isCapturePathContained(folder: string, candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate.length > 32_768 || /[\x00-\x1f]/.test(candidate) || /[\\/]$/.test(candidate)) return false
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  const root = normalize(folder)
  const target = normalize(candidate)
  if (!root || !target.startsWith(`${root}/`)) return false
  const leaf = target.slice(root.length + 1)
  return !!leaf && !/[/:]/.test(leaf) && leaf !== '.' && leaf !== '..' &&
    !/[. ]$/.test(leaf) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(leaf) && captureKind(leaf) !== null
}
