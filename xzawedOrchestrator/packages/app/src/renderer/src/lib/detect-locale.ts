export type Locale = 'ko' | 'en' | 'ja'
export const LOCALES: Locale[] = ['ko', 'en', 'ja']

export function detectLocale(): Locale {
  const stored = localStorage.getItem('locale') as Locale | null
  if (stored && LOCALES.includes(stored)) return stored

  const navLang =
    typeof navigator !== 'undefined' && navigator.language
      ? navigator.language.split('-')[0] ?? ''
      : ''

  if (LOCALES.includes(navLang as Locale)) return navLang as Locale
  return 'ko'
}
