// src/renderer/src/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { detectLocale } from './detect-locale.js'

import koCommon from '../locales/ko/common.json'
import koApp from '../locales/ko/app.json'
import enCommon from '../locales/en/common.json'
import enApp from '../locales/en/app.json'
import jaCommon from '../locales/ja/common.json'
import jaApp from '../locales/ja/app.json'

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
