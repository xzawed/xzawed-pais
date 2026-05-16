# xzawedBuilder — 빌드 관리자

**역할:** xzawedManager로부터 빌드 요청을 수신하여 실행하고 결과 아티팩트를 반환한다.

**포트:** 3006 | **상태:** 완성 (v0.2.0) — 29개 단위 테스트 통과

---

## 소스 구조

```
src/
├── index.ts          # 진입점: Redis consumer 시작
├── config.ts         # 환경변수 검증 (zod)
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3006)
├── builder.ts        # 빌드 조율 로직
├── detector.ts       # 프로젝트 타입·빌드 명령 자동 감지
├── executor.ts       # child_process로 빌드 실행 (스트리밍 출력)
├── streams/
│   ├── consumer.ts   # 구독: manager:to-builder:{sessionId}
│   └── producer.ts   # 발행: builder:to-manager:{sessionId}
└── claude/
    └── runner.ts     # 빌드 실패 오류 분석 (Anthropic SDK)
```

## 데이터 흐름

1. Redis consumer → `build_request` 수신 (`ManagerToBuilderMessage`)
2. `detector.ts` → `package.json` scripts, `Cargo.toml`, `Makefile` 순서로 빌드 명령 결정
3. `executor.ts` → child_process 실행, stdout/stderr 스트리밍
4. 실패 시 `claude/runner.ts` → 오류 분석 및 `BuildError[]` suggestion 생성
5. Redis producer → `build_complete` 또는 `error` 발행

## Redis Streams 인터페이스

**Consumer Group:** `builder-consumers`

### 수신 (ManagerToBuilderMessage)

```typescript
interface ManagerToBuilderMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'build_request' | 'abort'
  payload: {
    projectPath: string
    target: 'development' | 'production'
    command?: string   // 없으면 자동 감지
    context: Record<string, unknown>
  }
}
```

### 발신 (BuilderToManagerMessage)

```typescript
interface BuilderToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'build_complete' | 'build_progress' | 'error'
  payload: {
    success?: boolean
    output?: string        // 빌드 로그
    artifacts?: string[]   // 생성된 파일 경로
    duration?: number      // ms
    errors?: BuildError[]
    content: string
  }
}

interface BuildError { file?: string; line?: number; message: string; suggestion: string }
```

## 보안 규칙

- `WORKSPACE_ROOT` 외부 경로 빌드 차단 (path traversal 방지)
- `BUILD_TIMEOUT_MS` 강제 적용 (기본 120초, SIGTERM으로 종료)
- 발행 전 Zod 스키마 검증 필수
- 빌드 실패는 `BuildError` 타입으로만 발행 (원시 Error 금지)

## 코딩 컨벤션 (핵심)

| 파일 | 허용 | 금지 |
|------|------|------|
| `detector.ts` | 빌드 명령 감지 | child_process 실행, Redis 접근 |
| `executor.ts` | child_process 실행 + 스트리밍 | Redis 발행 |
| `builder.ts` | 감지·실행 조율 | 직접 Redis 접근 |
| `streams/producer.ts` | Redis 메시지 발행 | 빌드 로직 |
| `claude/runner.ts` | Anthropic SDK 호출 | 파일시스템 접근 |

stdout/stderr는 청크 수신 즉시 `build_progress`로 발행 (버퍼 금지).

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3006
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
BUILD_TIMEOUT_MS=120000
```

## 핵심 명령어

```bash
pnpm install && cp .env.example .env
pnpm dev
pnpm test
pnpm build
```

## 관련 문서

- [아키텍처 상세](builder-architecture.md)
- [설계 스펙](../specs/2026-05-15-builder-design.md)
- [구현 계획](../plans/2026-05-16-builder-initial-implementation.md)
- [코딩 컨벤션](../internal/coding-conventions-builder.md)
- [변경 이력](../internal/changelog-builder.md)
