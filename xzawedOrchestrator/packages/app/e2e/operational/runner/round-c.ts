import { test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ScreenshotHelper, type FeatureResult } from '../helpers/screenshot-helper.js'
import { checkAllServices } from '../helpers/services-health.js'
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
import {
  runCV1UiCheck, runCV2RoundComparison, runCV3DocsCheck,
  buildCrossValidationReport,
} from './cross-validator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mainEntry = path.resolve(__dirname, '../../../out/main/index.js')
const TODAY = new Date().toISOString().slice(0, 10)
const ROUND_A_DIR = path.resolve(__dirname, `../../../../../docs/test-reports/${TODAY}/round-A`)
const ROUND_C_DIR = path.resolve(__dirname, `../../../../../docs/test-reports/${TODAY}/round-C`)

test('Wave 1 — 서비스 상태 재확인', async () => {
  const services = await checkAllServices()
  const unhealthy = services.filter(s => !s.healthy)
  if (unhealthy.length > 0) {
    console.warn(`⚠️ Wave 1: 비정상 서비스 ${unhealthy.map(s => s.name).join(', ')}`)
  } else {
    console.log('✅ Wave 1: 모든 서비스 정상')
  }
  // Wave 1은 경고만 기록, 실패로 중단하지 않음
})

test('Wave 2 — 전체 피처 재검증', async () => {
  fs.mkdirSync(ROUND_C_DIR, { recursive: true })

  const services = await checkAllServices()
  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SERVER_URL: process.env['SERVER_URL'] ?? 'http://localhost:3000',
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const ss = new ScreenshotHelper(ROUND_C_DIR)
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

  buildReport('C', services, results, ROUND_C_DIR)
  console.log('✅ Wave 2: Round C 피처 검증 완료')
})

test('Wave 3 — 교차 검증 + 최종 보고서', async () => {
  const cvResults = await Promise.all([
    runCV1UiCheck(ROUND_C_DIR),
    runCV2RoundComparison(
      path.join(ROUND_A_DIR, 'report-A.md'),
      path.join(ROUND_C_DIR, 'report-C.md'),
    ),
    runCV3DocsCheck(path.join(ROUND_C_DIR, 'report-C.md')),
  ])

  const cvReportPath = buildCrossValidationReport(cvResults, ROUND_C_DIR)

  const allFindings = cvResults.flatMap(r => r.findings)
  const p0 = allFindings.filter(f => f.severity === 'P0').length
  const p1 = allFindings.filter(f => f.severity === 'P1').length
  const p2 = allFindings.filter(f => f.severity === 'P2').length

  const reportDir = path.resolve(__dirname, `../../../../../docs/test-reports/${TODAY}`)
  const finalMd = `# 최종 검증 보고서

생성: ${new Date().toISOString()}

## 요약

| 라운드 | 보고서 |
|---|---|
| Round A | [report-A.md](./round-A/report-A.md) |
| Round C | [report-C.md](./round-C/report-C.md) |
| 교차 검증 | [cv-report.md](./round-C/cross-validation/cv-report.md) |

## 발견 이슈

| 심각도 | 건수 |
|---|---|
| P0 (Critical) | ${p0} |
| P1 (High) | ${p1} |
| P2 (Medium) | ${p2} |
| **총합** | **${allFindings.length}** |

${p0 > 0 ? '⚠️ **P0 이슈 발견 — 즉시 확인 필요**' : '✅ P0 이슈 없음'}

교차 검증 상세: [cv-report.md](${path.relative(reportDir, cvReportPath)})
`

  const finalPath = path.join(reportDir, 'final-report.md')
  fs.writeFileSync(finalPath, finalMd, 'utf-8')
  console.log(`\n🏁 최종 보고서: ${finalPath}`)
  console.log(`📊 발견 이슈: P0=${p0} P1=${p1} P2=${p2} 총=${allFindings.length}`)
})
