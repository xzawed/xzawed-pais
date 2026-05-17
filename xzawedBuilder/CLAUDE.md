# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedBuilder는 xzawed 멀티 에이전트 시스템의 **빌드 에이전트**다.
xzawedManager로부터 프로젝트 경로와 빌드 타깃을 받아 빌드를 실행하고 결과 아티팩트를 반환한다.

현재 상태: **구현 완료 (v0.2.0)** — 39개 단위 테스트 통과, `pnpm build` 정상. 스펙: `docs/superpowers/specs/2026-05-15-xzawedbuilder-design.md`

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

### 데이터 흐름

1. Redis consumer → `build_request` 수신 (`ManagerToBuilderMessage`)
2. `detector.ts` → `package.json` scripts, `Cargo.toml` 등으로 빌드 명령 결정
3. `executor.ts` → child_process 실행, stdout/stderr 스트리밍
4. 실패 시 `claude/runner.ts` → 오류 분석 및 `BuildError[]` suggestion 생성
5. Redis producer → `build_complete` 또는 `error` 발행 (`BuilderToManagerMessage`)

## Redis Streams 인터페이스

**Consumer Group:** `builder-consumers`

```typescript
// 수신: manager:to-builder:{sessionId}
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

// 발신: builder:to-manager:{sessionId}
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

## 보안 고려사항

- `WORKSPACE_ROOT` 외부 경로 빌드 차단 (path traversal 방지)
- `BUILD_TIMEOUT_MS` 강제 적용 (기본 120초)
- **커맨드 인젝션 방지**: `executor.ts`는 `spawn(bin, args, {shell:false})` 사용 — `shell:true` 금지
- **Redis 커맨드 검증**: `builder.ts`의 `validateBuildCommand()` — allowlist + 셸 메타문자 차단
- **`package.json scripts` 미신뢰**: `detector.ts`는 `scripts.build` 값을 읽지 않음 — 의존성 기반 하드코딩 명령어만 반환

## xzawed 생태계 연결

xzawedManager의 `build_project` 도구가 이 서비스로 위임된다.
Manager의 `tools/build-project.ts`를 `RedisAgentHandler`로 교체하면 연결 완료.

전체 suite: `f:\DEVELOPMENT\SOURCE\CLAUDE\` 하위
- xzawedOrchestrator (완성, 참조 구현) → xzawedManager (진행 중) → xzawedBuilder / xzawedPlanner / xzawedDeveloper / xzawedTester / xzawedDesigner / xzawedWatcher / xzawedSecurity
- 에이전트 간 통신: Redis Streams (ioredis), 포트 3002–3008
