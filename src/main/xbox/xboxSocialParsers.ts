import type { FriendPresence, OrbitFriend } from '@shared/ipc'

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function cleanText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/[\u0000-\u001f\u007f]/gu, '').trim()
  return clean ? clean.slice(0, maximum) : undefined
}

function xboxImageUrl(value: unknown): string | undefined {
  const source = cleanText(value, 2_048)
  if (!source) return undefined
  try {
    const url = new URL(source)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' &&
      (host === 'xboxlive.com' || host.endsWith('.xboxlive.com'))
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

function xboxPresence(value: unknown): FriendPresence {
  const presence = cleanText(value, 32)?.toLowerCase()
  if (presence === 'online') return 'online'
  if (presence === 'away') return 'away'
  if (presence === 'busy' || presence === 'dnd') return 'busy'
  if (presence === 'offline') return 'offline'
  return 'unknown'
}

function xboxActivity(value: unknown): string | undefined {
  const activity = cleanText(value, 100)
  if (!activity || /^(home|online|offline|unknown)$/iu.test(activity)) return undefined
  return activity
}

function xboxLastSeen(value: unknown, now: number): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : undefined
}

/** Strictly projects the Xbox People response into ORBIT's provider-neutral
 * friend model. Unknown fields and untrusted URLs never reach the renderer. */
export function parseXboxSocialPeople(
  payload: unknown,
  maximum = 2_000,
  now = Date.now()
): OrbitFriend[] {
  const root = object(payload)
  const people = Array.isArray(root?.people) ? root.people : []
  const byXuid = new Map<string, OrbitFriend>()

  for (const value of people.slice(0, Math.max(0, maximum))) {
    const person = object(value)
    const xuid = cleanText(person?.xuid, 20)
    if (!person || !xuid || !/^\d{1,20}$/u.test(xuid)) continue
    if (byXuid.has(xuid)) continue
    const gamertag = cleanText(person.gamertag, 80)
    const displayName = gamertag ?? cleanText(person.displayName, 80) ?? `Xbox ${xuid.slice(-6)}`
    const titleHistory = object(person.titleHistory)

    byXuid.set(xuid, {
      id: `xbox:${xuid}`,
      provider: 'xbox',
      providerUserId: xuid,
      displayName,
      avatarUrl: xboxImageUrl(person.displayPicRaw),
      profileUrl: gamertag
        ? `https://account.xbox.com/Profile?gamertag=${encodeURIComponent(gamertag)}`
        : undefined,
      presence: xboxPresence(person.presenceState),
      activity: xboxActivity(person.presenceText),
      lastSeenAt: xboxLastSeen(titleHistory?.lastTimePlayed, now)
    })
  }

  return [...byXuid.values()].sort(
    (left, right) =>
      Number(right.presence === 'online') - Number(left.presence === 'online') ||
      Number(Boolean(right.activity)) - Number(Boolean(left.activity)) ||
      left.displayName.localeCompare(right.displayName)
  )
}
