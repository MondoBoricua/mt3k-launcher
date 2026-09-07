import assert from 'node:assert/strict'
import postcss from 'postcss'
import textScale from './postcss-text-scale.mjs'
import { isTextScale, normalizeTextScale } from '../src/shared/textScale.ts'

for (const invalid of [undefined, null, '125', NaN, Infinity, 99, 151, 125.5]) {
  assert.equal(isTextScale(invalid), false)
}
for (const valid of [100, 101, 125, 150]) assert.equal(isTextScale(valid), true)
assert.equal(normalizeTextScale(undefined), 100)
assert.equal(normalizeTextScale('125'), 100)
assert.equal(normalizeTextScale(Infinity), 100)
assert.equal(normalizeTextScale(20), 100)
assert.equal(normalizeTextScale(800), 150)
assert.equal(normalizeTextScale(124.7), 125)

const original = `
body { font-size: 1rem; padding: 1rem; }
.small { font-size: 10px; line-height: 14px; }
.heading { font-size: clamp(1rem, 2vw, 2rem); line-height: 1.2; }
.child { font-size: 0.8em; line-height: 1.5em; }
.relative { font-size: 80%; line-height: 150%; }
.inherit { font-size: inherit; line-height: normal; }
`
const result = await postcss([textScale()]).process(original, { from: undefined })
const values = {}
result.root.walkRules(rule => {
  values[rule.selector] = {}
  rule.walkDecls(decl => { values[rule.selector][decl.prop] = decl.value })
})
assert.equal(values.body.padding, '1rem')
assert.equal(values['.small']['font-size'], 'calc((10px) * var(--orbit-text-scale, 1))')
assert.equal(values['.small']['line-height'], 'calc((14px) * var(--orbit-text-scale, 1))')
assert.equal(values['.heading']['font-size'], 'calc((clamp(1rem, 2vw, 2rem)) * var(--orbit-text-scale, 1))')
assert.equal(values['.heading']['line-height'], '1.2')
assert.equal(values['.child']['font-size'], '0.8em')
assert.equal(values['.child']['line-height'], '1.5em')
assert.equal(values['.relative']['font-size'], '80%')
assert.equal(values['.inherit']['font-size'], 'inherit')
assert.equal((await postcss([textScale()]).process(result.css, { from: undefined })).css, result.css)
console.log('Text scale: bounds, legacy defaults, absolute/relative typography, line heights, stable layout units and idempotent CSS processing passed.')
