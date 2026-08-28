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
 * 즉 저장소의 **문서화된 최단 실행 경로**다. `docker compose up` 하는 순간
 * 5432·6379·3000~3008 이 0.0.0.0 에 떴고, redis 는 `requirepass` 가 없으며
 * Manager 쓰기 라우트는 `SERVICE_JWT_SECRET` 미설정 시 무인증이다.
 *
 * 포트를 **제거**하지 않고 루프백으로 좁히는 이유: `running.md` 경로 B 가
 * `docker compose up -d redis postgres` 후 호스트 프로세스에서
 * `redis://localhost:6379` 로 붙는다. 루프백이면 그 경로가 그대로 산다.
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

/** 루프백으로 인정하는 호스트 IP. */
const LOOPBACK = new Set(['127.0.0.1', '::1'])

/**
 * `ports:` 블록 안의 항목만 뽑는다.
 *
 * YAML 파서를 쓰지 않는 이유는 저장소 루트에 `package.json` 이 없어서다
 * (`check-compose-parity.js` 도 같은 이유로 줄 단위로 읽는다).
 * `ports:` 를 만나면 그 들여쓰기를 기억하고, 더 깊은 들여쓰기의 `- ` 항목만 센다.
 */
function collectPorts(lines) {
  const found = []
  let portsIndent = null

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '' || line.trim().startsWith('#')) return

    const indent = line.length - line.trimStart().length

    if (portsIndent !== null) {
      const isItem = /^\s*-\s+/.test(line)
      if (isItem && indent > portsIndent) {
        found.push({ line: i + 1, value: line.trim().replace(/^-\s+/, '').replace(/^["']|["']$/g, '') })
        return
      }
      // 더 깊지 않거나 항목이 아니면 블록이 끝난 것이다.
      portsIndent = null
    }

    // 블록 형태:  ports:\n      - "127.0.0.1:3000:3000"
    if (/^\s*ports:\s*$/.test(line)) {
      portsIndent = indent
      return
    }

    // 인라인 플로우 형태:  ports: ["127.0.0.1:3000:3000"]
    // prod 사본 두 벌이 이 형태다. 블록 형태만 보면 **조용히 0개로 지나간다**(실제로 그랬다).
    const inline = line.match(/^\s*ports:\s*\[(.*)\]\s*$/)
    if (inline) {
      for (const item of inline[1].split(',')) {
        const value = item.trim().replace(/^["']|["']$/g, '')
        if (value) found.push({ line: i + 1, value })
      }
    }
  })

  return found
}

/**
 * 게시 항목의 호스트 IP 를 판정한다.
 *
 * 형태: `HOST:CONTAINER` (IP 없음) · `IP:HOST:CONTAINER` · `IP::CONTAINER`.
 * 컨테이너 포트만 적은 `"3000"` 도 Docker 는 임의 호스트 포트로 0.0.0.0 에 연다.
 */
function hostIpOf(value) {
  const spec = value.split('/')[0] // `/tcp` 프로토콜 접미어 제거
  const parts = spec.split(':')
  if (parts.length <= 2) return null // IP 미지정 → 0.0.0.0
  return parts.slice(0, parts.length - 2).join(':')
}

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

  for (const { line, value } of ports) {
    checkedPorts++
    const ip = hostIpOf(value)
    if (ip === null) {
      console.error(`✗ ${rel}:${line} — "${value}" 는 호스트 IP 가 없어 0.0.0.0 에 바인딩됩니다`)
      console.error(`    고치는 법: "127.0.0.1:${value}"`)
      failures++
    } else if (!LOOPBACK.has(ip)) {
      console.error(`✗ ${rel}:${line} — "${value}" 의 호스트 IP 가 루프백이 아닙니다 (${ip})`)
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
