#!/usr/bin/env node
/**
 * prod compose 두 사본의 동일성 검사.
 *
 * `docker-compose.prod.yml` 은 저장소 루트와 `xzawedLauncher/packages/app/resources/` 에
 * **두 벌** 있다. Launcher 가 실제로 띄우는 것은 후자다 —
 * `docker-manager.ts` 가 `process.resourcesPath` 기준으로 열고
 * `electron-builder.ts` 의 `extraResources` 가 그 파일을 패키지에 넣는다.
 *
 * **그래서 루트만 고치면 사용자에게 나가는 스택은 안 고쳐진다.** 실제로 그럴 뻔했다 —
 * 두 파일은 250여 줄인데 의도된 차이는 단 한 줄이고, 그 동일성을 강제하는 장치가 없었다.
 *
 * 의도된 차이는 아래 `ALLOWED` 에 **쌍으로** 선언한다. 새 차이를 만들려면 여기 적어야 하고,
 * 적지 않은 차이는 드리프트로 보고 실패시킨다.
 *
 * **두 사본이 같다는 것만으로는 부족하다 — 패키지에 실제로 들어가야 한다.** 이 파일은
 * `electron-builder.config.ts` 라는 이름이었는데 electron-builder 는 그 이름을 **자동 탐색하지
 * 않는다**(탐색 대상은 `electron-builder.{yml,yaml,json,json5,toml,js,cjs,mjs,ts}`). 릴리스
 * 워크플로 3개 잡이 전부 `--config` 없이 부르고 있어서 설정이 통째로 무시됐고, 그 결과
 * `extraResources` 가 적용되지 않아 **출하된 앱의 `resources/` 에 compose 파일이 아예 없었다**
 * (`app-update.yml`·`appId`·`productName`·mac/linux 타깃도 같이 증발했다). 이 게이트가 두
 * 사본의 동일성만 재고 있는 동안 그중 어느 것도 사용자에게 닿지 않았다. 그래서 아래
 * `checkPackagingReach` 가 "설정이 탐색되는 이름인가 + compose 를 실제로 넣는가"를 함께 본다.
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

/**
 * electron-builder 26 이 **인자 없이** 찾아내는 설정 파일 이름.
 * 정본은 `app-builder-lib/out/util/config/load.js` 의 탐색 루프다 — `.mjs` 는 **여기 없다**
 * (같은 파일 위쪽에서 파싱은 되지만 그건 `--config` 로 경로를 직접 줬을 때뿐이다).
 * 이 목록을 늘릴 때는 추측하지 말고 그 루프를 다시 읽는다.
 */
const DISCOVERABLE = ['yml', 'yaml', 'json', 'json5', 'toml', 'js', 'cjs', 'ts']
  .map((ext) => `electron-builder.${ext}`)

const APP_DIR = 'xzawedLauncher/packages/app'

/**
 * 설정이 **읽히기는 하는가**만 본다 — 파일 이름과 `build` 키의 존재라는 두 사실뿐이고,
 * 둘 다 문자열 파싱 없이 정확히 판정된다.
 *
 * **설정의 내용은 여기서 검사하지 않는다.** 한때 `extraResources` 를 정규식으로 읽어
 * compose 도착지를 판정했는데, 반증에서 거짓 통과 5경로(`to: 'sub/dir/…'` 가 basename 만
 * 봐서 통과하는 것 등)와 거짓 실패 8경로(YAML 리스트·TOML·`to: '.'`·필터 배열의 `]` 등)가
 * 나왔다. TS·YAML·TOML·JSON 을 다 감당하는 정규식은 없다. **내용 계약은 설정 객체를
 * 실제로 import 할 수 있는 곳에 둔다** — `packages/app/test/main/compose-posture.test.ts` 가
 * `extraResources` 도착지와 `artifactName` 안전성을 그 객체로 검사한다.
 */
function checkPackagingReach() {
  const out = []
  const dir = path.join(ROOT, APP_DIR)
  const present = fs.existsSync(dir) ? fs.readdirSync(dir) : []
  const configs = present.filter((f) => /^electron-builder\./.test(f))
  const discoverable = configs.filter((f) => DISCOVERABLE.includes(f))

  let build
  try {
    build = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).build
  } catch { /* package.json 부재는 아래에서 설정 부재로 잡힌다 */ }

  if (build !== undefined) {
    out.push(
      `${APP_DIR}/package.json 에 build 키가 있다` +
      `${discoverable.length ? ` — ${discoverable.join(', ')} 를 가린다` : ''}.\n` +
      `    electron-builder 는 build 키가 있으면 **그것만** 읽는다(loadConfig 가 배타적으로 쓴다).\n` +
      `    파일 쪽을 고쳐도 반영되지 않고, 위 테스트가 검사하는 것도 파일 쪽이다 — 둘 중 하나만 남겨라.`,
    )
    return out
  }

  if (discoverable.length === 0) {
    out.push(
      `${APP_DIR} 의 electron-builder 설정이 자동 탐색되지 않는 이름이다: ` +
      `${configs.length ? configs.join(', ') : '(설정 파일 없음)'}\n` +
      `    electron-builder 는 인자 없이 부르면 ${DISCOVERABLE.join(' · ')} 와 package.json 의 build 키만 본다.\n` +
      `    탐색되지 않으면 설정이 통째로 무시되고 extraResources 도 적용되지 않는다 —\n` +
      `    출하된 앱의 resources/ 에 compose 파일이 없게 된다(빌드는 성공하므로 아무도 모른다).`,
    )
    return out
  }

  if (discoverable.length > 1) {
    out.push(
      `${APP_DIR} 에 자동 탐색 설정이 여럿이다: ${discoverable.join(', ')}\n` +
      `    electron-builder 는 목록 순서상 먼저 걸리는 하나만 읽는다 — 나머지는 조용히 죽은 설정이다.`,
    )
  }

  return out
}

const linesA = readLines(A)
const linesB = readLines(B)
const violations = checkPackagingReach()

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
