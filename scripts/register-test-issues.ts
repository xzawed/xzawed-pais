#!/usr/bin/env tsx
/**
 * 운영 E2E 검증 결과에서 실패/경고 항목을 GitHub 이슈로 등록한다.
 * 사용: npx tsx scripts/register-test-issues.ts [보고서-디렉토리]
 * 예시: npx tsx scripts/register-test-issues.ts docs/test-reports/2026-05-31
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const reportBaseDir = process.argv[2] ?? `docs/test-reports/${new Date().toISOString().slice(0, 10)}`

interface IssueEntry {
  round: string
  featureId: string
  featureName: string
  severity: string
  detail: string
}

function extractIssues(reportContent: string, round: string): IssueEntry[] {
  const issues: IssueEntry[] = []
  const lines = reportContent.split('\n')
  let currentFeature = { id: '', name: '' }

  for (const line of lines) {
    // 피처 헤더 파싱
    const featMatch = line.match(/###\s+[✅⚠️❌]\s+피처\s+(\d+):\s+(.+)/)
    if (featMatch) {
      currentFeature = { id: featMatch[1] ?? '', name: featMatch[2]?.trim() ?? '' }
      continue
    }

    // 실패 스텝
    if (line.includes('[✗]') && currentFeature.id) {
      const errMatch = line.match(/\[✗\]\s+([^—]+)(?:—\s*`([^`]+)`)?/)
      issues.push({
        round,
        featureId: currentFeature.id,
        featureName: currentFeature.name,
        severity: 'P1',
        detail: errMatch ? `${errMatch[1]?.trim() ?? ''}: ${errMatch[2] ?? ''}`.trim() : line.trim(),
      })
    }

    // 경고 스텝
    if (line.includes('[⚠]') && currentFeature.id) {
      const warnMatch = line.match(/\[⚠\]\s+([^—]+)(?:—\s*`([^`]+)`)?/)
      issues.push({
        round,
        featureId: currentFeature.id,
        featureName: currentFeature.name,
        severity: 'P2',
        detail: warnMatch ? `${warnMatch[1]?.trim() ?? ''}: ${warnMatch[2] ?? ''}`.trim() : line.trim(),
      })
    }
  }
  return issues
}

function createGithubIssue(entry: IssueEntry): void {
  const label = entry.severity === 'P1' ? 'bug:high' : 'bug:medium'
  const title = `[Round ${entry.round}] 피처 ${entry.featureId} — ${entry.featureName}: ${entry.severity}`
  const body = [
    '## 운영 E2E 검증 결과',
    '',
    `- **라운드:** Round ${entry.round}`,
    `- **피처:** ${entry.featureId} — ${entry.featureName}`,
    `- **심각도:** ${entry.severity}`,
    '',
    '## 상세',
    '',
    '```',
    entry.detail,
    '```',
    '',
    '## 재현 방법',
    '',
    '```bash',
    'cd xzawedOrchestrator/packages/app',
    `pnpm test:operational:round-${entry.round.toLowerCase()}`,
    '```',
    '',
    '---',
    '_자동 생성: 운영 E2E 검증 파이프라인_',
  ].join('\n')

  const safeTitle = title.replace(/"/g, "'")
  const safeBody = body.replace(/"/g, "'")

  try {
    const result = execSync(
      `gh issue create --title "${safeTitle}" --body "${safeBody}" --label "${label}"`,
      { stdio: 'pipe', encoding: 'utf-8' }
    )
    console.log(`✅ 이슈 등록: ${result.trim()}`)
  } catch (e) {
    console.warn(`⚠️ 이슈 등록 실패: ${safeTitle}\n  ${String(e)}`)
  }
}

// 중복 이슈 방지: 기존 이슈 제목 목록 조회
function getExistingIssueTitles(): Set<string> {
  try {
    const output = execSync('gh issue list --state open --limit 100 --json title', { encoding: 'utf-8' })
    const issues = JSON.parse(output) as Array<{ title: string }>
    return new Set(issues.map(i => i.title))
  } catch {
    return new Set()
  }
}

const existingTitles = getExistingIssueTitles()
let registeredCount = 0
let skippedCount = 0

for (const round of ['A', 'C']) {
  const roundDir = path.join(reportBaseDir, `round-${round}`)
  const reportPath = path.join(roundDir, `report-${round}.md`)

  if (!fs.existsSync(reportPath)) {
    console.log(`보고서 없음 (스킵): ${reportPath}`)
    continue
  }

  const content = fs.readFileSync(reportPath, 'utf-8')
  const issues = extractIssues(content, round)

  console.log(`\nRound ${round}: ${issues.length}건 발견`)

  for (const issue of issues) {
    const label = issue.severity === 'P1' ? 'bug:high' : 'bug:medium'
    const title = `[Round ${round}] 피처 ${issue.featureId} — ${issue.featureName}: ${issue.severity}`

    if (existingTitles.has(title)) {
      console.log(`  스킵 (중복): ${title}`)
      skippedCount++
      continue
    }

    void label
    createGithubIssue(issue)
    registeredCount++
  }
}

console.log(`\n🏁 완료: ${registeredCount}건 등록, ${skippedCount}건 중복 스킵`)
