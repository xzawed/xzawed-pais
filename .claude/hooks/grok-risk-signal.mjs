#!/usr/bin/env node
/**
 * PreToolUse Hook: git commit 시 staged diff에서 고위험 신호 감지
 * 비차단(exit 0) — 경고만 출력
 *
 * 왜 필요한가:
 *   이 저장소의 진짜 위험은 tsc·테스트가 잡지 못하는 곳에 있다 — 서비스 간 계약 드리프트,
 *   fail-open/closed 의미론 반전, 플래그 배선 비대칭, 테넌트 경계, 마이그레이션 멱등성.
 *   전부 "로컬 그린인데 플랫폼이 깨지는" 부류다. 이 훅은 그런 변경이 커밋에 섞였을 때
 *   무엇이 왜 위험한지와 어떤 반증을 돌리면 되는지를 알려준다.
 *
 * 게이트가 아니라 인지 장치다:
 *   실제 정산은 /pr-ready 마지막 단계에서 한다(신호마다 반증 또는 명시적 사유 요구).
 *   여기서 차단하면 문서 수정 같은 저위험 커밋까지 막혀 훅 자체가 무시당한다.
 */
import { execSync } from 'node:child_process'

/** 라인 스캔 대상 확장자 — 문서(.md)·락파일은 제외해 오탐을 줄인다. */
const SCANNED_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|sql)$/

/**
 * 스캔 제외 경로 — 제품 코드가 아닌 도구·문서 자산.
 * `.claude/` 는 이 훅 자신과 커맨드 정의를 담고 있어, 제외하지 않으면 신호 패턴을
 * 본문에 가진 파일들이 스스로에게 발화한다.
 */
const EXCLUDED_PATH = /^(\.claude|\.github|docs|scripts)\//

const SIGNALS = [
  {
    id: 'cross-service-contract',
    label: '서비스 간 계약',
    why: 'Redis 메시지·Zod 스키마는 tsc가 서비스 경계를 넘어 교차검증하지 못한다. 어긋나면 소비자에서 DLQ로 간다.',
    action: '/contract-drift-check 로 복제된 계약 정의를 진단하고, /grok-verify 로 양쪽 서비스 빌드·테스트를 반증',
    matchFile: (p) =>
      /^xzawedShared\/src\/streams\//.test(p) ||
      /\.schema\.ts$/.test(p) ||
      /\/schemas?\//.test(p),
  },
  {
    id: 'failure-semantics',
    label: 'fail-open / fail-closed 의미론',
    why: '실패 시 통과냐 차단이냐가 뒤집히면 조용히 구멍이 생긴다. senario N1(불확실=실패)·M8(무음 통과 금지)의 핵심.',
    action: '/grok-verify 로 해당 경로의 실패 케이스 테스트가 실제로 존재하고 통과하는지 반증',
    matchLine: (l) => /fail[-_ ]?(open|closed|safe)|never[-_ ]?throw|best[-_ ]?effort/i.test(l),
  },
  {
    id: 'auth-tenant-boundary',
    label: '인증 · 테넌트 경계',
    why: 'authHook 누락이나 소유권 게이트 우회는 IDOR로 직결된다. G11 테넌시는 아직 태깅 단계라 읽기 술어가 없다.',
    action: '/grok-verify 로 미소유 리소스가 404로 단락되는 테스트가 있는지 반증',
    matchLine: (l) =>
      /authHook|assertProjectOwner|assertProjectInOrg|projectOwnershipPreHandler|tenant_id|tenantId|orgId/.test(l),
  },
  {
    id: 'flag-wiring',
    label: '플래그 배선',
    why: '생산자만 켜고 소비자 게이트를 안 켜면 기능이 조용히 휴면한다. flag off일 때 바이트 동일 보장도 함께 깨진다.',
    action: '/grok-verify 로 flag off 경로가 변경 전과 동일하게 동작하는지 반증',
    matchLine: (l) => /shouldWire\w+|MANAGER_[A-Z0-9_]{3,}|ORCHESTRATOR_[A-Z0-9_]{3,}|PAIS_PROFILE/.test(l),
  },
  {
    id: 'exec-path-guard',
    label: '명령 · 경로 실행',
    why: 'spawn shell:true·절대경로 허용·allowlist 완화는 CLAUDE.md 보안 아키텍처 원칙 위반이다.',
    action: '/dev-path-guard-audit 로 경로·명령 불변식을 정적 감사',
    addedOnly: true,
    matchLine: (l) => /\bspawn\s*\(|\bexecSync\s*\(|shell:\s*true|WORKSPACE_ROOT|ALLOWED_PREFIXES/.test(l),
  },
  {
    id: 'migration-idempotency',
    label: '마이그레이션 멱등성',
    why: 'Manager는 부팅마다 전체 마이그레이션을 재실행한다. IF NOT EXISTS가 없으면 42P07로 죽는다.',
    action: 'IF NOT EXISTS 를 추가하거나, 멱등성 정적 가드 테스트가 이 파일을 덮는지 확인',
    addedOnly: true,
    matchLine: (l) =>
      /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!(CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS)/i.test(l) ||
      /CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(l),
  },
]

/** `"pkg": "^1.2.3"` → { name, major } (major 판별 불가면 null) */
function parseDep(line) {
  const m = /"([^"]+)"\s*:\s*"[^\d]*(\d+)\.\d+[^"]*"/.exec(line)
  return m ? { name: m[1], major: m[2] } : null
}

/** staged diff를 파일별 { added, removed } 로 분해한다. */
function parseDiff(diff) {
  const files = new Map()
  let current = null
  for (const line of diff.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (header) {
      current = header[2]
      files.set(current, { added: [], removed: [] })
      continue
    }
    if (!current) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) files.get(current).added.push(line.slice(1))
    else if (line.startsWith('-')) files.get(current).removed.push(line.slice(1))
  }
  return files
}

