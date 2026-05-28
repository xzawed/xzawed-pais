// src/renderer/src/lib/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { detectLocale } from './detect-locale.js'

import koCommon from '../locales/ko/common.json'
import koApp from '../locales/ko/app.json'
import koUi from '../locales/ko/ui.json'
import enCommon from '../locales/en/common.json'
import enApp from '../locales/en/app.json'
import enUi from '../locales/en/ui.json'
import jaCommon from '../locales/ja/common.json'
import jaApp from '../locales/ja/app.json'
import jaUi from '../locales/ja/ui.json'

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      ko: { common: koCommon, app: koApp, ui: koUi },
      en: { common: enCommon, app: enApp, ui: enUi },
      ja: { common: jaCommon, app: jaApp, ui: jaUi },
    },
    lng: detectLocale(),
    fallbackLng: 'ko',
    defaultNS: 'app',
    ns: ['app', 'common', 'ui'],
    interpolation: { escapeValue: false },
  })
  .then(() => {
    document.documentElement.dataset['i18nReady'] = 'true'
  })
  .catch(() => {})

export default i18n
