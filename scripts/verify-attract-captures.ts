import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCaptureImage, scanCaptureDirectory, validateCaptureFile } from '../src/main/captures/captureFiles.ts'
import { shouldStartAttractMode, nextAttractIndex, attractDwellMs, normalizeAttractIdleMinutes, type AttractState } from '../src/shared/attractModePolicy.ts'
import { normalizeCaptureTitle, captureTitleGuess, matchCaptureGame, captureKind, newestCaptures, isCapturePathContained } from '../src/shared/capturePolicy.ts'

const ready: AttractState = {
  enabled: true, view: 'home', launchPhase: 'idle', dialogOpen: false,
  visible: true, focused: true, gameCount: 3, idleMs: 300_000, idleMinutes: 5
}
assert.equal(shouldStartAttractMode(ready), true)
assert.equal(shouldStartAttractMode({ ...ready, view: 'library' }), true)
for (const blocker of [
  { enabled: false }, { view: 'settings' }, { view: 'store' }, { view: 'friends' },
  { view: 'applications' }, { launchPhase: 'launching' }, { launchPhase: 'running' },
  { launchPhase: 'returning' }, { dialogOpen: true }, { visible: false },
  { focused: false }, { gameCount: 0 }, { idleMs: 299_999 }, { idleMs: NaN }
]) assert.equal(shouldStartAttractMode({ ...ready, ...blocker }), false, JSON.stringify(blocker))
for (const minutes of [2, 5, 10, 15]) {
  assert.equal(normalizeAttractIdleMinutes(minutes), minutes)
  assert.equal(shouldStartAttractMode({ ...ready, idleMinutes: minutes, idleMs: minutes * 60_000 }), true)
  assert.equal(shouldStartAttractMode({ ...ready, idleMinutes: minutes, idleMs: minutes * 60_000 - 1 }), false)
}
for (const invalid of [0, -1, 3, '2', Infinity, undefined]) assert.equal(normalizeAttractIdleMinutes(invalid), 5)
assert.equal(nextAttractIndex(0, 0), -1)
assert.equal(nextAttractIndex(1, 0), 0)
for (let count = 2; count <= 20; count++) {
  for (let current = 0; current < count; current++) {
    const seen = new Set<number>()
    for (let step = 0; step < 100; step++) {
      const next = nextAttractIndex(count, current, step / 100)
      assert.notEqual(next, current)
      assert.ok(next >= 0 && next < count)
      seen.add(next)
    }
    assert.equal(seen.size, count - 1)
  }
}
assert.equal(attractDwellMs(false), 8_000)
assert.equal(attractDwellMs(true), 16_000)
const games = [
  { id: 'h1', name: 'Hades' }, { id: 'h2', name: 'Hades II' },
  { id: 'm', name: 'MARVEL Tōkon: Fighting Souls™' },
  { id: 'r', name: 'Мир танков' }, { id: 'j', name: '龍が如く' }
]
assert.equal(normalizeCaptureTitle(' MARVEL Tōkon: Fighting Souls™®© '), 'marvel tokon fighting souls')
assert.equal(captureTitleGuess('Hades II 2026-09-14 21-03-11.mp4'), 'Hades II')
for (const [name, id] of [
  ['Hades II 2026-09-14 21-03-11.mp4', 'h2'],
  ['MARVEL Tōkon Fighting Souls 2026-09-14 21-03-11.png', 'm'],
  ['marvel tokon fighting souls 2026-09-14 21-03-11.jpg', 'm'],
  ['МИР ТАНКОВ 2026-09-14 21-03-11.mp4', 'r'],
  ['龍が如く 2026-09-14 21-03-11.png', 'j']
]) assert.equal(matchCaptureGame(name, games)?.id, id)
assert.equal(matchCaptureGame('Hadesian 2026-09-14 21-03-11.mp4', games), undefined)
assert.equal(matchCaptureGame('Unknown 2026-09-14 21-03-11.mp4', games), undefined)
assert.equal(captureKind('A.PNG'), 'image')
assert.equal(captureKind('A.jpg'), 'image')
assert.equal(captureKind('A.MP4'), 'video')
for (const name of ['A.mp4.exe', 'A.svg', 'A', 'A.jpeg']) assert.equal(captureKind(name), null)
const items = Array.from({ length: 600 }, (_, index) => ({ path: `${index}.png`, kind: 'image' as const, capturedAt: index, sizeBytes: 2, gameTitleGuess: '' }))
const newest = newestCaptures(items)
assert.equal(newest.length, 500)
assert.equal(newest[0].capturedAt, 599)
assert.equal(newest.at(-1)?.capturedAt, 100)
assert.equal(items[0].capturedAt, 0)
const folder = 'C:\\Users\\Player\\Videos\\Captures'
assert.ok(isCapturePathContained(folder, `${folder}\\Hades II.png`))
assert.ok(isCapturePathContained(folder, 'c:/users/player/videos/captures/Hades II.PNG'))
for (const invalid of [
  `${folder}\\CON.png`, `${folder}\\file.png/`, `${folder}Other\\file.png`, `${folder}\\..\\file.png`, `${folder}\\nested\\file.png`,
  `${folder}\\file.png:evil`, `${folder}\\file.exe`, `${folder}\\file.png `,
  `${folder}\\file.png.`, `${folder}\\file\x00.png`, 'C:\\Other\\file.png',
  '\\\\?\\C:\\Users\\Player\\Videos\\Captures\\file.png', 'https://example.com/a.png', 12, null, folder
]) assert.equal(isCapturePathContained(folder, invalid), false, String(invalid))
const sandbox = await mkdtemp(join(tmpdir(), 'mt3k-captures-'))
try {
  const captureDir = join(sandbox, 'Captures')
  await mkdir(captureDir)
  const screenshot = join(captureDir, 'Hades II 2026-09-14 21-03-11.png')
  await writeFile(screenshot, 'fixture')
  await writeFile(join(captureDir, 'ignore.exe'), 'not a capture')
  await mkdir(join(captureDir, 'nested'))
  await writeFile(join(captureDir, 'nested', 'nested.png'), 'not indexed')
  const external = join(sandbox, 'outside.png')
  await writeFile(external, 'outside')
  const link = join(captureDir, 'escape.png')
  await symlink(external, link)
  await assert.rejects(validateCaptureFile(captureDir, external))
  await assert.rejects(validateCaptureFile(captureDir, link))
  assert.ok((await validateCaptureFile(captureDir, screenshot)).endsWith('Hades II 2026-09-14 21-03-11.png'))
  const image = await readCaptureImage(captureDir, screenshot)
  assert.equal(image.contentType, 'image/png')
  assert.ok(image.bytes.length > 0, 'bytes are served from the validated descriptor')
  await assert.rejects(readCaptureImage(captureDir, external), 'outside the folder is never read')
  const scanned = await scanCaptureDirectory(captureDir)
  assert.equal(scanned.length, 1)
  assert.equal(scanned[0].gameTitleGuess, 'Hades II')
  assert.equal(scanned[0].sizeBytes, 7)
  // A file replaced by a link after indexing is still rejected at open/thumbnail time.
  await rm(screenshot)
  await symlink(external, screenshot)
  await assert.rejects(validateCaptureFile(captureDir, screenshot))
  await assert.rejects(readCaptureImage(captureDir, screenshot), 'a swapped-in symlink is never read')
  await assert.rejects(readCaptureImage(captureDir, link), 'a link inside the folder is never read')
  assert.deepEqual(await scanCaptureDirectory(captureDir, () => false), [])
  assert.deepEqual(await scanCaptureDirectory(join(sandbox, 'missing')), [])
} finally { await rm(sandbox, { recursive: true, force: true }) }
console.log('Attract/captures policy and filesystem checks passed')
