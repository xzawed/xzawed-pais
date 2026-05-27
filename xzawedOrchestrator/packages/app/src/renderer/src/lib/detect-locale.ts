export type Locale = 'ko' | 'en' | 'ja'
export const LOCALES: Locale[] = ['ko', 'en', 'ja']

export function detectLocale(): Locale {
  const stored = localStorage.getItem('locale') as Locale | null
  if (stored && LOCALES.includes(stored)) return stored
  const nav = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : ''
  if (LOCALES.includes(nav as Locale)) return nav as Locale
  return 'ko'
}
