// src/renderer/src/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { detectLocale } from './detect-locale.js'

import koCommon from '../locales/ko/common.json'
import koApp from '../locales/ko/app.json'
// en (Task 12에서 실제 번역 추가, 현재는 ko와 동일)
import enCommon from '../locales/ko/common.json'
import enApp from '../locales/ko/app.json'
// ja (Task 12에서 실제 번역 추가)
import jaCommon from '../locales/ko/common.json'
import jaApp from '../locales/ko/app.json'

void i18n.use(initReactI18next).init({
  resources: {
    ko: { common: koCommon, app: koApp },
    en: { common: enCommon, app: enApp },
    ja: { common: jaCommon, app: jaApp },
  },
  lng: detectLocale(),
  fallbackLng: 'ko',
  defaultNS: 'app',
  ns: ['app', 'common'],
  interpolation: { escapeValue: false },
})

export default i18n
