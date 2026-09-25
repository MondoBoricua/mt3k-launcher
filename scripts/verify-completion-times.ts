import assert from 'node:assert/strict'
import { completionTimesCacheMatches, completionTimesFallbackQuery, completionTimesQuery } from '../src/shared/completionTimesQuery.ts'

// Store names with trademark symbols must reach HowLongToBeat without them.
assert.equal(completionTimesQuery('LEGO® Batman™: Legacy of the Dark Knight'), 'LEGO Batman: Legacy of the Dark Knight')
assert.equal(completionTimesQuery('Call of Duty®: Modern Warfare® III'), 'Call of Duty: Modern Warfare III')
assert.equal(completionTimesQuery('ACE COMBAT™7: SKIES UNKNOWN'), 'ACE COMBAT 7: SKIES UNKNOWN', 'a glued symbol becomes a space')
assert.equal(completionTimesQuery('  Gears  of War:  Reloaded '), 'Gears of War: Reloaded')
assert.equal(completionTimesQuery('Deadpool – Merc with a Map Pack'), 'Deadpool - Merc with a Map Pack')
assert.equal(completionTimesQuery('MARVEL Tōkon: Fighting Souls'), 'MARVEL Tōkon: Fighting Souls', 'diacritics stay, HLTB matches them')
assert.equal(completionTimesQuery('SPORE™‎'), 'SPORE')

assert.equal(completionTimesQuery('Tom Clancy\u2019s Rainbow Six® Extraction'), "Tom Clancy's Rainbow Six Extraction", 'curly apostrophes become straight')

// Platform tags and edition suffixes only go in the second attempt.
const fallbacks: Array<[string, string | undefined]> = [
  ['Call of Duty®: Modern Warfare® II - Edición Estándar (Windows)', 'Call of Duty: Modern Warfare II'],
  ['Need for Speed™ Rivals: Edición Completa', 'Need for Speed Rivals'],
  ['Dragon Age™: Origins - Ultimate Edition', 'Dragon Age: Origins'],
  ['Dishonored® Definitive Edition (PC)', 'Dishonored Definitive Edition'],
  ['EA SPORTS FC™ 26 - PC', 'EA SPORTS FC 26'],
  ['Diablo® IV PC', 'Diablo IV'],
  ['theHunter: Call of the Wild™ - Windows 10', 'theHunter: Call of the Wild'],
  ['Call of Duty®: Black Ops 6 - Iniciador', 'Call of Duty: Black Ops 6'],
  ['Crysis® 2 Maximum Edition', 'Crysis 2'],
  ['Battlefield 4™ Edición Premium', 'Battlefield 4'],
  ['Los Sims™ 4 Edición EA Play', 'Los Sims 4'],
  ['Hades II', undefined],
  ['Mass Effect™ Legendary Edition', undefined]
]
for (const [name, expected] of fallbacks) assert.equal(completionTimesFallbackQuery(name), expected, name)

// A cached "unavailable" from the old, symbol-laden query must not block a retry with the cleaned one.
const stale = { state: 'unavailable' as const, fetchedAt: Date.now() }
assert.equal(completionTimesCacheMatches(stale, 'LEGO® Batman™: Legacy of the Dark Knight'), false)
const current = { state: 'unavailable' as const, query: 'LEGO Batman: Legacy of the Dark Knight', fetchedAt: Date.now() }
assert.equal(completionTimesCacheMatches(current, 'LEGO® Batman™: Legacy of the Dark Knight'), true)
assert.equal(completionTimesCacheMatches(current, 'LEGO Batman 2'), false, 'a renamed game gets a fresh lookup')
assert.equal(completionTimesCacheMatches({ state: 'available' }, 'anything'), true)

console.log('Completion-times query checks passed')
