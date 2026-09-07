import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { evaluateYouTubePlayerScript } from '../src/main/titleMusic/youtubePlayerEvaluator.ts'
import {
  rankThemeMusicCandidates,
  searchTitleForGame
} from '../src/main/titleMusic/themeMusicCandidates.ts'
import {
  GAME_TITLE_MUSIC_ENABLED_DEFAULT,
  GAME_TITLE_MUSIC_DELAY_DEFAULT,
  GAME_TITLE_MUSIC_FADE_DEFAULT,
  GAME_TITLE_MUSIC_VOLUME_DEFAULT,
  isGameTitleMusicDelay,
  isGameTitleMusicFade,
  isGameTitleMusicVolume,
  normalizeGameTitleMusicDelay,
  normalizeGameTitleMusicFade,
  normalizeGameTitleMusicVolume,
  youtubeVideoIdFromUrl
} from '../src/shared/gameTitleMusic.ts'
import {
  selectTitleMusicAudioFormat,
  titleMusicStreamExtension
} from '../src/shared/titleMusicAudio.ts'
import {
  LAUNCHER_MUSIC_ENABLED_DEFAULT,
  LAUNCHER_MUSIC_SOURCE_DEFAULT,
  LAUNCHER_MUSIC_VOLUME_DEFAULT,
  isLauncherMusicSource,
  isLauncherMusicVolume,
  normalizeLauncherMusicVolume
} from '../src/shared/launcherMusic.ts'

