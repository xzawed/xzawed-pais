#!/usr/bin/env node
/**
 * compose 게시 포트 태세 검사 — **이 기계 밖에서 닿는가**.
 *
 * Docker 는 `"6379:6379"` 처럼 호스트 IP 를 생략하면 `0.0.0.0` 에 바인딩한다.
 * 그러면 같은 LAN 의 아무나 닿는다. 이 저장소의 스택은 전부 **한 기계 안에서**
 * 도는 로컬 스택이라(서버 배포용 compose 는 없다) 게시 포트는 루프백이어야 한다.
 *
 * 출하 사본(`docker-compose.prod.yml` 두 벌)은 #583 이 이미 좁혔고
 * `compose-posture.test.ts` 가 지킨다. **개발 사본은 아무도 안 보고 있었다** —
 * 그런데 그것이 README Option A · `running.md` 경로 A · QUICKSTART 3단계,
 * 즉 저장소의 **문서화된 최단 실행 경로**다.
 *
 * 포트를 **제거**하지 않고 루프백으로 좁히는 이유: `running.md` 경로 B 가
 * `docker compose up -d redis postgres` 후 호스트 프로세스에서
 * `redis://localhost:6379` 로 붙는다. 루프백이면 그 경로가 그대로 산다.
 *
 * ## 이 파서가 왜 이렇게 생겼나
 *
 * 저장소 루트에 `package.json` 이 없어 YAML 파서를 쓸 수 없다
 * (`check-compose-parity.js` 도 같은 이유로 줄 단위로 읽는다).
 * 줄 스캐너는 Compose 문법을 다 아는 척하면 안 된다 — 초판은 세 곳에서
 * **진짜 게시 포트를 조용히 놓쳤고** Grok 반증이 그것을 잡았다.
 *
 *   1. 롱 신택스(`- target:` / `published:` / `host_ip:`)에서 첫 비-`- ` 줄에
 *      블록이 끝난 것으로 봐서 **두 번째 매핑의 `host_ip: 0.0.0.0` 을 보지 못했다**
 *   2. `ports: # 주석` 은 `^\s*ports:\s*$` 에 안 걸려 블록 전체를 건너뛰었다
 *   3. 브래킷 IPv6 `[::1]` 을 루프백이 아니라고 잘못 판정했다
 *
 * 그래서 `--self-test` 가 이 파일에 붙어 있다. **검사기가 조용히 통과하는 것이
 * 이 검사의 유일한 실패 모드**라 그 자리를 픽스처로 못박는다.
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

/** 검사 대상 — 저장소가 갖고 있는 모든 compose 파일. */
const FILES = [
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'docker-compose.smoke.yml',
  'xzawedLauncher/packages/app/resources/docker-compose.prod.yml',
]

/** 루프백으로 인정하는 호스트 IP. 브래킷은 벗기고 비교한다. */
const LOOPBACK = new Set(['127.0.0.1', '::1'])

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '')
const isBlank = (s) => s.trim() === '' || s.trim().startsWith('#')

/**
 * `ports:` 블록의 항목을 뽑는다. 세 형태를 전부 읽는다.
 *
 *   짧은 형태   - "127.0.0.1:3000:3000"
 *   인라인 플로우 ports: ["127.0.0.1:3000:3000"]
 *   롱 신택스   - target: 3000
 *                published: 3000
 *                host_ip: 127.0.0.1
 */
