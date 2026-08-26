#!/usr/bin/env node
/**
 * **compose 기동 + 챗 1왕복 스모크**(S4.3 / 수용 기준 L1-9).
 *
 * 이 저장소에는 컨테이너 스택을 실제로 띄우는 검사가 **하나도 없었다.** 유닛·통합 테스트는
 * GitHub Actions `services:` 로 pg·redis 만 붙이고 앱은 in-process 로 돈다. 그래서 Dockerfile ·
 * compose 배선 · 서비스 간 실 네트워크 경로는 **머지된 뒤 사람이 손으로 띄워 봐야만** 깨진 것을
 * 알 수 있었다(`server.ts` 가 테스트 0 + 커버리지 제외인 것과 같은 사각지대다).
 *
 * ## 두 단계로 나뉘고, 앞 단계는 절대 skip 되지 않는다
 *
 * 1. **부팅·readiness** — 실 API 키가 **필요 없다.** 각 서비스 config 의 `ANTHROPIC_API_KEY` 는
 *    `z.string().min(1)` 이라 형식을 보지 않으므로 `.env.example` 의 자리표시자로 기동한다.
 *    여기서 검증하는 것은 "11개 컨테이너가 뜨고 `/health/ready` 가 실제로 green 인가"이고,
 *    그것만으로도 Dockerfile·compose·소비 루프 배선 회귀를 잡는다.
 * 2. **챗 1왕복** — 실 키가 있을 때만 돈다. 없으면 **건너뛰되 그 사실을 출력과 종료 요약에
 *    명시**한다. 조용한 skip 은 이 저장소가 반복해서 물린 초록 거짓말이다.
 *
 * **skip 을 통과로 세지 않는다.** 1단계가 돌지 않았으면 종료 코드가 0 이 될 수 없고,
 * 2단계가 skip 됐으면 요약이 `ROUNDTRIP=skipped` 를 말한다 — 로그를 읽는 사람이 "왕복까지
 * 검증됐다"고 오독할 수 없어야 한다.
 *
 * ## 왜 WebSocket 인가
 *
 * `POST /sessions/:id/messages` 는 **202 만 주고 끝난다**(`{messageId, status:'accepted'}`).
 * 실제 응답 토큰은 `/ws/sessions/:id` 로 흐르므로 HTTP 만으로는 왕복을 볼 수 없다.
 * Node 22+ 의 전역 `WebSocket`(undici)을 쓴다 — 의존성 0.
 *
 * 사용:
 *   node scripts/smoke-compose.mjs            # 부팅만(키 없음)
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/smoke-compose.mjs   # 부팅 + 왕복
 */

import { spawn } from 'node:child_process'
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
/** compose `env_file:` 이 가리키는 9개 서비스. 전부 gitignore 라 신선 체크아웃엔 없다. */
const ENV_SERVICES = [
  'xzawedOrchestrator', 'xzawedManager', 'xzawedPlanner', 'xzawedDeveloper',
  'xzawedDesigner', 'xzawedTester', 'xzawedBuilder', 'xzawedWatcher', 'xzawedSecurity',
]
/** compose 서비스 11개(앱 9 + postgres + redis). */
const EXPECTED_SERVICES = 11
const ORCHESTRATOR = 'http://127.0.0.1:3000'
/**
 * **스모크는 항상 오버레이와 함께 돈다.** 머신의 `.env` 가 결과를 가르면 CI 와 로컬이 서로 다른
 * 것을 검증한다 — 실제로 `AUTH` 값 차이로 물렸다(`docker-compose.smoke.yml` 주석 참조).
 */
const COMPOSE = ['-f', 'docker-compose.yml', '-f', 'docker-compose.smoke.yml']
/** readiness 대기 상한. 이미지 빌드는 이 밖에서 끝나 있어야 한다. */
const READY_TIMEOUT_MS = 300_000
const READY_POLL_MS = 5_000
/** 왕복 대기 상한 — LLM 응답 + 스트리밍. */
const ROUNDTRIP_TIMEOUT_MS = 180_000

/** 실 키로 보이는가. `.env.example` 자리표시자(`sk-ant-...` 10자)를 실 키로 오인하지 않는다. */
export function looksLikeRealKey(v) {
  return typeof v === 'string' && v.startsWith('sk-ant-') && v.length >= 40 && !v.includes('...')
}

