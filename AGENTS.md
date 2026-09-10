# ORBIT project guidance

## Internationalization

- Treat localization as part of every user-facing change, not as follow-up work.
- ORBIT currently ships English (`en`), German (`de`), Spanish (`es`), and Russian (`ru`). Add or update every user-visible string in all four dictionaries in the same change.
- Put renderer copy behind typed translation keys and native/main-process copy in `src/main/translations.ts`; do not introduce hard-coded UI text.
- Preserve interpolation placeholders exactly across languages and use `languageLocale(...)` for dates, numbers, sorting, and regional URLs.
- When a feature involves text entry, layouts, external store metadata, or regional artwork, verify the behavior for every supported language and alphabet.
- Run `pnpm run verify:languages`, `pnpm run typecheck`, and the relevant live UI check after localization changes.
