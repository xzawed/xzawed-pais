#!/usr/bin/env node
/**
 * 문서 불변식 게이트.
 *
 * 여기 있는 두 규칙은 저장소가 지금 0 위반으로 만족하는 것만 담는다.
 * "예외 목록을 달아야 통과하는 규칙"은 넣지 않는다 — 그 순간 게이트가
 * 규칙 축적기가 되고 아무도 안 읽게 된다.
 *
 * 1. 상대 마크다운 링크는 전부 실존해야 한다.
 * 2. CLAUDE.md는 200줄을 넘지 않는다(Anthropic 권장 상한).
 * 3. CLAUDE.md는 이력 마커를 담지 않는다(날짜·PR번호·"머지 완료"류).
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CLAUDE_MD_MAX_LINES = 200

/** 설계 스펙 아카이브. 날짜-주제 파일이 서로를 가리켜 링크 검사 대상이 아니다. */
const LINK_SCAN_EXCLUDE = ['docs/superpowers/']

function trackedMarkdown() {
  const out = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

/** 펜스 안 링크는 렌더되지 않으므로 검사 대상이 아니다. */
function stripFences(src) {
  return src.replace(/^```[\s\S]*?^```/gm, '')
}

function checkLinks(files) {
  const violations = []
  const targets = files.filter((f) => !LINK_SCAN_EXCLUDE.some((p) => f.startsWith(p)))

  for (const file of targets) {
    if (!fs.existsSync(file)) continue
    const body = stripFences(fs.readFileSync(file, 'utf8'))
    const lines = body.split('\n')

    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const target = m[1]
        if (/^(?:https?:|mailto:)/.test(target)) continue
        const resolved = path.resolve(path.dirname(file), target)
        if (!fs.existsSync(resolved)) {
          violations.push(`${file}:${i + 1}  →  ${target}`)
        }
      }
    })
  }
  return violations
}

/**
 * 산문에서만 이력 마커를 찾는다 — 링크 대상은 벗겨낸다.
 *
 * `[설계 스펙](../docs/superpowers/specs/2026-07-18-x.md)` 같은 링크는 정당하다.
 * 파일명에 날짜가 박힌 것은 그 파일의 이름이지 이 문서가 주장하는 날짜가 아니다.
 */
function stripLinkTargets(src) {
  return src.replace(/\]\([^)]*\)/g, ']()')
}

/**
 * CLAUDE.md에 이력 마커가 없어야 한다.
 *
 * 이 규칙이 있는 이유는 한 파일이 159 KB까지 자랐기 때문이다 — 그 중 70%가
 * "PR #NNN 머지 완료" 연대기였다. CLAUDE.md는 매 세션 로드되므로 연대기가
 * 자라면 그 비용을 매번 낸다. 무엇이 언제 들어왔는지는 git log가 정본이다.
 *
 * 예외 목록을 두지 않는다. 현재 12개 파일 전부 0이고, 예외를 달아야 통과하는
 * 규칙은 게이트가 아니라 규칙 축적기가 된다.
 */
function checkClaudeMdHistoryMarkers(files) {
  const violations = []
  const PATTERNS = [
    [/\b\d{4}-\d{2}-\d{2}\b/, '절대 날짜'],
    [/#\d{2,4}\b/, 'PR 번호'],
    [/머지 완료|구현 완료\)|PR ~?#/, '연대기 표현'],
  ]
  for (const file of files.filter((f) => path.basename(f) === 'CLAUDE.md')) {
    if (!fs.existsSync(file)) continue
    const body = stripLinkTargets(stripFences(fs.readFileSync(file, 'utf8')))
    body.split('\n').forEach((line, i) => {
      for (const [re, label] of PATTERNS) {
        const m = re.exec(line)
        if (m) violations.push(`${file}:${i + 1}  ${label} "${m[0]}"`)
      }
    })
  }
  return violations
}

function checkClaudeMdSize(files) {
  const violations = []
  for (const file of files.filter((f) => path.basename(f) === 'CLAUDE.md')) {
    if (!fs.existsSync(file)) continue
    const n = fs.readFileSync(file, 'utf8').split('\n').length - 1
    if (n > CLAUDE_MD_MAX_LINES) {
      violations.push(`${file}  ${n}줄 (상한 ${CLAUDE_MD_MAX_LINES})`)
    }
  }
  return violations
}

function report(title, violations) {
  if (violations.length === 0) {
    console.log(`✓ ${title}`)
    return 0
  }
  console.error(`✗ ${title} — ${violations.length}건`)
  for (const v of violations) console.error(`    ${v}`)
  return violations.length
}

const files = trackedMarkdown()
let failed = 0
failed += report('상대 마크다운 링크 실존', checkLinks(files))
failed += report(`CLAUDE.md ${CLAUDE_MD_MAX_LINES}줄 이하`, checkClaudeMdSize(files))
failed += report('CLAUDE.md 이력 마커 없음', checkClaudeMdHistoryMarkers(files))

if (failed > 0) {
  console.error(`\n문서 게이트 실패 — 위반 ${failed}건`)
  process.exit(1)
}
console.log(`\n문서 게이트 통과 — 마크다운 ${files.length}개 검사`)