/** `shell:false` — 이 스크립트는 개발 도구지만 src/ 규칙을 그대로 따른다. */
function run(bin, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(bin, args, { cwd: ROOT, shell: false, ...opts })
    let out = ''
    let err = ''
    p.stdout?.on('data', (d) => { out += d })
    p.stderr?.on('data', (d) => { err += d })
    p.on('error', (e) => res({ code: -1, out, err: String(e) }))
    p.on('close', (code) => res({ code: code ?? -1, out, err }))
  })
}

const log = (...a) => console.log('[smoke]', ...a)

/** 스모크 기동용 자리표시자. 실 호출을 하지 않는 부팅 단계 전용이고, 형식 검사만 통과하면 된다. */
const PLACEHOLDER_KEY = 'sk-ant-smoke-placeholder-not-a-real-key'

/**
 * `.env.example` 을 **기동 가능한 형태로 정규화**한다.
 *
 * **`.env.example` 을 그대로 복사하면 스택이 뜨지 않는다(CI 실측).** 두 가지 때문이다:
 *
 * 1. **빈 값은 미설정과 다르다.** `REMOTE_CLI_URL=` 은 "설정됐는데 빈 문자열"이라
 *    `z.string().url().optional()` 의 `.url()` 이 **실패**한다(`Invalid url`). 키 자체가 없으면
 *    `.optional()` 이 통과시킨다 — 그래서 값이 빈 줄은 **지운다.**
 * 2. **Orchestrator 의 `ANTHROPIC_API_KEY` 는 예시 파일에서 비어 있다**(다른 서비스는 10자
 *    자리표시자가 들어 있다). `CLAUDE_MODE=api` 가 키를 요구하므로 기동이 거부된다.
 *    부팅 단계는 실 호출을 하지 않으므로 자리표시자를 채운다.
 *
 * **이미 있는 `.env` 는 절대 건드리지 않는다** — 개발자의 실 설정이다. 그래서 로컬에서는 이 경로가
 * 한 번도 돌지 않았고, `.env.example` 기준선이 기동되지 않는다는 사실이 CI 에서야 드러났다.
 */
function normalizeEnv(text) {
  const out = []
  let sawKey = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.length === 0 || line.startsWith('#')) { out.push(line); continue }
    const i = line.indexOf('=')
    if (i < 0) { out.push(line); continue }
    const key = line.slice(0, i)
    const value = line.slice(i + 1)
    if (key === 'ANTHROPIC_API_KEY') {
      sawKey = true
      out.push(`${key}=${value.length > 0 ? value : PLACEHOLDER_KEY}`)
      continue
    }
    // 빈 값은 "설정됐지만 비어 있음"이라 `.url()` 같은 검사에 걸린다 — 아예 지워 미설정으로 만든다.
    if (value.length === 0) continue
    out.push(line)
  }
  if (!sawKey) out.push(`ANTHROPIC_API_KEY=${PLACEHOLDER_KEY}`)
  return out.join('\n')
}

/**
 * `.env` 를 `.env.example` 에서 만든다(없을 때만 — 로컬 실 설정을 덮지 않는다).
 *
 * compose `env_file:` 은 파일이 없으면 `up` 자체를 실패시킨다. CI 신선 체크아웃에는 9개 전부
 * 없으므로 이 단계가 없으면 스모크가 시작조차 못 한다.
 */
function ensureEnvFiles() {
  const made = []
  for (const svc of ENV_SERVICES) {
    const env = join(ROOT, svc, '.env')
    const example = join(ROOT, svc, '.env.example')
    if (existsSync(env)) continue
    if (!existsSync(example)) throw new Error(`${svc}/.env.example 이 없다 — compose env_file 을 만들 수 없다`)
    writeFileSync(env, normalizeEnv(readFileSync(example, 'utf8')))
    made.push(svc)
  }
  return made
}

/**
 * 실 키를 각 서비스 `.env` 에 주입한다(왕복 단계 전용).
 *
 * **값을 로그에 찍지 않는다.** 길이·접두만 보고한다.
 */
