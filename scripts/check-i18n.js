#!/usr/bin/env node
// scripts/check-i18n.js
// ko/en/ja 로케일 파일의 키 동기화를 검증한다.
// 사용법: node scripts/check-i18n.js
// CI: i18n-check 잡에서 자동 실행
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP_LOCALES = path.join(ROOT, 'xzawedOrchestrator/packages/app/src/renderer/src/locales')
const SERVER_LOCALES = path.join(ROOT, 'xzawedOrchestrator/packages/server/src/locales')
const UI_LOCALES = path.join(ROOT, 'xzawedOrchestrator/packages/ui/src/locales')

function flatKeys(obj, prefix = '') {
  const keys = []
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flatKeys(v, full))
    } else {
      keys.push(full)
    }
  }
  return keys
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (e) {
    console.error(`❌ JSON 파싱 오류: ${filePath}\n   ${e.message}`)
    process.exit(1)
  }
}

function checkParity(label, files) {
  const loaded = {}
  const missing = []

  for (const [locale, filePath] of Object.entries(files)) {
    const data = loadJson(filePath)
    if (!data) {
      missing.push(locale)
    } else {
      loaded[locale] = flatKeys(data)
    }
  }

  if (missing.length > 0) {
    console.warn(`⚠️  [${label}] 파일 없음: ${missing.join(', ')} — 건너뜁니다`)
    return { errors: 0, checked: false }
  }

  const locales = Object.keys(loaded)
  const base = locales[0]
  const baseKeys = loaded[base]
  let errors = 0

  for (let i = 1; i < locales.length; i++) {
    const other = locales[i]
    const otherKeys = loaded[other]
    const missingInOther = baseKeys.filter(k => !otherKeys.includes(k))
    const extraInOther = otherKeys.filter(k => !baseKeys.includes(k))

    for (const key of missingInOther) {
      console.error(`  ❌ [${label}/${other}] 누락: "${key}"`)
      errors++
    }
    for (const key of extraInOther) {
      console.error(`  ❌ [${label}/${other}] 잉여(${base}에 없음): "${key}"`)
      errors++
    }
  }

  if (errors === 0) {
    console.log(`  ✅ [${label}] ${baseKeys.length}개 키 일치 (${locales.join('/')})`)
  }

  return { errors, checked: true }
}

const CHECKS = [
  {
    label: 'app/app.json',
    files: {
      ko: path.join(APP_LOCALES, 'ko/app.json'),
      en: path.join(APP_LOCALES, 'en/app.json'),
      ja: path.join(APP_LOCALES, 'ja/app.json'),
    },
  },
  {
    label: 'app/common.json',
    files: {
      ko: path.join(APP_LOCALES, 'ko/common.json'),
      en: path.join(APP_LOCALES, 'en/common.json'),
      ja: path.join(APP_LOCALES, 'ja/common.json'),
    },
  },
  {
    label: 'server/server.json',
    files: {
      ko: path.join(SERVER_LOCALES, 'ko/server.json'),
      en: path.join(SERVER_LOCALES, 'en/server.json'),
      ja: path.join(SERVER_LOCALES, 'ja/server.json'),
    },
  },
  {
    label: 'ui/ui.json',
    files: {
      ko: path.join(UI_LOCALES, 'ko/ui.json'),
      en: path.join(UI_LOCALES, 'en/ui.json'),
      ja: path.join(UI_LOCALES, 'ja/ui.json'),
    },
  },
]

console.log('i18n 키 동기화 검사 중...')
let totalErrors = 0

for (const check of CHECKS) {
  const { errors } = checkParity(check.label, check.files)
  totalErrors += errors
}

if (totalErrors > 0) {
  console.error(`\n❌ ${totalErrors}개 키 불일치 발견. ko/en/ja 파일을 동기화한 후 다시 실행하세요.`)
  process.exit(1)
}

console.log('\n✅ 모든 i18n 키 동기화 확인 완료')
