import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseXboxSocialPeople } from '../src/main/xbox/xboxSocialParsers.ts'

const now = Date.parse('2026-09-05T12:00:00.000Z')
const friends = parseXboxSocialPeople(
  {
    people: [
      {
        xuid: '1234567890123456',
        gamertag: 'Orbit Friend',
        displayName: 'Ignored Real Name',
        displayPicRaw: 'https://images-eds-ssl.xboxlive.com/image.png',
        presenceState: 'Online',
        presenceText: 'Forza Horizon',
        titleHistory: { lastTimePlayed: '2026-09-04T08:00:00.000Z' }
      },
      {
        xuid: '2222',
        displayName: 'Offline Friend',
        displayPicRaw: 'https://attacker.invalid/avatar.png',
        presenceState: 'Offline',
        presenceText: 'Home',
        titleHistory: { lastTimePlayed: '2026-09-03T08:00:00.000Z' }
      },
      { xuid: '../invalid', gamertag: 'Invalid' },
      { xuid: '1234567890123456', gamertag: 'Duplicate', presenceState: 'Away' }
    ]
  },
  2_000,
  now
)

assert.equal(friends.length, 2)
assert.equal(friends[0]?.provider, 'xbox')
assert.equal(friends[0]?.displayName, 'Orbit Friend')
assert.equal(friends[0]?.presence, 'online')
assert.equal(friends[0]?.activity, 'Forza Horizon')
assert.equal(friends[0]?.avatarUrl, 'https://images-eds-ssl.xboxlive.com/image.png')
assert.equal(friends[1]?.avatarUrl, undefined)
assert.equal(friends[1]?.activity, undefined)
assert.equal(friends[1]?.lastSeenAt, Date.parse('2026-09-03T08:00:00.000Z'))

const friendsSource = await readFile(
  new URL('../src/main/friendsService.ts', import.meta.url),
  'utf8'
)
const authSource = await readFile(new URL('../src/main/xbox/xboxAuth.ts', import.meta.url), 'utf8')
assert.match(friendsSource, /peoplehub\.xboxlive\.com/u)
assert.match(friendsSource, /MAX_XBOX_RESPONSE_BYTES/u)
assert.match(authSource, /'peoplehub\.xboxlive\.com'/u)
assert.doesNotMatch(friendsSource, /accessToken|refreshToken|userHash/u)

console.log('Xbox friends projection, cache boundaries and service allowlist checks passed.')
