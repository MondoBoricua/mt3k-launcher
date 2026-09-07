import { mainTranslations as dict } from './translations'
import { settingsStore } from './settingsStore'

type Key = keyof (typeof dict)['en']

export function t(key: Key, vars?: Record<string, string | number>): string {
  const language = settingsStore.get('language')
  let text: string = dict[language]?.[key] ?? dict.en[key]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, () => String(v))
    }
  }
  return text
}
