import assert from 'node:assert/strict'
import {
  sanitizeStoredMetadataOverrides,
  validateGameMetadataUpdate
} from '../src/main/library/gameMetadataInput.ts'
import {
  applyGameMetadataOverrides,
  patchGameMetadataOverrides,
  sameGameMetadataOverrides
} from '../src/shared/gameMetadataOverrides.ts'
import { safeExternalHttpsUrl } from '../src/shared/externalUrl.ts'

const accepted = validateGameMetadataUpdate({
  gameId: 'steam:1245620',
  name: 'ELDEN RING — Nightfall',
  metadata: {
    summary: 'A protected manual summary.',
    genres: ['Action', 'RPG', 'Action'],
    trailerUrl: 'https://cdn.example.com/trailers/nightfall.m3u8',
    titleMusicUrl: 'https://youtu.be/dQw4w9WgXcQ',
    platforms: ['windows'],
    achievementCount: 42,
    completionTimes: {
      state: 'available',
      provider: 'howlongtobeat',
      mainStoryMinutes: 3_600,
      sourceUrl: 'https://howlongtobeat.com/game/12345',
      fetchedAt: 0
    }
  }
})

assert.equal(accepted.gameId, 'steam:1245620')
assert.deepEqual(accepted.metadata?.genres, ['Action', 'RPG'])
assert.equal(accepted.metadata?.completionTimes?.fetchedAt! > 0, true)
assert.equal(Object.hasOwn(validateGameMetadataUpdate({ gameId: 'steam:1' }), 'name'), false)

for (const invalid of [
  { gameId: 'steam:1', metadata: { titleMusicUrl: 'https://example.com/music' } },
  { gameId: 'steam:1', metadata: { titleMusicUrl: 'https://youtube.com/playlist?list=invalid' } },
  { gameId: 'steam:1', metadata: { trailerUrl: 'http://example.com/trailer.mp4' } },
  { gameId: 'steam:1', metadata: { trailerUrl: 'https://example.com:8443/trailer.mp4' } },
  { gameId: 'steam:1', metadata: { platforms: ['switch'] } },
  { gameId: 'steam:1', metadata: { launchUri: 'unsafe://override' } },
  { gameId: 'steam:1', name: '' }
]) {
  assert.throws(() => validateGameMetadataUpdate(invalid))
}

assert.deepEqual(
  sanitizeStoredMetadataOverrides({
    summary: 'Keep this edit',
    titleMusicUrl: 'https://not-youtube.example/music',
    unknownLegacyField: 'discard me'
  }),
  { summary: 'Keep this edit' },
  'one damaged persisted field must not discard unrelated valid manual edits'
)

const providerMetadata = { summary: 'Provider value', criticScore: 80 }
const manual = patchGameMetadataOverrides(providerMetadata, undefined, {
  summary: 'Manual value',
  criticScore: null
})
assert.deepEqual(applyGameMetadataOverrides(providerMetadata, manual), {
  summary: 'Manual value'
})
assert.equal(sameGameMetadataOverrides(manual, { ...manual }), true)

const redundantManual = { summary: 'Provider value' }
const reset = patchGameMetadataOverrides(providerMetadata, redundantManual, undefined, true)
assert.equal(reset, undefined)
assert.equal(sameGameMetadataOverrides(redundantManual, reset), false)
assert.deepEqual(
  applyGameMetadataOverrides(providerMetadata, redundantManual),
  applyGameMetadataOverrides(providerMetadata, reset),
  'resetting a redundant override still changes durable override state'
)
assert.equal(safeExternalHttpsUrl('https://orbit.example/path'), 'https://orbit.example/path')
assert.equal(safeExternalHttpsUrl('https://user:secret@orbit.example/path'), undefined)
assert.equal(safeExternalHttpsUrl('https://orbit.example:8443/path'), undefined)
assert.equal(safeExternalHttpsUrl('javascript:alert(1)'), undefined)

console.log('Game metadata validation checks passed')
