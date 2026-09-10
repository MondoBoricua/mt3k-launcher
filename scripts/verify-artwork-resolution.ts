import assert from 'node:assert/strict'
import {
  ARTWORK_RESOLUTION_TARGETS,
  assessArtworkResolution
} from '../src/shared/artworkResolution.ts'

assert.deepEqual(ARTWORK_RESOLUTION_TARGETS.vertical, { width: 600, height: 900 })
assert.deepEqual(ARTWORK_RESOLUTION_TARGETS.horizontal, { width: 1600, height: 900 })
assert.deepEqual(ARTWORK_RESOLUTION_TARGETS.logo, { width: 1200, height: 400 })
assert.deepEqual(ARTWORK_RESOLUTION_TARGETS.icon, { width: 512, height: 512 })

assert.equal(assessArtworkResolution(600, 900, 'vertical').quality, 'optimal')
assert.equal(assessArtworkResolution(480, 720, 'vertical').quality, 'good')
assert.equal(assessArtworkResolution(300, 450, 'vertical').quality, 'usable')
assert.equal(assessArtworkResolution(3840, 2160, 'vertical').quality, 'low')
assert.equal(
  assessArtworkResolution(1920, 620, 'horizontal').quality,
  'good',
  'Steam hero key art remains a good ORBIT background after its visible fill crop'
)
assert.equal(assessArtworkResolution(1600, 900, 'horizontal').quality, 'optimal')
assert.equal(assessArtworkResolution(1200, 400, 'logo').quality, 'optimal')
assert.equal(assessArtworkResolution(512, 512, 'icon').quality, 'optimal')
assert.equal(assessArtworkResolution(undefined, undefined, 'icon').quality, 'unknown')
assert.equal(assessArtworkResolution(600, 900, 'vertical').megapixels, 0.54)

console.log('Artwork resolution targets, crop awareness and quality levels passed')
