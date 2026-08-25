#!/usr/bin/env node
/**
 * prod compose 두 사본의 동일성 검사.
 *
 * `docker-compose.prod.yml` 은 저장소 루트와 `xzawedLauncher/packages/app/resources/` 에
 * **두 벌** 있다. Launcher 가 실제로 띄우는 것은 후자다 —
 * `docker-manager.ts` 가 `process.resourcesPath` 기준으로 열고
 * `electron-builder.config.ts` 의 `extraResources` 가 그 파일을 패키지에 넣는다.
 *
 * **그래서 루트만 고치면 사용자에게 나가는 스택은 안 고쳐진다.** 실제로 그럴 뻔했다 —
 * 두 파일은 250여 줄인데 의도된 차이는 단 한 줄이고, 그 동일성을 강제하는 장치가 없었다.
 *
 * 의도된 차이는 아래 `ALLOWED` 에 **쌍으로** 선언한다. 새 차이를 만들려면 여기 적어야 하고,
 * 적지 않은 차이는 드리프트로 보고 실패시킨다.
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const A = 'docker-compose.prod.yml'
const B = 'xzawedLauncher/packages/app/resources/docker-compose.prod.yml'

/**
 * 의도된 차이 — `{ a, b, why }`.
 *
 * Launcher 는 구독(CLI) 모드를 기본으로 띄운다. 루트 사본은 개발자가 직접 쓰는 것이라 API 모드다.
 * 이 차이는 orchestrator 의 키 요구 조건도 바꾼다(`CLAUDE_MODE=api` 일 때만 요구).
 */
const ALLOWED = [
  {
    a: '      CLAUDE_MODE: ${CLAUDE_MODE:-api}',
    b: '      CLAUDE_MODE: ${CLAUDE_MODE:-cli}',
    why: 'Launcher 는 구독(CLI) 모드 기본, 루트 사본은 API 모드 기본',
  },
]

/** CRLF/LF 차이는 드리프트가 아니다 — `core.autocrlf` 가 워킹트리에서 바꾼다. */
function readLines(rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) {
    console.error(`✗ 사본이 없다: ${rel}`)
    process.exit(1)
  }
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
}

const linesA = readLines(A)
const linesB = readLines(B)
const violations = []

if (linesA.length !== linesB.length) {
  violations.push(`줄 수 불일치: ${A}=${linesA.length} vs ${B}=${linesB.length}`)
}

const max = Math.min(linesA.length, linesB.length)
for (let i = 0; i < max; i += 1) {
  if (linesA[i] === linesB[i]) continue
  const allowed = ALLOWED.some((r) => r.a === linesA[i] && r.b === linesB[i])
  if (allowed) continue
  violations.push(
    `${i + 1}번째 줄이 어긋난다\n` +
    `    ${A}\n      ${linesA[i]}\n` +
    `    ${B}\n      ${linesB[i]}`,
  )
}

// 선언해 놓고 실제로는 같아진 예외는 죽은 규칙이다 — 지우라고 알린다.
for (const r of ALLOWED) {
  const hasA = linesA.includes(r.a)
  const hasB = linesB.includes(r.b)
  if (!hasA || !hasB) {
    violations.push(
      `선언된 예외가 더 이상 존재하지 않는다(ALLOWED 에서 지워라) — ${r.why}\n` +
      `    ${A} 에 "${r.a}" ${hasA ? '있음' : '없음'}\n` +
      `    ${B} 에 "${r.b}" ${hasB ? '있음' : '없음'}`,
    )
  }
}

if (violations.length > 0) {
  console.error('✗ prod compose 두 사본이 드리프트했다\n')
  for (const v of violations) console.error(`  ${v}\n`)
  console.error('  Launcher 가 띄우는 것은 resources/ 사본이다 — 루트만 고치면 사용자 스택은 그대로다.')
  console.error('  의도된 차이라면 scripts/check-compose-parity.js 의 ALLOWED 에 이유와 함께 선언하라.')
  process.exit(1)
}

console.log(`✓ prod compose 사본 2개 동일 (선언된 예외 ${ALLOWED.length}건)`)