function injectKey(key) {
  for (const svc of ENV_SERVICES) {
    const p = join(ROOT, svc, '.env')
    const lines = readFileSync(p, 'utf8').split(/\r?\n/)
    const i = lines.findIndex((l) => l.startsWith('ANTHROPIC_API_KEY='))
    const line = `ANTHROPIC_API_KEY=${key}`
    if (i >= 0) lines[i] = line
    else lines.push(line)
    writeFileSync(p, lines.join('\n'))
  }
}

/** `docker compose ps --format json` 을 읽어 서비스별 상태를 센다. */
async function serviceStates() {
  const { code, out } = await run('docker', ['compose', ...COMPOSE, 'ps', '--format', 'json'])
  if (code !== 0) return null
  // docker compose 는 버전에 따라 JSON 배열 또는 NDJSON 을 준다 — 둘 다 받는다.
  const text = out.trim()
  if (text.length === 0) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  }
}

/**
 * 전 서비스가 healthy 가 될 때까지 대기.
 *
 * **healthcheck 가 없는 서비스는 통과가 아니라 실패다(fail-closed).** 처음에는 `Health` 가 빈
 * 서비스를 `running` 만으로 통과시켰는데, 그러면 healthcheck 를 지운 서비스가 **떠 있기만 해도**
 * "전 서비스 healthy" 로 세어진다 — 이 스모크가 막으려는 초록 거짓말 그 자체다(Grok 반증).
 * 오늘 compose 의 11개 서비스는 전부 healthcheck 를 갖고 있으므로 이 판정은 회귀 0이고,
 * 누가 하나를 지우는 순간 스모크가 그것을 말한다.
 */
async function waitHealthy(deadline) {
  let last = ''
  for (;;) {
    const states = await serviceStates()
    if (states === null) throw new Error('docker compose ps 실패 — 스택이 뜨지 않았다')
    const total = states.length
    const unchecked = states.filter((s) => (s.Health ?? '') === '').map((s) => s.Service)
    if (unchecked.length > 0 && Date.now() > deadline) {
      return { total, ok: 0, timedOut: true, summary: `healthcheck 없는 서비스: ${unchecked.join(', ')}` }
    }
    const ok = states.filter((s) => s.State === 'running' && s.Health === 'healthy')
    const summary = states
      .map((s) => `${s.Service}=${s.State}${s.Health ? `/${s.Health}` : ''}`)
      .sort().join(' ')
    if (summary !== last) { log(summary); last = summary }
    if (total >= EXPECTED_SERVICES && ok.length === total) return { total, ok: ok.length }
    if (Date.now() > deadline) {
      return { total, ok: ok.length, timedOut: true, summary }
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS))
  }
}

/** `/health/ready` 를 직접 쳐서 healthcheck 가 아니라 **응답 본문**으로 확인한다. */
async function readyBody() {
  const res = await fetch(`${ORCHESTRATOR}/health/ready`)
  return { status: res.status, body: await res.text() }
}

/**
 * 챗 1왕복 — 세션 생성 → WS 구독 → 메시지 발행 → 응답 수신.
 *
 * WS 를 **먼저** 연다. 202 를 받은 뒤에 열면 그 사이 흐른 토큰을 놓친다.
 */
