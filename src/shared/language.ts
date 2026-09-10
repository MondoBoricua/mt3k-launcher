export const LANGUAGES = ['en', 'de', 'es', 'ru'] as const
export type Language = (typeof LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'en'

export const LANGUAGE_OPTIONS: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' }
]

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && LANGUAGES.includes(value as Language)
}

export function normalizeLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE
}

export function languageLocale(value: unknown): string {
  return { en: 'en-US', de: 'de-DE', es: 'es-ES', ru: 'ru-RU' }[normalizeLanguage(value)]
}

export function steamLanguage(value: unknown): string {
  return { en: 'english', de: 'german', es: 'spanish', ru: 'russian' }[normalizeLanguage(value)]
}

export function languageCountry(value: unknown): string {
  return { en: 'US', de: 'DE', es: 'ES', ru: 'RU' }[normalizeLanguage(value)]
}

export function acceptLanguages(value: unknown): string {
  const language = normalizeLanguage(value)
  return language === 'en' ? 'en-US,en' : `${languageLocale(language)},${language},en-US,en`
}
