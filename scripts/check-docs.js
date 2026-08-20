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

if (failed > 0) {
  console.error(`\n문서 게이트 실패 — 위반 ${failed}건`)
  process.exit(1)
}
console.log(`\n문서 게이트 통과 — 마크다운 ${files.length}개 검사`)
