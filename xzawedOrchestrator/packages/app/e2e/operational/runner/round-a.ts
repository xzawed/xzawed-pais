import { test } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ScreenshotHelper } from '../helpers/screenshot-helper.js'
import { checkAllServices, assertAllHealthy } from '../helpers/services-health.js'
import { buildReport } from '../helpers/report-builder.js'
import { launchElectronApp } from '../helpers/launch-electron.js'
import { runAllFeatures } from '../helpers/run-all-features.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.resolve(__dirname, '../../../out/main/index.js')

const TODAY = new Date().toISOString().slice(0, 10)
const ROUND_DIR = path.resolve(__dirname, `../../../../../docs/test-reports/${TODAY}/round-A`)

test('Round A — 전체 피처 순차 검증', async () => {
  fs.mkdirSync(ROUND_DIR, { recursive: true })

  // 0. 서비스 상태 확인
  const services = await checkAllServices()
  assertAllHealthy(services)
  console.log('✅ 모든 서비스 정상 확인')

  // 1. Electron 앱 실행
  const { app, page } = await launchElectronApp(mainEntry)

  const ss = new ScreenshotHelper(ROUND_DIR)
  let results
  try {
    results = await runAllFeatures(page, ss)
  } finally {
    await app.close()
  }

  // 보고서 생성
  const reportPath = buildReport('A', services, results, ROUND_DIR)
  console.log(`\n📄 Round A 보고서: ${reportPath}`)

  const failed = results.filter(r => r.status === 'fail')
  const warned = results.filter(r => r.status === 'warn')
  console.log(`✅ ${results.length - failed.length - warned.length}통과 / ⚠️ ${warned.length}우려 / ❌ ${failed.length}실패`)
})
