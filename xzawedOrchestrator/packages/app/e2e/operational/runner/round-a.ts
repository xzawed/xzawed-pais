import { test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ScreenshotHelper, type FeatureResult } from '../helpers/screenshot-helper.js'
import { checkAllServices, assertAllHealthy } from '../helpers/services-health.js'
import { buildReport } from '../helpers/report-builder.js'
import { runFeat01AppInit } from '../features/feat-01-app-init.js'
import { runFeat02Auth } from '../features/feat-02-auth.js'
import { runFeat03Project } from '../features/feat-03-project.js'
import { runFeat04Message } from '../features/feat-04-message.js'
import { runFeat05Pipeline } from '../features/feat-05-pipeline.js'
import { runFeat06Github } from '../features/feat-06-github.js'
import { runFeat07Mcp } from '../features/feat-07-mcp.js'
import { runFeat08Plugin } from '../features/feat-08-plugin.js'
import { runFeat09Settings } from '../features/feat-09-settings.js'
import { runFeat10Palette } from '../features/feat-10-palette.js'
import { runFeat11Error } from '../features/feat-11-error.js'

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
  const env = { ...process.env } as Record<string, string>
  delete env['ELECTRON_RUN_AS_NODE']
  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...env,
      NODE_ENV: 'test',
      SERVER_URL: process.env['SERVER_URL'] ?? 'http://localhost:3000',
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const ss = new ScreenshotHelper(ROUND_DIR)
  const results: FeatureResult[] = []

  try {
    results.push(await runFeat01AppInit(page, ss))
    results.push(await runFeat02Auth(page, ss, {
      serverUrl: process.env['SERVER_URL'] ?? 'http://localhost:3000',
      email: process.env['TEST_EMAIL'] ?? 'test@example.com',
      password: process.env['TEST_PASSWORD'] ?? 'password123',
    }))
    results.push(await runFeat03Project(page, ss))
    results.push(await runFeat04Message(page, ss))
    results.push(await runFeat05Pipeline(page, ss))
    results.push(await runFeat06Github(page, ss))
    results.push(await runFeat07Mcp(page, ss))
    results.push(await runFeat08Plugin(page, ss))
    results.push(await runFeat09Settings(page, ss))
    results.push(await runFeat10Palette(page, ss))
    results.push(await runFeat11Error(page, ss))
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
