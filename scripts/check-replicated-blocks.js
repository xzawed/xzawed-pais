#!/usr/bin/env node
/**
 * 복제 블록 동일성 검사.
 *
 * 서비스끼리 직접 import할 수 없고(M3) 공유 라이브러리도 없는 조합에서는, 계약을
 * 복제하는 것 말고 선택이 없는 블록이 생긴다. 그런 블록에 마커를 달아 CPD 게이트를
 * 통과시키되 **동일성은 여기서 강제한다** — 마커만 달면 "허용"일 뿐 계약이 아니다.
 *
 *   // jscpd:ignore-start
 *   // replicated-block: <id>
 *   // <왜 복제인지>
 *   ...블록...
 *   // jscpd:ignore-end
 *
 * 같은 `<id>`를 가진 블록은 전부 바이트 동일해야 한다(들여쓰기 정규화 후).
 * 하나라도 어긋나면 non-zero로 종료한다.
 */
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const START = /^\s*\/\/\s*jscpd:ignore-start\s*$/
const END = /^\s*\/\/\s*jscpd:ignore-end\s*$/
const ID = /^\s*\/\/\s*replicated-block:\s*(\S+)\s*$/

/** 마커 사이의 본문만 뽑는다 — 주석 줄(설명)과 마커 자체는 제외한다. */
function extractBlocks(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)
  const out = []
  let i = 0
  while (i < lines.length) {
    if (!START.test(lines[i])) { i++; continue }
    let id = null
    let j = i + 1
    while (j < lines.length && /^\s*\/\//.test(lines[j])) {
      const m = ID.exec(lines[j])
      if (m) id = m[1]
      j++
    }
    const body = []
    while (j < lines.length && !END.test(lines[j])) { body.push(lines[j]); j++ }
    if (j >= lines.length) {
      console.error(`✗ ${file}: jscpd:ignore-start 에 대응하는 end 가 없습니다 (줄 ${i + 1})`)
      process.exitCode = 1
      return out
    }
    if (id !== null) out.push({ id, file, line: i + 1, body })
    i = j + 1
  }
  return out
}

/** 공통 들여쓰기를 제거해 위치가 달라도 비교 가능하게 한다. */
function normalize(body) {
  const nonEmpty = body.filter((l) => l.trim() !== '')
  if (nonEmpty.length === 0) return ''
  const indent = Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length))
  return body.map((l) => l.slice(indent)).join('\n').trimEnd()
}

const files = execSync('git ls-files "*.ts" "*.tsx"', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const groups = new Map()
for (const f of files) {
  for (const b of extractBlocks(f)) {
    if (!groups.has(b.id)) groups.set(b.id, [])
    groups.get(b.id).push(b)
  }
}

if (groups.size === 0) {
  console.log('복제 블록 없음 — 검사할 것이 없습니다')
  process.exit(process.exitCode ?? 0)
}

let bad = 0
for (const [id, blocks] of [...groups].sort()) {
  if (blocks.length < 2) {
    console.error(`✗ ${id}: 사본이 1개뿐입니다 (${blocks[0].file}:${blocks[0].line}) — 복제가 아니면 마커를 제거하세요`)
    bad++
    continue
  }
  const norm = blocks.map((b) => normalize(b.body))
  const first = norm[0]
  const diverged = blocks.filter((_, i) => norm[i] !== first)
  if (diverged.length > 0) {
    console.error(`✗ ${id}: 사본 ${blocks.length}개 중 ${diverged.length}개가 어긋납니다`)
    console.error(`    기준: ${blocks[0].file}:${blocks[0].line}`)
    for (const d of diverged) console.error(`    어긋남: ${d.file}:${d.line}`)
    bad++
    continue
  }
  console.log(`✓ ${id}: 사본 ${blocks.length}개 동일 (${blocks.map((b) => b.file.split('/').slice(-1)[0]).join(', ')})`)
}

if (bad > 0) {
  console.error(`\n복제 블록 ${bad}종이 어긋났습니다 — 한쪽만 고치면 계약이 갈라집니다`)
  process.exit(1)
}
console.log(`\n복제 블록 검사 통과 — ${groups.size}종`)