async function chatRoundTrip() {
  const created = await fetch(`${ORCHESTRATOR}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!created.ok) throw new Error(`세션 생성 실패 ${created.status}: ${(await created.text()).slice(0, 200)}`)
  const session = await created.json()
  const id = session.id ?? session.sessionId
  if (!id) throw new Error(`세션 응답에 id 가 없다: ${JSON.stringify(session).slice(0, 200)}`)
  log(`세션 생성 ${id}`)

  const frames = []
  const ws = new WebSocket(`${ORCHESTRATOR.replace('http', 'ws')}/ws/sessions/${id}`)
  const done = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`왕복 타임아웃 — 수신 프레임 ${frames.length}건`)), ROUNDTRIP_TIMEOUT_MS)
    ws.addEventListener('message', (ev) => {
      frames.push(String(ev.data).slice(0, 400))
      // `done` 은 어시스턴트 턴 종료 신호다. `error` 도 왕복이 끝난 것이므로 받아서 실패로 낸다.
      const t = (() => { try { return JSON.parse(String(ev.data)).type } catch { return '' } })()
      if (t === 'done' || t === 'error') { clearTimeout(timer); res(t) }
    })
    ws.addEventListener('error', () => { clearTimeout(timer); rej(new Error('WS 오류')) })
    ws.addEventListener('close', () => { clearTimeout(timer); rej(new Error(`WS 조기 종료 — 수신 프레임 ${frames.length}건`)) })
  })
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('WS 연결 실패')), { once: true })
  })
  log('WS 연결')

  // 짧은 프롬프트 — 이 스모크는 품질이 아니라 **경로**를 본다(비용 최소).
  const sent = await fetch(`${ORCHESTRATOR}/sessions/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'ping', mode: 'chat' }),
  })
  if (sent.status !== 202) throw new Error(`메시지 발행이 202 가 아니다: ${sent.status}`)
  log('메시지 발행(202)')

  const kind = await done
  ws.close()
  if (kind === 'error') throw new Error(`어시스턴트 턴이 error 로 끝났다: ${frames.slice(-1)[0] ?? ''}`)
  if (frames.length === 0) throw new Error('WS 프레임 0건 — 왕복이 아니다')
  return { frames: frames.length }
}

/**
 * `--self-test` — 순수 함수 회귀 가드.
 *
 * `scripts/` 에는 테스트 러너가 없다(루트 `package.json` 자체가 없다). 그래도 `normalizeEnv` 는
 * **CI 에서만 도는 경로**라 회귀가 조용히 들어온다 — 실제로 `.env.example` 기준선이 기동되지
 * 않는다는 사실이 로컬에서 한 번도 안 드러났다(개발자 머신엔 이미 `.env` 가 있어 복사 경로가
 * 돌지 않는다). 스택을 띄우지 않고 1초 안에 끝나므로 CI 가 매번 부른다.
 */
function selfTest() {
  const cases = [
    ['빈 값 키는 지운다(미설정으로 만든다)', 'REMOTE_CLI_URL=\nMODE=local', (o) => !o.includes('REMOTE_CLI_URL')],
    ['값 있는 키는 보존한다', 'REDIS_URL=redis://redis:6379', (o) => o.includes('REDIS_URL=redis://redis:6379')],
    ['빈 API 키는 자리표시자로 채운다', 'ANTHROPIC_API_KEY=', (o) => o.includes(`ANTHROPIC_API_KEY=${PLACEHOLDER_KEY}`)],
    ['있는 API 키는 덮지 않는다', 'ANTHROPIC_API_KEY=sk-ant-existing', (o) => o.includes('ANTHROPIC_API_KEY=sk-ant-existing')],
    ['API 키 줄이 아예 없으면 추가한다', 'MODE=local', (o) => o.includes(`ANTHROPIC_API_KEY=${PLACEHOLDER_KEY}`)],
    ['주석과 빈 줄은 보존한다', '# c\n\nMODE=local', (o) => o.startsWith('# c\n\n')],
    ['= 없는 줄은 건드리지 않는다', 'BARE\nMODE=local', (o) => o.includes('BARE')],
    ['값에 = 가 있어도 자르지 않는다', 'DATABASE_URL=postgres://a:b=c@h/d', (o) => o.includes('b=c@h/d')],
  ]
  let failed = 0
  for (const [name, input, ok] of cases) {
    if (ok(normalizeEnv(input))) { console.log(`  ✓ ${name}`) } else { console.error(`  ✗ ${name}`); failed += 1 }
  }
  const keyCases = [
    ['빈 문자열은 실 키가 아니다', '', false],
    ['자리표시자는 실 키가 아니다', PLACEHOLDER_KEY.slice(0, 10), false],
    ['... 가 든 예시는 실 키가 아니다', 'sk-ant-...............................', false],
    ['접두가 다르면 실 키가 아니다', 'x'.repeat(50), false],
    ['충분히 긴 sk-ant 는 실 키다', `sk-ant-${'a'.repeat(50)}`, true],
  ]
  for (const [name, input, want] of keyCases) {
    if (looksLikeRealKey(input) === want) { console.log(`  ✓ ${name}`) } else { console.error(`  ✗ ${name}`); failed += 1 }
  }
  if (failed > 0) throw new Error(`self-test 실패 ${failed}건`)
  console.log(`[smoke] RESULT self-test only — ${cases.length + keyCases.length}건 통과. 스택은 띄우지 않았다.`)
}

