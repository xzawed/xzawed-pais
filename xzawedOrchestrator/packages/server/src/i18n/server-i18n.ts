export type ServerLocale = 'ko' | 'en' | 'ja'
const SERVER_LOCALES: ServerLocale[] = ['ko', 'en', 'ja']

// 메시지 딕셔너리 (loadMessages()로 locale 파일 등록 가능)
const messages: Record<ServerLocale, Record<string, string>> = {
  ko: {},
  en: {},
  ja: {},
}

export function parseLocale(header: string | undefined): ServerLocale {
  if (!header) return 'ko'
  const lang = header.split(/[,;]/)[0]?.split('-')[0]?.toLowerCase() as ServerLocale
  return SERVER_LOCALES.includes(lang) ? lang : 'ko'
}

export function t(key: string, locale: ServerLocale): string {
  return messages[locale]?.[key] ?? messages['ko']?.[key] ?? key
}

export function loadMessages(locale: ServerLocale, msgs: Record<string, string>): void {
  messages[locale] = msgs
}
