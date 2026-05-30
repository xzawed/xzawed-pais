import type { FeatureResult } from './screenshot-helper'
import type { ServiceStatus } from './services-health'
import fs from 'node:fs'
import path from 'node:path'

export function buildReport(
  round: 'A' | 'C',
  services: ServiceStatus[],
  features: FeatureResult[],
  outputDir: string
): string {
  const now = new Date().toISOString()
  const passed = features.filter(f => f.status === 'pass').length
  const failed = features.filter(f => f.status === 'fail').length
  const warned = features.filter(f => f.status === 'warn').length

  const serviceRows = services
    .map(s => `| ${s.name} | ${s.port} | ${s.healthy ? '성공' : '실패'} | ${s.responseMs}ms |`)
    .join('\n')

  const featureRows = features.map(f => {
    const icon = f.status === 'pass' ? '[통과]' : f.status === 'warn' ? '[우려]' : '[실패]'
    const steps = f.steps.map(s => {
      const si = s.status === 'pass' ? 'v' : s.status === 'skip' ? '-' : 'x'
      const shot = s.screenshotPath ? ` [스크린샷](${path.relative(outputDir, s.screenshotPath)})` : ''
      const err = s.error ? ` -- \`${s.error.slice(0, 80)}\`` : ''
      return `  - [${si}] ${s.name}${shot}${err}`
    }).join('\n')
    return `### ${icon} 피처 ${f.featureId}: ${f.featureName}\n\n**소요:** ${f.durationMs}ms\n\n${steps}\n`
  }).join('\n')

  const md = `# Round ${round} 검증 보고서

**생성 시각:** ${now}
**결과 요약:** 통과 ${passed} / 실패 ${failed} / 우려 ${warned}

---

## 서비스 상태

| 서비스 | 포트 | 상태 | 응답시간 |
|---|---|---|---|
${serviceRows}

---

## 피처별 결과

${featureRows}
`

  const reportPath = path.join(outputDir, `report-${round}.md`)
  fs.writeFileSync(reportPath, md, 'utf-8')
  return reportPath
}
