import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ServerLocale = 'ko' | 'en' | 'ja'
const SERVER_LOCALES = new Set<ServerLocale>(['ko', 'en', 'ja'])

function loadLocaleFile(locale: ServerLocale): Record<string, string> {
  try {
    const base = dirname(fileURLToPath(import.meta.url))
    const filePath = join(base, '..', 'locales', locale, 'server.json')
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

const messages: Record<ServerLocale, Record<string, string>> = {
  ko: loadLocaleFile('ko'),
  en: loadLocaleFile('en'),
  ja: loadLocaleFile('ja'),
}

export function parseLocale(header: string | undefined): ServerLocale {
  if (!header) return 'ko'
  const lang = header.split(/[,;]/)[0]?.split('-')[0]?.toLowerCase() as ServerLocale
  return SERVER_LOCALES.has(lang) ? lang : 'ko'
}

export function t(key: string, locale: ServerLocale): string {
  return messages[locale]?.[key] ?? messages['ko']?.[key] ?? key
}

export function loadMessages(locale: ServerLocale, msgs: Record<string, string>): void {
  messages[locale] = msgs
}
