import fs from 'node:fs'
import path from 'node:path'

export interface CrossValidationResult {
  validator: 'CV-1' | 'CV-2' | 'CV-3'
  title: string
  findings: Finding[]
}

export interface Finding {
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  featureId: string
  description: string
}

/** CV-1: Round C 스크린샷에서 UI 이상 탐지 */
export async function runCV1UiCheck(roundCDir: string): Promise<CrossValidationResult> {
  const findings: Finding[] = []
  const screenshotDir = path.join(roundCDir, 'screenshots')

  if (fs.existsSync(screenshotDir)) {
    const featDirs = fs.readdirSync(screenshotDir)
    for (const feat of featDirs) {
      const featPath = path.join(screenshotDir, feat)
      const shots = fs.readdirSync(featPath).filter(f => f.endsWith('.png'))
      if (shots.length === 0) {
        findings.push({
          severity: 'P2',
          featureId: feat,
          description: `피처 ${feat}: 스크린샷이 생성되지 않음`,
        })
      }
    }
  } else {
    findings.push({ severity: 'P1', featureId: 'all', description: 'Round C 스크린샷 디렉토리가 존재하지 않음' })
  }

  return { validator: 'CV-1', title: 'UI/UX 스크린샷 완전성 검사', findings }
}

/** CV-2: Round A ↔ Round C 결과 비교 */
export async function runCV2RoundComparison(
  roundAReportPath: string,
  roundCReportPath: string
): Promise<CrossValidationResult> {
  const findings: Finding[] = []

  const readReport = (p: string): string =>
    fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : ''

  const reportA = readReport(roundAReportPath)
  const reportC = readReport(roundCReportPath)

  if (!reportA) {
    findings.push({ severity: 'P1', featureId: 'all', description: 'Round A 보고서가 존재하지 않음 — 비교 불가' })
    return { validator: 'CV-2', title: 'Round A↔C 결과 비교', findings }
  }
  if (!reportC) {
    findings.push({ severity: 'P1', featureId: 'all', description: 'Round C 보고서가 존재하지 않음 — 비교 불가' })
    return { validator: 'CV-2', title: 'Round A↔C 결과 비교', findings }
  }

  const failPattern = /피처 (\d+): ([^\n]+)/g
  const extractFails = (text: string, marker: string): string[] =>
    [...text.matchAll(new RegExp(`${marker} 피처 (\\d+): ([^\\n]+)`, 'g'))].map(m => `${m[1]}:${m[2]?.trim()}`)

  const failsA = extractFails(reportA, '❌')
  const failsC = extractFails(reportC, '❌')
  void failPattern // suppress unused warning

  // A 통과 → C 실패 = 비결정적 동작
  for (const f of failsC) {
    if (!failsA.includes(f)) {
      const [id] = f.split(':')
      findings.push({ severity: 'P1', featureId: id ?? '?', description: `비결정적 실패: Round A 통과 → Round C 실패 (${f})` })
    }
  }
  // A 실패 → C도 실패 = 지속적 버그
  for (const f of failsA) {
    if (failsC.includes(f)) {
      const [id] = f.split(':')
      findings.push({ severity: 'P2', featureId: id ?? '?', description: `지속적 실패: 두 라운드 모두 실패 (${f})` })
    }
  }

  return { validator: 'CV-2', title: 'Round A↔C 결과 비교', findings }
}

/** CV-3: 보고서의 경고 항목 → 문서 불일치 가능성 추출 */
export async function runCV3DocsCheck(
  roundCReportPath: string
): Promise<CrossValidationResult> {
  const findings: Finding[] = []
  const report = fs.existsSync(roundCReportPath)
    ? fs.readFileSync(roundCReportPath, 'utf-8')
    : ''

  const warnPattern = /⚠️ 피처 (\d+): ([^\n]+)/g
  for (const [, id, name] of report.matchAll(warnPattern)) {
    findings.push({
      severity: 'P3',
      featureId: id ?? '?',
      description: `${name?.trim() ?? '알 수 없음'}: 기능 부분 동작 — 문서·구현 불일치 확인 필요`,
    })
  }

  return { validator: 'CV-3', title: '문서↔실제 동작 불일치 탐지', findings }
}

export function buildCrossValidationReport(
  results: CrossValidationResult[],
  outputDir: string
): string {
  let md = `# 교차 검증 보고서\n\n생성: ${new Date().toISOString()}\n\n`

  for (const cv of results) {
    md += `## ${cv.validator}: ${cv.title}\n\n`
    if (cv.findings.length === 0) {
      md += `> ✅ 발견된 이슈 없음\n\n`
    } else {
      md += `| 심각도 | 피처 | 설명 |\n|---|---|---|\n`
      for (const f of cv.findings) {
        md += `| ${f.severity} | ${f.featureId} | ${f.description} |\n`
      }
      md += '\n'
    }
  }

  const cvDir = path.join(outputDir, 'cross-validation')
  fs.mkdirSync(cvDir, { recursive: true })
  const reportPath = path.join(cvDir, 'cv-report.md')
  fs.writeFileSync(reportPath, md, 'utf-8')
  return reportPath
}
