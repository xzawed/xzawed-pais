# CLAUDE.md — xzawedSecurity

## 프로젝트 개요

xzawedSecurity는 xzawed 멀티 에이전트 시스템의 **보안 감사 에이전트**다.
xzawedManager로부터 감사 요청을 받아 OWASP Top 10 기반 정적 분석, 의존성 취약점 검사, Claude AI 분석을 병렬로 실행하고 보안 점수와 수정 제안을 반환한다.

## 디렉토리 구조

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, 모든 컴포넌트 초기화
├── config.ts             # 환경변수 검증 (Zod)
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3008)
├── security.ts           # 분석기 3종 Promise.allSettled(전부 실패 시에만 throw), calculateScore(), filterBySeverity()
├── executor.ts           # validatePath() — WORKSPACE_ROOT 경로 검증
├── types.ts              # SecurityIssue, ManagerToSecurityMessageSchema
├── analyzers/
│   ├── static.ts         # 규칙 집계자 — 자체 규칙 + static-*.ts 모듈을 ALL_RULES로 합쳐 스캔
│   ├── static-*.ts       # 카테고리별 규칙 모듈(crypto·config·injection·traversal·xss·access). 개수는 디렉토리가 정본
│   └── deps.ts           # npm audit --json 실행 → SecurityIssue[] 변환
├── streams/
│   ├── consumer.ts       # BaseConsumer 확장 — manager:to-security:{sessionId}
│   └── producer.ts       # security:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts         # Anthropic SDK — OWASP 컨텍스트 기반 추가 분석
```

## Redis Streams 인터페이스

**Consumer Group:** `security-consumers`

```typescript
// 수신: manager:to-security:{sessionId}
interface ManagerToSecurityMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'audit_request' | 'abort'
  payload: {
    artifacts: string[]                         // 감사 대상 파일 경로 목록
    projectPath: string                         // 의존성 감사 기준 경로
    severity: 'low' | 'medium' | 'high'         // 최소 보고 심각도
    context: Record<string, unknown>
    userContext?: { userId: string; projectId: string; workspaceRoot: string }
  }
}

// 발신: security:to-manager:{sessionId}
interface SecurityToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'audit_complete' | 'error'
  payload: {
    issues?: SecurityIssue[]
    score?: number                              // 0-100 (높을수록 안전)
    summary?: string
    knowledge?: string[]
    auditable?: SecurityAuditable               // 감사가 실제로 수행됐는지 — 아래 참조
    content: string
  }
}

interface SecurityIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  source: 'static' | 'deps' | 'llm'
  category: string
  file: string; line?: number
  description: string; suggestion: string; cwe?: string
}