async function main() {
  if (process.argv.includes('--self-test')) { selfTest(); return }

  // `--prepare-env` 는 `.env` 생성만 하고 끝낸다. CI 의 **빌드 스텝**이 먼저 부른다 —
  // compose 는 `env_file:` 이 없으면 `build` 단계에서도 설정을 못 읽어 실패한다.
  // YAML 안에 node 한 줄을 인라인하면 따옴표가 겹쳐 깨지므로 플래그로 뺐다.
  if (process.argv.includes('--prepare-env')) {
    const made = ensureEnvFiles()
    log(made.length > 0 ? `.env 생성 ${made.length}건(.env.example 기준)` : '.env 전부 존재')
    // **이 모드는 아무것도 검증하지 않는다.** RESULT 줄을 내지 않는 것만으로는 부족해서
    // 명시적으로 적는다 — exit 0 을 "스모크 통과"로 오독하면 그것이 초록 거짓말이다.
    console.log('[smoke] RESULT prepare-env only — 스택을 띄우지 않았고 아무것도 검증하지 않았다.')
    return
  }

  const key = process.env['ANTHROPIC_API_KEY'] ?? ''
  const real = looksLikeRealKey(key)
  log(`실 API 키 ${real ? '감지' : '없음'}(길이=${key.length} · sk-ant 접두=${key.startsWith('sk-ant-')})`)

  const made = ensureEnvFiles()
  log(made.length > 0 ? `.env 생성 ${made.length}건(.env.example 기준)` : '.env 전부 존재')
  if (real) { injectKey(key); log('실 키를 9개 .env 에 주입') }

  log('docker compose up -d …')
  const up = await run('docker', ['compose', ...COMPOSE, 'up', '-d'])
  if (up.code !== 0) {
    console.error(up.err.slice(-4000))
    throw new Error(`docker compose up 실패(code ${up.code})`)
  }

  const health = await waitHealthy(Date.now() + READY_TIMEOUT_MS)
  if (health.timedOut) {
    console.error(`[smoke] 최종 상태: ${health.summary}`)
    const logs = await run('docker', ['compose', ...COMPOSE, 'logs', '--tail', '40'])
    console.error(logs.out.slice(-6000))
    throw new Error(`readiness 타임아웃 — ${health.ok}/${health.total} healthy(기대 ${EXPECTED_SERVICES})`)
  }
  log(`전 서비스 healthy — ${health.ok}/${health.total}`)

  const ready = await readyBody()
  if (ready.status !== 200) throw new Error(`/health/ready 가 ${ready.status}: ${ready.body.slice(0, 300)}`)
  log(`/health/ready 200 — ${ready.body.slice(0, 200)}`)

  let roundtrip = 'skipped'
  if (real) {
    const rt = await chatRoundTrip()
    roundtrip = `passed(frames=${rt.frames})`
  } else {
    // **판정 기준은 이 프로세스의 env 다.** 컨테이너는 `.env` 에서 키를 받으므로 파일에 실 키가
    // 있어도 여기서는 건너뛴다 — 의도한 보수적 동작이다(명시적으로 넘길 때만 유료 호출).
    log('챗 왕복 SKIP — 이 프로세스에 실 ANTHROPIC_API_KEY 가 없다(컨테이너 .env 와 무관). 부팅·readiness 만 검증했다.')
  }

  // **요약 한 줄이 이 스크립트의 계약이다.** 로그를 읽는 사람이 "왕복까지 검증됐다"고
  // 오독할 수 없도록 skip 여부를 명시한다.
  console.log(`\n[smoke] RESULT boot=passed(${health.ok}/${health.total}) readiness=passed roundtrip=${roundtrip}`)
  if (!real) {
    console.log('[smoke] ⚠ 이 실행은 챗 왕복을 검증하지 않았다 — ANTHROPIC_API_KEY 시크릿을 넣으면 함께 돈다.')
  }
}

// 직접 실행일 때만 돈다(테스트가 looksLikeRealKey 를 import 할 수 있도록).
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('[smoke] 실패:', err.message)
      process.exit(1)
    })
}
