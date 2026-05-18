# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedSecurity는 xzawed 멀티 에이전트 시스템의 **보안 감사 에이전트**다.
xzawedManager로부터 감사 요청을 받아 OWASP Top 10 기반 정적 분석, 의존성 취약점 검사, Claude AI 분석을 병렬로 실행하고 점수와 함께 결과를 반환한다.

현재 상태: **구현 완료 (45/45 테스트 통과)**

## 핵심 명령어

```bash
pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <file>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일
```

## 아키텍처

```
src/
├── index.ts              # 진입점: Redis consumer 시작
├── config.ts             # 환경변수 검증 (zod)
├── server.ts             # Fastify HTTP 서버 (/health, PORT=3008)
├── security.ts           # 3개 분석기 Promise.all, 점수 계산, 심각도 필터링
├── executor.ts           # child_process — npm audit / pip audit 실행
├── types.ts              # SecurityIssue, ManagerToSecurityMessage 타입
├── analyzers/
│   ├── static.ts         # OWASP 패턴 정적 분석 (소스 파일 직접 스캔)
│   └── deps.ts           # 의존성 취약점 감사 (execFile npm/pip audit)
├── streams/
│   ├── consumer.ts       # 구독: manager:to-security:{sessionId}
│   └── producer.ts       # 발행: security:to-manager:{sessionId}
└── claude/
    └── runner.ts         # Anthropic SDK — OWASP 컨텍스트 기반 분석
```

### 데이터 흐름

1. Redis consumer → `security_audit` 수신 (`ManagerToSecurityMessage`)
2. `security.ts` → 3개 분석기 `Promise.all` (각 `.catch(()=>[])` 독립 실패)
   - `static.ts`: OWASP 규칙 패턴으로 소스 파일 스캔
   - `deps.ts`: `npm audit --json` / `pip audit` 실행
   - `claude/runner.ts`: Claude API로 추가 OWASP 분석
3. 전체 이슈에서 점수 계산 → `minSeverity`로 필터링
4. Redis producer → `security_complete` 발행

## Redis Streams 인터페이스

**Consumer Group:** `security-consumers`

```typescript
// 수신: manager:to-security:{sessionId}
interface ManagerToSecurityMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'security_audit' | 'abort'
  payload: {
    artifacts: string[]
    severity: 'low' | 'medium' | 'high'
    projectPath: string
    context: Record<string, unknown>
  }
}

// 발신: security:to-manager:{sessionId}
interface SecurityToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'security_complete' | 'error'
  payload: {
    issues?: SecurityIssue[]
    score?: number
    summary?: string
    content: string
  }
}

interface SecurityIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  file: string
  line?: number
  description: string
  suggestion: string
  cwe?: string
}
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3008
MODE=local
WORKSPACE_ROOT=/path/to/workspace  # 절대경로 필수
SECURITY_SESSION_ID=security-default
```

## 구현 참고사항

- 점수 계산: `Math.max(0, 100 - (critical×40 + high×15 + medium×5 + low×1))`
- `static.ts`의 `cwe` 필드: `exactOptionalPropertyTypes` 때문에 조건부 할당 필수 (`if (rule.cwe) issue.cwe = rule.cwe`)
- `deps.ts` 목: `vi.fn()` 직접 팩토리 내부 사용 후 `vi.mocked(execFile)` 접근 (hoisting 오류 방지)
- Manager 연결: `xzawedManager/packages/server/src/tools/security-audit.ts` (`createSecurityAuditHandler`)

## xzawed 생태계 연결

전체 suite: 현재 저장소 루트
- 에이전트 간 통신: Redis Streams (ioredis), 포트 3002–3008
- 설계 스펙: `docs/services/security.md`
