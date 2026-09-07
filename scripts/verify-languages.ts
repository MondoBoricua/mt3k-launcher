import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { translations, translate } from '../src/renderer/src/i18n/translations.ts'
import { mainTranslations } from '../src/main/translations.ts'
import {
  LANGUAGES, LANGUAGE_OPTIONS, DEFAULT_LANGUAGE, isLanguage, normalizeLanguage,
  languageLocale, languageCountry, steamLanguage, acceptLanguages
} from '../src/shared/language.ts'
import { localizedStoreRegion, STORE_REGIONS } from '../src/main/store/storeRegions.ts'

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\w+\}/g)].map(([match]) => match).sort()
}

for (const dictionary of [translations, mainTranslations]) {
  const canonical = dictionary.en as Record<string, string>
  for (const language of LANGUAGES) {
    const localized = dictionary[language] as Record<string, string>
    assert.deepEqual(Object.keys(localized).sort(), Object.keys(canonical).sort(), language)
    for (const [key, value] of Object.entries(localized)) {
      assert.ok(value.trim(), `${language}: ${key} is empty`)
      assert.deepEqual(placeholders(value), placeholders(canonical[key]), `${language}: ${key}`)
      assert.ok(!/\uFFFD|Ã±|Ã³|Ã¡|Â¿/.test(value), `${language}: ${key} encoding`)
    }
  }
}

assert.equal(DEFAULT_LANGUAGE, 'en')
for (const value of [undefined, null, '', 'fr', 'ES', 'es-ES', {}, 1]) {
  assert.equal(isLanguage(value), false)
  assert.equal(normalizeLanguage(value), 'en')
}
assert.deepEqual(LANGUAGE_OPTIONS.map(({ id }) => id), [...LANGUAGES])
assert.equal(LANGUAGE_OPTIONS.find(({ id }) => id === 'es')?.label, 'Español')
assert.equal(translate('es', 'nav.settings'), 'Ajustes')
assert.equal(translate('es', 'onboarding.success.titleWithName', { name: '$& {name}' }), '¡Bienvenido, $& {name}!')
assert.equal(translate('invalid' as 'en', 'nav.home'), translations.en['nav.home'])
assert.equal(languageLocale('es'), 'es-ES')
assert.equal(languageCountry('es'), 'ES')
assert.equal(steamLanguage('es'), 'spanish')
assert.equal(acceptLanguages('es'), 'es-ES,es,en-US,en')
assert.equal(new Intl.NumberFormat(languageLocale('es')).format(12345.67), '12.345,67')
assert.equal(new Intl.DateTimeFormat(languageLocale('es'), { month: 'long', timeZone: 'UTC' }).format(new Date('2026-09-07T12:00:00Z')), 'septiembre')
for (const region of Object.keys(STORE_REGIONS) as (keyof typeof STORE_REGIONS)[]) {
  const localized = localizedStoreRegion(region, 'es')
  assert.equal(localized.steamLanguage, 'spanish')
  assert.equal(localized.countryCode, STORE_REGIONS[region].countryCode)
  assert.equal(localized.currency, STORE_REGIONS[region].currency)
}
assert.match(readFileSync('src/renderer/index.html', 'utf8'), /<html lang="en">/)

// Exercise the actual cache class with deferred provider responses. No account,
// network or user database is involved.
const achievementSource = readFileSync('src/main/achievements/achievementService.ts', 'utf8')
const cacheClass = achievementSource.slice(
  achievementSource.indexOf('export class AchievementService'),
  achievementSource.indexOf('export const achievementService')
).replace('export class', 'class')
const settings = { store: { language: 'de' } }
const database = { snapshots: {} as Record<string, unknown> }
const responses: Array<(snapshot: object) => void> = []
const Cache = new Function(
  'settingsStore', 'databaseState', 'normalizeLanguage', 'fresh',
  'fetchProviderAchievements', 'scheduleDatabasePersist',
  `return ${stripTypeScriptTypes(cacheClass)}`
)(settings, database, normalizeLanguage, () => true,
  () => new Promise(resolve => responses.push(resolve)), () => {})
const cache = new Cache()
const game = { id: 'steam:1', provider: 'steam', appId: 1 }
const germanRequest = cache.resolve(game)
assert.equal(cache.resolve(game), germanRequest, 'Same language shares an in-flight request')
settings.store.language = 'es'
const spanishRequest = cache.resolve(game)
assert.equal(responses.length, 2, 'New language requests new achievement text')
responses[1]({ gameId: game.id, state: 'available', achievements: [{ name: 'Primer paso' }] })
await spanishRequest
responses[0]({ gameId: game.id, state: 'available', achievements: [{ name: 'Erster Schritt' }] })
await germanRequest
assert.equal(cache.get(game.id).language, 'es', 'Late German results do not overwrite Spanish')
assert.equal((await cache.resolve(game)).achievements[0].name, 'Primer paso')
assert.equal(responses.length, 2, 'Fresh localized achievements are reused')
console.log(`Languages: ${Object.keys(translations.en).length} UI entries and ${Object.keys(mainTranslations.en).length} native entries per language; key/placeholder parity, encoding, defaults, fallback, interpolation and regional formatting passed.`)
