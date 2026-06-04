# xzawedSecurity — 보안 감사 에이전트

xzawedManager로부터 코드 아티팩트를 받아 OWASP Top 10 기반 정적 분석, 의존성 취약점 검사, Claude AI 분석을 병렬로 실행하고 보안 점수와 수정 제안을 반환한다.

**포트:** 3008 | **상태:** 구현 완료 (테스트 수량은 루트 CLAUDE.md 서비스 표 참조)

---

## Overview

xzawedSecurity는 세 가지 분석기를 `Promise.all`로 병렬 실행하며 각 분석기는 독립적으로 실패할 수 있다 (`.catch(() => [])` 패턴). `static.ts`는 5개의 OWASP 패턴 규칙으로 소스 파일을 직접 스캔하고, `deps.ts`는 `npm audit --json`으로 의존성 취약점을 감사하며, `claude/runner.ts`는 Anthropic API로 추가 분석을 수행한다. 전체 이슈에서 점수를 계산하고 `minSeverity`로 필터링한 결과를 반환한다.

**입력:** `manager:to-security:{sessionId}` 스트림의 `audit_request` 메시지  
**출력:** `security:to-manager:{sessionId}` 스트림의 `audit_complete` 또는 `error` 메시지

---

## Redis Streams 인터페이스

**Consumer Group:** `security-consumers`

### 수신 (ManagerToSecurityMessage)

```typescript
interface ManagerToSecurityMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'audit_request' | 'abort'
  payload: {
    artifacts: string[]                         // 감사 대상 파일 경로 목록
    projectPath: string                         // 의존성 감사 기준 경로
    severity: 'low' | 'medium' | 'high'         // 최소 보고 심각도
    context: Record<string, unknown>
    userContext?: {
      userId: string
      projectId: string
      workspaceRoot: string
      githubRepo?: { owner: string; repo: string; branch: string }
    }
  }
}
```

### 발신 (SecurityToManagerMessage)

```typescript
interface SecurityToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
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
  category: string                              // 'injection' | 'xss' | 'exposure' | 'dependency' | ...
  file: string
  line?: number
  description: string
  suggestion: string
  cwe?: string                                  // 예: 'CWE-89'
}
```

---

## Architecture

```
src/
├── index.ts              # 진입점: config 로드, Redis 연결, Consumer·Producer·Runner·Security 초기화
├── config.ts             # 환경변수 검증 (Zod)
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3008)
├── security.ts           # 3개 분석기 Promise.all, 점수 계산, 심각도 필터링
├── executor.ts           # validatePath() — WORKSPACE_ROOT 경로 검증
├── types.ts              # SecurityIssue, ManagerToSecurityMessageSchema 정의
├── analyzers/
│   ├── static.ts         # OWASP 패턴 정적 분석 — 5개 규칙으로 소스 파일 직접 스캔
│   └── deps.ts           # npm audit --json 실행 → SecurityIssue[] 변환
├── streams/
│   ├── consumer.ts       # BaseConsumer 확장 — manager:to-security:{sessionId} 구독
│   └── producer.ts       # security:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts         # Anthropic SDK — OWASP 컨텍스트 기반 추가 분석
```

### 데이터 흐름

1. `consumer.ts` → `audit_request` 수신, Zod 스키마 검증
2. `security.ts` → 3개 분석기 `Promise.all` 병렬 실행 (각 독립 실패 허용)
   - `static.ts`: 각 아티팩트에 `validatePath()` 적용 후 5개 OWASP 규칙 스캔
   - `deps.ts`: `validatePath(projectPath)` 후 `npm audit --json` 실행 및 파싱
   - `claude/runner.ts`: Anthropic API로 아티팩트 분석
3. 전체 이슈 합산 → `calculateScore()` → `filterBySeverity(minSeverity)`
4. `producer.ts` → `audit_complete` 발행

### 정적 분석 규칙 (static.ts)

| ID | 패턴 | 심각도 | 카테고리 | CWE |
|---|---|---|---|---|
| S001 | `password[:=]['"]...` | critical | exposure | CWE-798 |
| S002 | `sk-ant-...` | critical | exposure | CWE-312 |
| S003 | `eval(` | high | injection | CWE-94 |
| S004 | `innerHTML =` | high | xss | CWE-79 |
| S005 | `.query(` + 문자열 연결 | high | injection | CWE-89 |

### 점수 계산

```typescript
// calculateScore(issues: SecurityIssue[]): number
Math.max(0, 100 - (critical × 40 + high × 15 + medium × 5 + low × 1))
```

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3008` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 (`local` \| `remote`) |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |

---

## Development

```bash
# 의존성 설치 (xzawedShared 먼저 빌드 필수)
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedSecurity
pnpm install

pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 실행
pnpm test <파일>   # 단일 파일
pnpm build         # TypeScript 컴파일 → dist/
```

### 구현 참고사항

- `static.ts`의 `cwe` 필드: `exactOptionalPropertyTypes` 설정으로 인해 조건부 할당 필수 (`if (rule.cwe !== undefined) issue.cwe = rule.cwe`)
- `deps.ts`: `npm audit`은 취약점 발견 시 비정상 종료코드를 반환하므로 `execFile` 예외에서도 `stdout`을 파싱한다
- `deps.ts`의 severity 매핑: `moderate` → `medium`
- `deps.ts`의 `hasCommand()`: Windows에서 `where`, Unix에서 `which`로 npm 존재 확인
- 분석기 독립성: 각 분석기가 실패해도 나머지 결과는 반환된다 (`.catch(() => [])`)

---

## Related

- [xzawedShared CLAUDE.md](../../xzawedShared/CLAUDE.md) — BaseConsumer, validateWorkspaceRoot
- [xzawedManager tools/security-audit.ts](../../xzawedManager/packages/server/src/tools/security-audit.ts)
- [서비스 목록](../README.md)
