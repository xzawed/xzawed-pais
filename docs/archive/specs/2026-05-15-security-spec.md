# CLAUDE.md — xzawedSecurity

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedSecurity는 xzawed 멀티 에이전트 시스템의 **보안 감사 에이전트**다.
xzawedManager로부터 코드 아티팩트를 받아 보안 취약점을 분석하고 보안 점수와 수정 제안을 반환한다.

## 역할 및 책임

- OWASP Top 10 기반 취약점 탐지
- SQL 인젝션, XSS, 인증 취약점 등 정적 분석
- 의존성 취약점 검사 (`npm audit`, `pip audit`)
- 보안 점수(0-100) 및 우선순위별 수정 제안 제공
- 민감 정보 노출(API 키, 패스워드 하드코딩) 탐지

## Redis Streams 인터페이스

**수신:** `manager:to-security:{sessionId}`
**발신:** `security:to-manager:{sessionId}`
**Consumer Group:** `security-consumers`

### 수신 메시지 (ManagerToSecurityMessage)

```typescript
interface ManagerToSecurityMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'audit_request' | 'abort'
  payload: {
    artifacts: FileChange[]           // 감사 대상 코드
    projectPath: string
    severity: 'low' | 'medium' | 'high'  // 최소 보고 심각도
    context: Record<string, unknown>
  }
}
```

### 발신 메시지 (SecurityToManagerMessage)

```typescript
interface SecurityToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'audit_complete' | 'audit_progress' | 'error'
  payload: {
    issues?: SecurityIssue[]
    score?: number                    // 0-100 (높을수록 안전)
    summary?: string
    content: string
  }
}

interface SecurityIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string                    // 'injection' | 'xss' | 'auth' | 'exposure' | ...
  file: string
  line?: number
  description: string
  suggestion: string
  cwe?: string                        // CWE 번호 (예: 'CWE-89')
}
```

## 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 (`/health`) |
| Claude SDK | `@anthropic-ai/sdk` |
| Redis | `ioredis` |
| 의존성 감사 | `node:child_process` (npm audit 등 실행) |
| 스키마 검증 | `zod` |
| 테스트 | Vitest 2 |
| 패키지 매니저 | pnpm |

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3008
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
```

## 레포 초기 구조

```
xzawedSecurity/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── src/
    ├── index.ts
    ├── config.ts
    ├── server.ts
    ├── streams/
    │   ├── consumer.ts   # manager:to-security:{sessionId}
    │   └── producer.ts   # security:to-manager:{sessionId}
    ├── claude/
    │   └── runner.ts
    ├── analyzers/
    │   ├── static.ts     # 정적 분석 규칙
    │   └── deps.ts       # 의존성 취약점 (npm audit 실행)
    └── security.ts       # 분석 조율 로직
```

## 첫 번째 작동 버전의 범위

1. Redis consumer로 `audit_request` 수신
2. Claude로 artifacts 정적 분석 (OWASP Top 10 기준)
3. `npm audit` / `pip audit` 실행 (projectPath 기준)
4. SecurityIssue[] 목록 + 점수 계산
5. `audit_complete` 발신

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager와의 연결

xzawedManager의 `security_audit` 도구가 이 서비스로 위임된다.
Manager의 `tools/security-audit.ts`를 `RedisAgentHandler`로 교체하면 연결 완료.
