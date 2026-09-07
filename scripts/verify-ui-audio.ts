import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  LOCAL_AUDIO_EXTENSIONS,
  safeLocalAudioName,
  validateLocalAudioFile
} from '../src/main/localAudioFile.ts'
import { AUDIO_CUE_IDS, isAudioCueId } from '../src/shared/ipc.ts'

const validationDirectory = resolve('.codex-qa', 'ui-audio-validation')
const wavePath = resolve(validationDirectory, 'navigation.wav')
const disguisedPath = resolve(validationDirectory, 'navigation.mp3')
const wave = Buffer.alloc(64)
wave.write('RIFF', 0)
wave.writeUInt32LE(56, 4)
wave.write('WAVE', 8)

await rm(validationDirectory, { recursive: true, force: true })
await mkdir(validationDirectory, { recursive: true })
try {
  await writeFile(wavePath, wave)
  await writeFile(disguisedPath, wave)
  assert.deepEqual(await validateLocalAudioFile(wavePath, 1024), {
    extension: '.wav',
    size: wave.byteLength
  })
  await assert.rejects(() => validateLocalAudioFile(disguisedPath, 1024))
  await assert.rejects(() => validateLocalAudioFile(wavePath, 32))
  await assert.rejects(() => validateLocalAudioFile(resolve(validationDirectory, 'missing.wav'), 1024))
  assert.deepEqual(LOCAL_AUDIO_EXTENSIONS, ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm'])
  assert.equal(safeLocalAudioName('  menu\u0000 click.wav  ', 'fallback'), 'menu click.wav')
  assert.equal(safeLocalAudioName('\u0000\u0007', 'fallback'), 'fallback')
  assert.equal(safeLocalAudioName('x'.repeat(140), 'fallback').length, 120)
  assert.deepEqual(AUDIO_CUE_IDS, [
    'navigate',
    'confirm',
    'back',
    'switch',
    'open',
    'close',
    'error'
  ])
  assert.equal(isAudioCueId('navigate'), true)
  assert.equal(isAudioCueId('../navigate'), false)
} finally {
  await rm(validationDirectory, { recursive: true, force: true })
}

console.log('Custom UI audio checks passed: cue IDs, file signatures and size limits.')
