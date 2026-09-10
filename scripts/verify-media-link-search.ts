import assert from 'node:assert/strict'
import {
  canonicalYouTubeVideoUrl,
  isGameMediaLinkKind,
  mediaLinkSearchSuggestions,
  normalizeMediaSearchQuery,
  normalizePastedMediaLink,
  youtubeSearchUrl
} from '../src/shared/mediaLinkSearch.ts'
import {
  achievementGuideSearchQuery,
  achievementGuideTrailer
} from '../src/shared/achievementGuide.ts'

assert.equal(isGameMediaLinkKind('trailer'), true)
assert.equal(isGameMediaLinkKind('title-music'), true)
assert.equal(isGameMediaLinkKind('website'), false)

assert.deepEqual(mediaLinkSearchSuggestions('STAR WARS Zero Company™', 'trailer'), [
  'STAR WARS Zero CompanyTM official trailer',
  'STAR WARS Zero CompanyTM gameplay trailer',
  'STAR WARS Zero CompanyTM launch trailer'
])
assert.deepEqual(mediaLinkSearchSuggestions('STAR WARS Zero Company™', 'title-music'), [
  'STAR WARS Zero CompanyTM main theme',
  'STAR WARS Zero CompanyTM official soundtrack',
  'STAR WARS Zero CompanyTM title screen music'
])

assert.equal(normalizeMediaSearchQuery('  Game soundtrack  '), 'Game soundtrack')
assert.equal(normalizeMediaSearchQuery('x'), undefined)
assert.equal(normalizeMediaSearchQuery(`Game\u0000trailer`), undefined)
assert.equal(normalizeMediaSearchQuery('x'.repeat(181)), undefined)
assert.equal(
  youtubeSearchUrl('Zero Company official trailer'),
  'https://www.youtube.com/results?search_query=Zero+Company+official+trailer'
)

assert.equal(
  canonicalYouTubeVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=42'),
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
)
assert.deepEqual(normalizePastedMediaLink('https://youtu.be/dQw4w9WgXcQ', 'title-music'), {
  state: 'ready',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
})
assert.deepEqual(normalizePastedMediaLink('https://cdn.example.com/trailer.mp4', 'trailer'), {
  state: 'ready',
  url: 'https://cdn.example.com/trailer.mp4'
})
assert.deepEqual(normalizePastedMediaLink('http://example.com/trailer.mp4', 'trailer'), {
  state: 'invalid'
})
assert.deepEqual(normalizePastedMediaLink('https://example.com/music.mp3', 'title-music'), {
  state: 'invalid'
})
assert.deepEqual(normalizePastedMediaLink('  ', 'trailer'), { state: 'empty' })

assert.equal(
  achievementGuideSearchQuery('STAR WARS Zero Company™', 'No Loose Ends'),
  'No Loose Ends STAR WARS Zero CompanyTM achievement guide walkthrough'
)
assert.equal(achievementGuideSearchQuery('Game', ''), undefined)
assert.ok((achievementGuideSearchQuery('G'.repeat(200), 'A'.repeat(200))?.length ?? 0) <= 180)
assert.deepEqual(
  achievementGuideTrailer({
    videoId: 'dQw4w9WgXcQ',
    url: 'https://attacker.invalid/watch',
    thumbnailUrl: 'https://attacker.invalid/image',
    title: 'No Loose Ends guide'
  }),
  {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    format: 'youtube',
    youtubeVideoId: 'dQw4w9WgXcQ',
    title: 'No Loose Ends guide',
    source: 'custom',
    matchedByTitle: false
  }
)
assert.equal(
  achievementGuideTrailer({
    videoId: 'invalid',
    url: 'https://www.youtube.com/watch?v=invalid',
    thumbnailUrl: '',
    title: 'Invalid video'
  }),
  undefined
)

console.log('Media-link search, achievement-guide queries and safe YouTube playback passed')
