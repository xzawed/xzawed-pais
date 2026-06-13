# CLAUDE.md — xzawedSecurity

## 프로젝트 개요

xzawedSecurity는 xzawed 멀티 에이전트 시스템의 **보안 감사 에이전트**다.
xzawedManager로부터 감사 요청을 받아 OWASP Top 10 기반 정적 분석, 의존성 취약점 검사, Claude AI 분석을 병렬로 실행하고 보안 점수와 수정 제안을 반환한다.

**현재 상태: 구현 완료 (113/113 테스트 통과)**

## 핵심 명령어

```bash
# xzawedShared 먼저 빌드 필수
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedSecurity

pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <파일>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일 → dist/
```

## 디렉토리 구조

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, 모든 컴포넌트 초기화
├── config.ts             # 환경변수 검증 (Zod)
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3008)
├── security.ts           # 3개 분석기 Promise.all, calculateScore(), filterBySeverity()
├── executor.ts           # validatePath() — WORKSPACE_ROOT 경로 검증
├── types.ts              # SecurityIssue, ManagerToSecurityMessageSchema
├── analyzers/
│   ├── static.ts         # OWASP 패턴 5개 규칙으로 소스 파일 직접 스캔
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
```

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3008` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |

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
- 분석기 독립성: 각 `.catch(() => [])` — 하나가 실패해도 나머지 결과 반환
- `executor.test.ts`: `test.each([3개 케이스])` + `test(1개)` = 4개 테스트
- `source` 태그(static/deps/llm): 세 분석기가 finding에 출처를 태그(static→`static`·deps→`deps`·claude/LLM→`llm`). Manager P4 security 채널이 **결정론 findings(static+deps)만** 게이트로 사용하고 **LLM findings는 제외**(N6 — 비결정론 차단 금지)

**협업·도메인 위키 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변(답변자 역할)
- `audit_complete`에 도메인 지식 emit: Claude 분석기 결과의 `knowledge`(보안 도메인 규칙)를 함께 반환

**Manager 연결:** `xzawedManager/packages/server/src/tools/security-audit.ts` (`createSecurityAuditHandler`)