function collectPorts(lines) {
  const found = []
  let portsIndent = null
  let longItem = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    if (isBlank(line)) continue

    const indent = line.length - line.trimStart().length

    if (portsIndent !== null) {
      // 블록은 들여쓰기가 `ports:` 이하로 돌아올 때 끝난다 — 비-`- ` 줄이
      // 나왔다고 끝내면 롱 신택스의 연속 키를 놓친다(초판의 버그).
      if (indent > portsIndent) {
        const item = line.match(/^\s*-\s*(.*)$/)
        if (item) {
          const rest = item[1].trim()
          const kv = rest.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
          if (kv) {
            longItem = { line: i + 1, kind: 'long', map: { [kv[1]]: unquote(kv[2]) } }
            found.push(longItem)
          } else {
            found.push({ line: i + 1, kind: 'short', value: unquote(rest) })
            longItem = null
          }
        } else if (longItem) {
          const kv = line.trim().match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
          if (kv) longItem.map[kv[1]] = unquote(kv[2])
        }
        continue
      }
      portsIndent = null
      longItem = null
    }

    // 블록 형태 시작. 뒤에 주석이 붙어도 잡는다(초판은 못 잡았다).
    if (/^\s*ports:\s*(#.*)?$/.test(line)) {
      portsIndent = indent
      longItem = null
      continue
    }

    // 인라인 플로우 형태.
    const inline = line.match(/^\s*ports:\s*\[(.*)\]\s*(#.*)?$/)
    if (inline) {
      for (const raw of inline[1].split(',')) {
        const value = unquote(raw)
        if (value) found.push({ line: i + 1, kind: 'short', value })
      }
    }
  }

  return found
}

/**
 * 짧은 형태의 호스트 IP. `HOST:CONTAINER` · `IP:HOST:CONTAINER` · `[IPv6]:HOST:CONTAINER`.
 * IP 를 생략하면 Docker 는 0.0.0.0 에 연다 → `null` 을 돌려 실패로 만든다.
 */
function hostIpOfShort(value) {
  const spec = value.split('/')[0] // `/tcp` 프로토콜 접미어 제거

  const bracketed = spec.match(/^\[([^\]]+)\]:/)
  if (bracketed) return bracketed[1]

  const parts = spec.split(':')
  if (parts.length <= 2) return null
  return parts.slice(0, parts.length - 2).join(':')
}

/** 항목 하나를 판정한다 → `{ ok, ip, why }`. */
function judge(item) {
  if (item.kind === 'short') {
    const ip = hostIpOfShort(item.value)
    if (ip === null) return { ok: false, ip: null, why: '호스트 IP 가 없어 0.0.0.0 에 바인딩됩니다' }
    const bare = ip.replace(/^\[|\]$/g, '')
    if (!LOOPBACK.has(bare)) return { ok: false, ip, why: `호스트 IP 가 루프백이 아닙니다 (${ip})` }
    return { ok: true, ip: bare }
  }

  // 롱 신택스: `host_ip` 가 없으면 Docker 는 0.0.0.0 에 연다.
  const ip = item.map.host_ip
  if (ip === undefined) return { ok: false, ip: null, why: '롱 신택스에 host_ip 가 없어 0.0.0.0 에 바인딩됩니다' }
  const bare = String(ip).replace(/^\[|\]$/g, '')
  if (!LOOPBACK.has(bare)) return { ok: false, ip, why: `host_ip 가 루프백이 아닙니다 (${ip})` }
  return { ok: true, ip: bare }
}

const label = (item) => (item.kind === 'short' ? item.value : `target=${item.map.target ?? '?'} published=${item.map.published ?? '(자동)'} host_ip=${item.map.host_ip ?? '(없음)'}`)

// ── 자기검증 ────────────────────────────────────────────────────────────────
// 게이트가 무력화돼도 잡은 초록이다 — 그 자리를 픽스처로 막는다.
// 각 케이스는 초판이 실제로 틀렸던 지점이거나 Compose 가 실제로 지원하는 문법이다.
const SELF_TESTS = [
  { name: '짧은 형태 · IP 없음', yaml: ['services:', '  a:', '    ports:', '      - "6379:6379"'], expect: { count: 1, fail: 1 } },
  { name: '짧은 형태 · 루프백', yaml: ['services:', '  a:', '    ports:', '      - "127.0.0.1:6379:6379"'], expect: { count: 1, fail: 0 } },
  { name: '짧은 형태 · 프로토콜 접미어', yaml: ['services:', '  a:', '    ports:', '      - "127.0.0.1:6379:6379/tcp"'], expect: { count: 1, fail: 0 } },
  { name: '브래킷 IPv6 루프백', yaml: ['services:', '  a:', '    ports:', '      - "[::1]:3000:3000"'], expect: { count: 1, fail: 0 } },
  { name: '인라인 플로우', yaml: ['services:', '  a:', '    ports: ["127.0.0.1:3000:3000"]'], expect: { count: 1, fail: 0 } },
  { name: '인라인 플로우 · LAN', yaml: ['services:', '  a:', '    ports: ["0.0.0.0:3000:3000"]'], expect: { count: 1, fail: 1 } },
  {
    name: '롱 신택스 · 둘째 매핑이 LAN (초판이 놓친 것)',
    yaml: ['services:', '  a:', '    ports:', '      - target: 3000', '        published: 3000', '        host_ip: 127.0.0.1', '      - target: 3001', '        published: 3001', '        host_ip: 0.0.0.0'],
    expect: { count: 2, fail: 1 },
  },
  { name: '롱 신택스 · host_ip 없음', yaml: ['services:', '  a:', '    ports:', '      - target: 3000', '        published: 3000'], expect: { count: 1, fail: 1 } },
  { name: 'ports: 뒤 주석 (초판이 놓친 것)', yaml: ['services:', '  a:', '    ports: # 게시', '      - "3000:3000"'], expect: { count: 1, fail: 1 } },
  { name: '주석 안의 ports:', yaml: ['services:', '  a:', '    # ports:', '    #   - "3000:3000"'], expect: { count: 0, fail: 0 } },
  { name: '블록 종료 후 다른 키', yaml: ['services:', '  a:', '    ports:', '      - "127.0.0.1:3000:3000"', '    environment:', '      FOO: "3001:3001"'], expect: { count: 1, fail: 0 } },
]

function selfTest() {
  let bad = 0
  for (const t of SELF_TESTS) {
    const items = collectPorts(t.yaml)
    const fails = items.filter((it) => !judge(it).ok).length
    const ok = items.length === t.expect.count && fails === t.expect.fail
    if (!ok) {
      console.error(`✗ 자기검증 실패: ${t.name}`)
      console.error(`    기대 항목 ${t.expect.count}개/실패 ${t.expect.fail}건, 실제 ${items.length}개/${fails}건`)
      bad++
    } else {
      console.log(`✓ ${t.name}`)
    }
  }
  if (bad > 0) {
    console.error(`\n자기검증 실패 — ${bad}건. 파서가 깨졌으므로 본 검사 결과를 믿을 수 없습니다.`)
    process.exit(1)
  }
  console.log(`\n자기검증 통과 — 픽스처 ${SELF_TESTS.length}종`)
}

if (process.argv.includes('--self-test')) {
  selfTest()
  process.exit(0)
}

// ── 본 검사 ─────────────────────────────────────────────────────────────────
let failures = 0
let checkedFiles = 0
let checkedPorts = 0

for (const rel of FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    console.error(`✗ ${rel}: 파일이 없습니다 — FILES 목록이 낡았습니다`)
    failures++
    continue
  }

  checkedFiles++
  const ports = collectPorts(fs.readFileSync(abs, 'utf-8').split('\n'))

  for (const item of ports) {
    checkedPorts++
    const v = judge(item)
    if (!v.ok) {
      console.error(`✗ ${rel}:${item.line} — "${label(item)}" ${v.why}`)
      if (item.kind === 'short' && v.ip === null) console.error(`    고치는 법: "127.0.0.1:${item.value}"`)
      failures++
    }
  }

  console.log(`✓ ${rel} — 게시 포트 ${ports.length}개`)
}

if (checkedPorts === 0) {
  console.error('✗ 게시 포트를 하나도 찾지 못했습니다 — 파서가 깨졌거나 대상 파일이 비었습니다')
  console.error('  0개를 통과로 세지 않습니다(이 검사가 조용히 no-op 이 되는 유일한 경로입니다).')
  process.exit(1)
}

if (failures > 0) {
  console.error(`\ncompose 태세 검사 실패 — ${failures}건`)
  process.exit(1)
}

console.log(`\ncompose 태세 검사 통과 — 파일 ${checkedFiles}개 · 게시 포트 ${checkedPorts}개 전부 루프백`)
