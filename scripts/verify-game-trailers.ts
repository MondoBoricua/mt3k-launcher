import assert from 'node:assert/strict'
import {
  customGameTrailerMedia,
  GAME_TRAILER_INTRO_SKIP_SECONDS,
  gameTrailerStartPosition,
  trailerMediaUrl,
  YOUTUBE_TRAILER_APP_REFERRER,
  youtubeTrailerEmbedUrl
} from '../src/shared/gameTrailer.ts'
import { exactSteamTrailerMatch, parseSteamTrailer, parseXboxTrailer } from '../src/main/trailers/trailerProviders.ts'

for (const url of ['file:///C:/secret.mp4', 'javascript:alert(1)', 'https://steamstatic.com.evil.test/a',
  'https://user:password@video.akamai.steamstatic.com/a', 'https://localhost/a', 'https://video.akamai.steamstatic.com:8443/a']) {
  assert.equal(trailerMediaUrl(url), undefined, url)
}
assert.equal(trailerMediaUrl('http://xbl-smooth-ssl-xboxlive-com.akamaized.net/video/test.mp4'),
  'https://xbl-smooth-ssl-xboxlive-com.akamaized.net/video/test.mp4')
assert.deepEqual(customGameTrailerMedia('https://youtu.be/dQw4w9WgXcQ?t=42'), {
  url: 'https://youtu.be/dQw4w9WgXcQ?t=42',
  format: 'youtube',
  youtubeVideoId: 'dQw4w9WgXcQ'
})
assert.equal(customGameTrailerMedia('https://cdn.example.com/trailer.m3u8')?.format, 'hls')
assert.equal(customGameTrailerMedia('https://cdn.example.com/trailer.mp4?token=public')?.format, 'file')
assert.equal(customGameTrailerMedia('https://example.com/trailer')?.format, 'external')
assert.equal(customGameTrailerMedia('file:///C:/secret.mp4'), undefined)
const youtubeBackground = new URL(youtubeTrailerEmbedUrl('dQw4w9WgXcQ', 'background')!)
assert.equal(youtubeBackground.origin, 'https://www.youtube-nocookie.com')
assert.equal(youtubeBackground.pathname, '/embed/dQw4w9WgXcQ')
assert.equal(youtubeBackground.searchParams.get('autoplay'), '1')
assert.equal(youtubeBackground.searchParams.get('mute'), '1')
assert.equal(youtubeBackground.searchParams.get('vq'), null)
assert.equal(youtubeBackground.searchParams.get('controls'), '0')
assert.equal(youtubeBackground.searchParams.get('enablejsapi'), '1')
assert.equal(youtubeBackground.searchParams.get('start'), '5')
assert.equal(youtubeBackground.searchParams.has('playlist'), false)
assert.equal(youtubeBackground.searchParams.has('loop'), false)
const youtubePlayer = new URL(youtubeTrailerEmbedUrl('dQw4w9WgXcQ', 'player')!)
assert.equal(youtubePlayer.searchParams.get('controls'), '0')
assert.equal(youtubePlayer.searchParams.get('disablekb'), '1')
assert.equal(youtubePlayer.searchParams.get('fs'), '0')
assert.equal(youtubePlayer.searchParams.has('mute'), false)
assert.equal(youtubeTrailerEmbedUrl('../malicious', 'player'), undefined)
assert.equal(YOUTUBE_TRAILER_APP_REFERRER, 'https://com.orbit.launcher/')
assert.equal(GAME_TRAILER_INTRO_SKIP_SECONDS, 5)
assert.equal(gameTrailerStartPosition(120), 5)
assert.equal(gameTrailerStartPosition(Number.POSITIVE_INFINITY), 5)
assert.equal(gameTrailerStartPosition(5.25), 0)
assert.equal(gameTrailerStartPosition(3), 0)
assert.equal(gameTrailerStartPosition(90, 120), 125)
const steamUrl = 'https://video.akamai.steamstatic.com/store_trailers/1/test/hls_264_master.m3u8'
assert.equal(parseSteamTrailer({ 1: { success: true, data: { movies: [{ hls_h264: steamUrl, name: 'Trailer' }] } } }, '1')?.format, 'hls')
assert.equal(parseSteamTrailer({ 2: { success: true, data: { movies: [{ hls_h264: steamUrl }] } } }, '1'), null)
assert.equal(parseSteamTrailer({ 1: { success: false, data: { movies: [{ hls_h264: steamUrl }] } } }, '1'), null)
assert.equal(parseSteamTrailer({ 1: { success: true, data: { movies: [{ mp4: { max: 'https://video.akamai.steamstatic.com/movie.mp4' } }] } } }, '1')?.format, 'file')
const xboxUrl = 'https://cdn.trailers.xboxservices.com/trailers/test.m3u8'
const page = (state: unknown): string => `<script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script>`
const video = { url: xboxUrl, title: 'Gameplay', purpose: 'trailer' }
assert.equal(parseXboxTrailer(page({ products: { OTHERPRODUCT: { cmsVideos: [video] }, TARGETGAME12: { videos: [] } } }), 'TARGETGAME12'), null)
assert.equal(parseXboxTrailer(page({ products: { TARGETGAME12: { cmsVideos: [video] } } }), 'TARGETGAME12')?.url, xboxUrl)
assert.equal(parseXboxTrailer(page({ products: { TARGETGAME12: { videos: [{ ...video, purpose: 'HeroTrailer' }] } } }), 'TARGETGAME12')?.source, 'xbox')
assert.equal(parseXboxTrailer('<script>window.__PRELOADED_STATE__ = {bad};</script>', 'TARGETGAME12'), null)
const search = { items: [{ type: 'app', id: 42, name: 'Game™ 2' }, { type: 'app', id: 43, name: 'Game 2 Remastered' }] }
assert.equal(exactSteamTrailerMatch(search, 'Game 2'), '42')
assert.equal(exactSteamTrailerMatch(search, 'Game'), null)
assert.equal(exactSteamTrailerMatch({ items: [...search.items, search.items[0]] }, 'Game 2'), null)
assert.equal(exactSteamTrailerMatch({ items: [{ type: 'app', id: 1, name: '東京' }] }, '北京'), null)
console.log('Trailer checks passed: provider isolation, exact-title matching, malformed/missing data, HLS/file/YouTube formats, embeds and URL boundaries.')

if (process.argv.includes('--live')) {
  const steamResponse = await fetch('https://store.steampowered.com/api/appdetails?appids=1245620&l=german')
  const steam = parseSteamTrailer(await steamResponse.json(), '1245620')
  assert.ok(steam, 'Steam live trailer')
  const xboxResponse = await fetch('https://www.xbox.com/de-DE/games/store/riders-republic/9P1RPXHWZ1C7')
  const xbox = parseXboxTrailer(await xboxResponse.text(), '9P1RPXHWZ1C7')
  assert.ok(xbox, 'Xbox native live trailer')
  for (const trailer of [steam, xbox]) {
    const response = await fetch(trailer.url)
    assert.equal(response.ok, true, `${trailer.source} media is reachable`)
    if (trailer.format === 'hls') assert.match(await response.text(), /^#EXTM3U/)
    console.log(`${trailer.source}: live ${trailer.format} source and manifest verified`)
  }
  if (process.env.ORBIT_TRAILER_FIXTURE) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(process.env.ORBIT_TRAILER_FIXTURE, JSON.stringify({ steam, xbox }))
  }
}
