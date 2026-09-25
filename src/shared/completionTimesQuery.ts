/**
 * HowLongToBeat's search ignores titles that carry trademark symbols
 * ("LEGO® Batman™: Legacy of the Dark Knight" returns nothing while
 * "LEGO Batman: Legacy of the Dark Knight" matches), and store names often add
 * platform tags and edition suffixes ("- Edición Estándar (Windows)") that its
 * catalog never uses. The lookup sends a cleaned query first and, when that
 * finds nothing, a second one with the edition suffix removed. Checked against
 * the 187 symbol-bearing titles of a real 1,500-game library on 2026-09-24.
 * Curly apostrophes also miss ("Tom Clancy’s" vs "Tom Clancy's").
 */
const TRADEMARK_SYMBOLS = /[®™©℠℗‎‏]/gu
const DASHES = /[‐-―−]/gu
const CURLY_APOSTROPHES = /[\u2018\u2019\u02BC]/gu
const PLATFORM_TAG = /\s*[([](?:PC|Windows(?: 10)?|Steam|Xbox)[)\]]\s*$/iu
const PLATFORM_SUFFIX = /\s*[-:]?\s*\b(?:PC|Windows 10|Windows)\s*$/iu
const EDITION_AFTER_DASH = /\s*-\s*(?:Edición|Edicion|Edition|Iniciador|Lote\b|Inhaltspaket\b|Standard Edition\b).*$/iu
const EDITION_WORDS_ES = /\s+(?:Edición|Edicion)\s+(?:Estándar|Estandar|Deluxe|Premium|Completa|Definitiva|Ultimate|Especial|Cross-Gen|de Celebración|EA Play|Juego del año)\b.*$/iu
const EDITION_WORDS_EN = /\s+(?:Standard|Deluxe|Premium|Ultimate|Ultimate Evil|Complete|Year 2|Elite|Special|Cross-Gen|Maximum|Digital)\s+Edition\b.*$/iu
const TRAILING_PUNCTUATION = /[\s:,\-–]+$/u

function tidy(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/\s+([:,)])/gu, '$1')
    .replace(TRAILING_PUNCTUATION, '')
    .trim()
}

/** Store name → the query sent to HowLongToBeat first. */
export function completionTimesQuery(name: string): string {
  return tidy(name.replace(TRADEMARK_SYMBOLS, ' ').replace(DASHES, '-').replace(CURLY_APOSTROPHES, "'"))
}

/** Second attempt without platform tags and edition suffixes; undefined when it would not differ. */
export function completionTimesFallbackQuery(name: string): string | undefined {
  const primary = completionTimesQuery(name)
  const stripped = tidy(
    primary
      .replace(PLATFORM_TAG, '')
      .replace(EDITION_AFTER_DASH, '')
      .replace(EDITION_WORDS_ES, '')
      .replace(EDITION_WORDS_EN, '')
      .replace(PLATFORM_SUFFIX, '')
  )
  return stripped && stripped !== primary ? stripped : undefined
}

/** A cached "no estimate" answer only counts when it came from the query we would send now. */
export function completionTimesCacheMatches(
  cached: { state: 'available' | 'unavailable'; query?: string },
  name: string
): boolean {
  if (cached.state === 'available') return true
  return cached.query === completionTimesQuery(name)
}