interface SecurityAuditable {
  static: { requested: number; scanned: number
            skippedByReason: { path: number; stat: number; oversize: number; read: number; analyzerError: number } }
  deps:   { status: 'ok' | 'unavailable' | 'not_applicable'; tool: 'npm' | 'pnpm' | null; reason?: string }
}
```

## 환경 변수

`src/config.ts`의 Zod 스키마가 진실원천이다. 공통 변수(`ANTHROPIC_API_KEY`·`CLAUDE_MODEL`·`REDIS_URL`·`PORT`·`MODE`·`WORKSPACE_ROOT`)와 그 의미는 [루트 CLAUDE.md](../CLAUDE.md)에 있다.

## 구현 참고사항

**점수 계산:** `Math.max(0, 100 - (critical×40 + high×15 + medium×5 + low×1))`

**정적 분석 규칙 (static.ts):**

| ID | 대상 | 심각도 | CWE |
|---|---|---|---|
| S001 | `password[:=]['"]...` | critical | CWE-798 |
| S002 | `sk-ant-...` | critical | CWE-312 |
| S003 | `eval(` | high | CWE-94 |
| S004 | `innerHTML =` | high | CWE-79 |
| S005 | `.query(` + 문자열 연결 | high | CWE-89 |

**구현 주의사항**
- `static.ts`의 `cwe` 필드: `exactOptionalPropertyTypes`로 인해 `if (rule.cwe !== undefined) issue.cwe = rule.cwe` 조건부 할당 필수
- `deps.ts`: `npm audit`은 취약점 발견 시 비정상 종료코드 반환 → catch에서도 `e.stdout` 파싱
- `deps.ts` severity 매핑: `moderate` → `medium`
- `deps.ts` 목(mock): `vi.fn()` 직접 팩토리 내부 사용 후 `vi.mocked(execFile)` 접근 (hoisting 오류 방지)
- 분석기 독립성: `Promise.allSettled` — 하나가 실패해도 나머지 결과를 반환한다. **rejected를 무음으로 빈 배열로 강등하지 않는다** — 로그를 남기고 `auditable`에 감사 불능으로 표기한다
- `source` 태그(static/deps/llm): 세 분석기가 finding에 출처를 태그(static→`static`·deps→`deps`·claude/LLM→`llm`). Manager P4 security 채널이 **결정론 findings(static+deps)만** 게이트로 사용하고 **LLM findings는 제외**(N6 — 비결정론 차단 금지)

**협업·도메인 위키 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변(답변자 역할)
- `audit_complete`에 도메인 지식 emit: Claude 분석기 결과의 `knowledge`(보안 도메인 규칙)를 함께 반환

**Manager 연결:** `xzawedManager/packages/server/src/tools/security-audit.ts` (`createSecurityAuditHandler`)

## 감사 경로 계약

인바운드 스키마가 `artifacts`를 **상대경로**로 강제한다(`..` 금지·절대경로 금지). 그 상대경로는
`process.cwd()`가 아니라 **`workspaceRoot` 기준**으로 해석된다 — `executor.ts`의 `validatePath`가
`path.resolve(workspaceRoot, targetPath)`를 먼저 하고 realpath한다.

**이 재기준화가 없으면 SAST가 구조적으로 항상 0건이 된다.** 배포 구성에서 runner의 cwd는 `/app`이고
`WORKSPACE_ROOT`는 `/workspace`라 전 대상이 ENOENT가 되고, 호출부의 catch가 그것을 빈 배열로 바꾼다.
그 결과가 Manager 검증 채널에서 `security: passed` 증거로 영속된다 — **스캔을 한 줄도 안 한 것이
통과로 기록된다.**

테스트에서 `validatePath`를 모킹하지 않는다. 항등 함수로 모킹하면 이 함수의 결함이 자기 테스트에서
한 번도 실행되지 않는다(실제로 그랬다). 실제 임시 디렉토리에 파일을 쓰고 상대경로로 넘긴다 —
vitest의 cwd는 서비스 디렉토리라 cwd ≠ workspaceRoot가 자연히 성립한다.

건너뛴 이유는 무음으로 삼키지 않는다. "감사 대상을 못 읽었다"와 "취약점이 없다"는 다른 사실이고,
그 구분이 없던 것이 이 결함을 가렸다.

## 감사 가능 여부 (auditable)

`issues: []`만으로는 위 두 사실이 구분되지 않으므로 payload에 **수행 여부**를 함께 싣는다.

- **static** — `requested`/`scanned`와 사유별 skip 카운트. 불변식은
  `requested === scanned + path + stat + oversize + read + analyzerError`.
  `requested > 0 && scanned === 0`이 "대상은 있었는데 한 건도 못 읽었다"다.
- **deps** — `ok`(실제로 돌았다) · `unavailable`(못 돌렸다) · `not_applicable`(감사 대상이 아니다).
  뒤의 둘을 가르는 이유는 이 저장소 자신이 루트에 `package.json`이 없기 때문이다 —
  하나로 접으면 매 감사가 "감사 불능"으로 오염된다. `ok` 판정식은
  **JSON 파싱 성공 ∧ 기대 키 존재**다(`npm audit`은 취약점이 없어도 `vulnerabilities: {}`를 낸다).

LLM 축은 넣지 않는다 — 검증 채널이 결정론 findings만 게이트로 쓰므로 판정에 쓰이지 않는다.

**score는 감사 불능일 때도 바꾸지 않는다.** 그 값을 숫자로 읽어 분기하는 코드가 저장소에 없어
신호가 되지 못하고, 오히려 "보안이 나쁨"으로 오독될 여지만 생긴다. 대신 `summary` 문구가
감사 불능을 말한다.

이 계약은 네 곳에 독립 선언돼 있다(여기 · Manager 미러 interface · Manager `outputSchema` ·
`verify.ts` 판정 스키마). `outputSchema`를 빠뜨리면 필드가 **런타임에 조용히 strip된다** —
검사는 `/contract-drift-check` [4/4]가 한다.