/** package.json 에서 major 버전이 바뀐 의존성을 찾는다. */
function findMajorBumps(files) {
  const bumps = []
  for (const [path, { added, removed }] of files) {
    if (!path.endsWith('package.json')) continue
    const before = new Map()
    for (const line of removed) {
      const d = parseDep(line)
      if (d) before.set(d.name, d.major)
    }
    for (const line of added) {
      const d = parseDep(line)
      if (!d) continue
      const prev = before.get(d.name)
      if (prev && prev !== d.major) bumps.push(`${path}: ${d.name} ${prev}.x → ${d.major}.x`)
    }
  }
  return bumps
}

function collectHits(files) {
  const hits = new Map()
  const add = (signal, evidence) => {
    if (!hits.has(signal.id)) hits.set(signal.id, { signal, evidence: new Set() })
    hits.get(signal.id).evidence.add(evidence)
  }

  for (const [path, { added, removed }] of files) {
    if (EXCLUDED_PATH.test(path)) continue
    for (const signal of SIGNALS) {
      if (signal.matchFile?.(path)) add(signal, path)
      if (!signal.matchLine || !SCANNED_EXT.test(path)) continue
      const lines = signal.addedOnly ? added : [...added, ...removed]
      if (lines.some(signal.matchLine)) add(signal, path)
    }
  }
  return hits
}

async function main() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) process.exit(0)

  let data
  try { data = JSON.parse(raw) } catch { process.exit(0) }

  const command = data?.tool_input?.command ?? ''
  if (!command.includes('git commit')) process.exit(0)

  let repoRoot, diff
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim()
    diff = execSync('git diff --cached --unified=0', {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    })
  } catch { process.exit(0) }

  if (!diff.trim()) process.exit(0)

  const files = parseDiff(diff)
  const hits = collectHits(files)
  const bumps = findMajorBumps(files)

  if (hits.size === 0 && bumps.length === 0) process.exit(0)

  console.log('\n⚠️  [grok-risk-signal] 고위험 변경 감지 — tsc·단위테스트가 잡지 못하는 부류입니다.\n')

  for (const { signal, evidence } of hits.values()) {
    console.log(`  ▸ ${signal.label}`)
    console.log(`    왜: ${signal.why}`)
    console.log(`    반증: ${signal.action}`)
    console.log(`    해당: ${[...evidence].slice(0, 4).join(', ')}${evidence.size > 4 ? ` 외 ${evidence.size - 4}개` : ''}\n`)
  }

  if (bumps.length > 0) {
    console.log('  ▸ 의존성 major 범프')
    console.log('    왜: major 상향은 빌드가 통과해도 런타임·설정에서 깨진다. 실제로 최근 2건이 이 방식으로 걸러졌다.')
    console.log('    반증: /grok-verify 로 격리 워크트리에서 install·build·test 실증')
    console.log(`    해당: ${bumps.slice(0, 4).join(', ')}${bumps.length > 4 ? ` 외 ${bumps.length - 4}개` : ''}\n`)
  }

  console.log('  이 훅은 차단하지 않습니다. 정산은 /pr-ready 의 위험 신호 단계에서 합니다.\n')

  process.exit(0) // 항상 비차단
}

main().catch(() => process.exit(0))