assert.equal(searchTitleForGame('Forza Horizon 5™ (Xbox)'), 'Forza Horizon 5')
assert.deepEqual(
  {
    launcherMusic: LAUNCHER_MUSIC_ENABLED_DEFAULT,
    launcherMusicVolume: LAUNCHER_MUSIC_VOLUME_DEFAULT,
    launcherMusicSource: LAUNCHER_MUSIC_SOURCE_DEFAULT,
    gameTitleMusic: GAME_TITLE_MUSIC_ENABLED_DEFAULT,
    gameTitleMusicVolume: GAME_TITLE_MUSIC_VOLUME_DEFAULT,
    gameTitleMusicDelaySeconds: GAME_TITLE_MUSIC_DELAY_DEFAULT,
    gameTitleMusicFadeSeconds: GAME_TITLE_MUSIC_FADE_DEFAULT
  },
  {
    launcherMusic: true,
    launcherMusicVolume: 10,
    launcherMusicSource: 'orbit',
    gameTitleMusic: true,
    gameTitleMusicVolume: 10,
    gameTitleMusicDelaySeconds: 0.5,
    gameTitleMusicFadeSeconds: 0.1
  }
)
assert.equal(normalizeGameTitleMusicVolume(undefined), GAME_TITLE_MUSIC_VOLUME_DEFAULT)
assert.equal(normalizeGameTitleMusicVolume(140), 100)
assert.equal(normalizeGameTitleMusicDelay(Number.NaN), GAME_TITLE_MUSIC_DELAY_DEFAULT)
assert.equal(normalizeGameTitleMusicDelay(8), 5)
assert.equal(normalizeGameTitleMusicFade(undefined), GAME_TITLE_MUSIC_FADE_DEFAULT)
assert.equal(normalizeGameTitleMusicFade(-1), 0)
assert.equal(isGameTitleMusicVolume(35), true)
assert.equal(isGameTitleMusicVolume(101), false)
assert.equal(isGameTitleMusicDelay(1.5), true)
assert.equal(isGameTitleMusicDelay(-0.1), false)
assert.equal(isGameTitleMusicFade(0.6), true)
assert.equal(isGameTitleMusicFade(Infinity), false)
assert.equal(youtubeVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
assert.equal(
  youtubeVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
  'dQw4w9WgXcQ'
)
assert.equal(youtubeVideoIdFromUrl('https://youtube.com/playlist?list=invalid'), undefined)
assert.equal(youtubeVideoIdFromUrl('https://youtube.com:8443/watch?v=dQw4w9WgXcQ'), undefined)
assert.equal(
  selectTitleMusicAudioFormat([
    { mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 192_000 },
    { mimeType: 'audio/webm; codecs="opus"', bitrate: 128_000 }
  ])?.mimeType,
  'audio/webm; codecs="opus"'
)
assert.equal(
  selectTitleMusicAudioFormat([
    { mimeType: 'video/mp4; codecs="avc1"', bitrate: 2_000_000 },
    { mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000 }
  ])?.mimeType,
  'audio/mp4; codecs="mp4a.40.2"'
)
assert.equal(titleMusicStreamExtension('audio/webm; codecs="opus"'), 'webm')
assert.equal(titleMusicStreamExtension('audio/mp4; codecs="mp4a.40.2"'), 'm4a')
assert.equal(normalizeLauncherMusicVolume(undefined), LAUNCHER_MUSIC_VOLUME_DEFAULT)
assert.equal(normalizeLauncherMusicVolume(150), 100)
assert.equal(isLauncherMusicVolume(12), true)
assert.equal(isLauncherMusicVolume(-1), false)
assert.equal(isLauncherMusicSource('orbit'), true)
assert.equal(isLauncherMusicSource('custom'), true)
assert.equal(isLauncherMusicSource('remote'), false)
const orbitAmbient = await readFile(new URL('../src/renderer/src/assets/audio/orbit-ambient.wav', import.meta.url))
assert.equal(orbitAmbient.subarray(0, 4).toString('ascii'), 'RIFF')
assert.equal(orbitAmbient.subarray(8, 12).toString('ascii'), 'WAVE')
assert.ok(orbitAmbient.byteLength > 1_000_000)
const ranked = rankThemeMusicCandidates('Elden Ring', [
  {
    videoId: 'ZfGqwHDK2Uw',
    title: 'Elden Ring - Main Theme OST Official Soundtrack Music',
    author: 'Soundtrack Archive',
    durationSeconds: 354
  },
  {
    videoId: 'KBP1zYwBzOE',
    title: 'Elden Ring',
    author: 'Tsukasa Saitoh - Topic',
    durationSeconds: 99
  },
  {
    videoId: 'N2p_JFF4lR0',
    title: 'Elden Ring Main Theme | Epic Version',
    author: 'Fan Music',
    durationSeconds: 335
  },
  {
    videoId: 'not-valid',
    title: 'Elden Ring Main Theme',
    durationSeconds: 240
  },
  {
    videoId: '12345678901',
    title: 'Elden Ring full soundtrack',
    durationSeconds: 7_200
  }
])
assert.deepEqual(ranked.map((candidate) => candidate.videoId).slice(0, 2), [
  'KBP1zYwBzOE',
  'ZfGqwHDK2Uw'
])
assert.equal(rankThemeMusicCandidates('Halo Infinite', [{
  videoId: 'abcdefghijk',
  title: 'Completely unrelated cooking video',
  durationSeconds: 180
}]).length, 0)

const isolatedResult = evaluateYouTubePlayerScript({
  output: 'return { processType: typeof process, requireType: typeof require };',
  exported: []
}, {}) as { processType?: string; requireType?: string }
assert.equal(isolatedResult.processType, 'undefined')
assert.equal(isolatedResult.requireType, 'undefined')
assert.throws(
  () => evaluateYouTubePlayerScript({
    output: 'return Function("return 1")();',
    exported: []
  }, {}),
  /Code generation from strings disallowed/u
)

console.log('Music checks passed: launcher ambience, preference bounds, title cleanup, provider-neutral matching and isolated player evaluation.')

if (process.argv.includes('--live')) {
  const { Innertube, Platform } = await import('youtubei.js')
  Platform.shim.eval = evaluateYouTubePlayerScript
  const youtube = await Innertube.create({
    lang: 'de',
    location: 'DE',
    enable_safety_mode: true,
    generate_session_locally: true
  })
  const search = await youtube.search('ELDEN RING main theme official soundtrack', { type: 'video' })
  const candidates = rankThemeMusicCandidates('Elden Ring', search.results.flatMap((result) => {
    const video = result as unknown as {
      video_id?: string
      title?: { text?: string }
      author?: { name?: string }
      duration?: { seconds?: number }
    }
    return video.video_id && video.title?.text
      ? [{
          videoId: video.video_id,
          title: video.title.text,
          author: video.author?.name,
          durationSeconds: video.duration?.seconds
        }]
      : []
  }))
  assert.ok(candidates.length, 'live search should return a ranked theme')
  console.log(`Live title-music discovery verified: ${candidates[0].title}`)
}
