export interface ThemeMusicCandidate {
  videoId: string
  title: string
  author?: string
  durationSeconds?: number
}

interface RankedCandidate extends ThemeMusicCandidate {
  score: number
}

const POSITIVE_PHRASES: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bmain theme\b/u, 45],
  [/\btitle theme\b/u, 42],
  [/\btitle screen\b/u, 38],
  [/\bmain menu\b/u, 36],
  [/\btheme(?: song| music)?\b/u, 24],
  [/\bofficial\b/u, 14],
  [/\boriginal soundtrack\b/u, 16],
  [/\b(?:soundtrack|ost)\b/u, 10]
]

const NEGATIVE_PHRASES: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(?:cover|remix|remastered|reimagined|fanmade|fan made)\b/u, 90],
  [/\b(?:epic|metal|rock|piano|orchestral|orchestra|symphony) version\b/u, 80],
  [/\b(?:extended|loop|1 hour|one hour|10 hours?)\b/u, 75],
  [/\b(?:reaction|review|analysis|gameplay|walkthrough|trailer)\b/u, 60],
  [/\b(?:full|complete) (?:ost|soundtrack|album)\b/u, 70],
  [/\blive\b/u, 45]
]

export function normalizeThemeMusicText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[™®©]/gu, '')
    .replace(/[’']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

export function searchTitleForGame(value: string): string {
  return value
    .replace(/[™®©]/gu, '')
    .replace(/\s*[([](?:pc|windows|xbox|playstation|steam|epic|gog)[)\]]\s*$/iu, '')
    .trim()
}

function scoreCandidate(gameName: string, candidate: ThemeMusicCandidate): number {
  const game = normalizeThemeMusicText(searchTitleForGame(gameName))
  const title = normalizeThemeMusicText(candidate.title)
  const author = normalizeThemeMusicText(candidate.author ?? '')
  if (!game || !title) return Number.NEGATIVE_INFINITY

  let score = 0
  if (title.includes(game)) {
    score += 100
  } else {
    const tokens = game.split(' ').filter((token) => token.length > 1)
    const matching = tokens.filter((token) => title.includes(token)).length
    score += tokens.length ? Math.round((matching / tokens.length) * 70) : 0
  }
  for (const [pattern, weight] of POSITIVE_PHRASES) {
    if (pattern.test(title)) score += weight
  }
  for (const [pattern, weight] of NEGATIVE_PHRASES) {
    if (pattern.test(title)) score -= weight
  }
  // YouTube Topic channels are generated from licensed music deliveries and
  // are a stronger authenticity signal than "official" written in a title.
  if (/\btopic\b/u.test(author)) score += 100
  if (/\bofficial\b/u.test(author)) score += 10
  if (candidate.durationSeconds && candidate.durationSeconds <= 420) score += 8
  return score
}

export function rankThemeMusicCandidates(
  gameName: string,
  candidates: readonly ThemeMusicCandidate[]
): ThemeMusicCandidate[] {
  const unique = new Map<string, RankedCandidate>()
  for (const candidate of candidates) {
    if (!/^[\w-]{11}$/u.test(candidate.videoId)) continue
    if (!candidate.title.trim() || candidate.title.length > 300) continue
    if (
      candidate.durationSeconds !== undefined &&
      (!Number.isFinite(candidate.durationSeconds) ||
        candidate.durationSeconds < 30 ||
        candidate.durationSeconds > 900)
    ) {
      continue
    }
    const score = scoreCandidate(gameName, candidate)
    if (score < 80) continue
    const current = unique.get(candidate.videoId)
    if (!current || score > current.score) unique.set(candidate.videoId, { ...candidate, score })
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ score: _score, ...candidate }) => candidate)
}
