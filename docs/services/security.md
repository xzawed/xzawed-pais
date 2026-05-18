# xzawedSecurity — 보안 감사 에이전트

**역할:** xzawedManager로부터 코드 아티팩트를 받아 OWASP Top 10 기반으로 보안 취약점을 분석하고 점수와 수정 제안을 반환한다.

**포트:** 3008 | **상태:** 구현 완료 (45/45 테스트)

---

## 책임

- OWASP Top 10 기반 취약점 탐지 (SQL 인젝션, XSS, 인증 취약점 등 정적 분석)
- 의존성 취약점 검사 (`npm audit`, `pip audit`)
- 보안 점수(0–100) 및 우선순위별 수정 제안 제공
- 민감 정보 노출 탐지 (API 키, 패스워드 하드코딩)

## 소스 구조

```
src/
├── index.ts
├── config.ts
├── server.ts            # Fastify /health
├── security.ts          # 분석 조율 로직
├── streams/
│   ├── consumer.ts      # manager:to-security:{sessionId}
│   └── producer.ts      # security:to-manager:{sessionId}
├── claude/
│   └── runner.ts        # Anthropic SDK 호출
└── analyzers/
    ├── static.ts        # 정적 분석 규칙
    └── deps.ts          # 의존성 취약점 (npm audit 실행)
```

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
    artifacts: string[]               // 감사 대상 파일 경로 목록
    projectPath: string
    severity: 'low' | 'medium' | 'high'  // 최소 보고 심각도
    context: Record<string, unknown>
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

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3008
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
SECURITY_SESSION_ID=security-default  # 선택: 기본 세션 ID
```

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## xzawedManager 연결

`tools/security-audit.ts`는 RedisAgentHandler 기반으로 구현 완료.
