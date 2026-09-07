import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const outputPath = resolve('src/renderer/src/assets/audio/orbit-ambient.wav')
const sampleRate = 22_050
const durationSeconds = 32
const frameCount = sampleRate * durationSeconds
const channels = 2
const chordSeconds = 8
const crossfadeSeconds = 1.6
const chords = [
  [48, 55, 59, 64],
  [45, 52, 55, 60],
  [41, 48, 52, 57],
  [43, 50, 52, 57]
]

function frequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value))
  return x * x * (3 - 2 * x)
}

let seed = 0x4f524249
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0xffffffff
}

const left = new Float64Array(frameCount)
const right = new Float64Array(frameCount)
let filteredNoise = 0

for (let index = 0; index < frameCount; index += 1) {
  const time = index / sampleRate
  const chordIndex = Math.floor(time / chordSeconds) % chords.length
  const chordTime = time % chordSeconds
  const blend = smoothstep((chordTime - (chordSeconds - crossfadeSeconds)) / crossfadeSeconds)
  const chord = chords[chordIndex]
  const nextChord = chords[(chordIndex + 1) % chords.length]
  let padLeft = 0
  let padRight = 0

  for (let noteIndex = 0; noteIndex < chord.length; noteIndex += 1) {
    for (const [notes, weight] of [[chord, 1 - blend], [nextChord, blend]]) {
      const hz = frequency(notes[noteIndex])
      const phase = noteIndex * 0.83
      const slowMotion = 1 + Math.sin(time * 0.19 + noteIndex) * 0.018
      const fundamental = Math.sin(2 * Math.PI * hz * time + phase)
      const overtone = Math.sin(2 * Math.PI * hz * 2 * time + phase * 1.7) * 0.18
      const voice = (fundamental + overtone) * weight * slowMotion
      const pan = (noteIndex / (chord.length - 1) - 0.5) * 0.5
      padLeft += voice * (0.5 - pan)
      padRight += voice * (0.5 + pan)
    }
  }

  const beat = Math.floor(time)
  const beatTime = time - beat
  const melodyChord = chords[Math.floor(beat / chordSeconds) % chords.length]
  const melodyMidi = melodyChord[beat % melodyChord.length] + 12 + (beat % 8 === 7 ? 12 : 0)
  const pluckEnvelope = Math.exp(-beatTime * 4.2) * Math.sin(Math.PI * Math.min(1, beatTime * 8))
  const pluck = Math.sin(2 * Math.PI * frequency(melodyMidi) * beatTime) * pluckEnvelope
  const pluckPan = Math.sin(beat * 1.9) * 0.3

  filteredNoise += ((random() * 2 - 1) - filteredNoise) * 0.006
  const breath = filteredNoise * (0.35 + Math.sin(time * 0.31) * 0.12)
  const pulse = 0.82 + Math.sin(time * Math.PI / 4) * 0.08
  const boundaryFade = Math.min(1, time / 1.25, (durationSeconds - time) / 1.25)
  left[index] = (padLeft * 0.105 * pulse + pluck * 0.105 * (0.5 - pluckPan) + breath * 0.05) * boundaryFade
  right[index] = (padRight * 0.105 * pulse + pluck * 0.105 * (0.5 + pluckPan) + breath * 0.05) * boundaryFade
}

let peak = 0
for (let index = 0; index < frameCount; index += 1) {
  peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]))
}
const gain = peak > 0 ? 0.72 / peak : 1
const dataBytes = frameCount * channels * 2
const wav = Buffer.alloc(44 + dataBytes)
wav.write('RIFF', 0)
wav.writeUInt32LE(36 + dataBytes, 4)
wav.write('WAVE', 8)
wav.write('fmt ', 12)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(channels, 22)
wav.writeUInt32LE(sampleRate, 24)
wav.writeUInt32LE(sampleRate * channels * 2, 28)
wav.writeUInt16LE(channels * 2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(dataBytes, 40)

for (let index = 0; index < frameCount; index += 1) {
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[index] * gain)) * 32767), 44 + index * 4)
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[index] * gain)) * 32767), 46 + index * 4)
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, wav)
console.log(`Generated ${outputPath} (${wav.byteLength} bytes)`)
