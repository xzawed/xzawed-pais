# xzawedBuilder 설계 스펙

날짜: 2026-05-15  
버전: 1.0  
상태: 확정

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedBuilder는 xzawed 멀티 에이전트 시스템의 **빌드 에이전트**다.
xzawedManager로부터 프로젝트 경로와 타깃을 받아 빌드를 실행하고 결과 아티팩트를 반환한다.

## 역할 및 책임

- 프로젝트 빌드 스크립트 실행 (`pnpm build`, `npm run build`, `cargo build` 등)
- 빌드 오류 분석 및 수정 제안
- 프로덕션 빌드 최적화 (번들 크기 분석 등)
- 빌드 아티팩트 경로 보고

## Redis Streams 인터페이스

**수신:** `manager:to-builder:{sessionId}`
**발신:** `builder:to-manager:{sessionId}`
**Consumer Group:** `builder-consumers`

### 수신 메시지 (ManagerToBuilderMessage)

```typescript
interface ManagerToBuilderMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_request' | 'abort'
  payload: {
    projectPath: string
    target: 'development' | 'production'
    command?: string                  // 커스텀 빌드 명령 (없으면 자동 감지)
    context: Record<string, unknown>
  }
}
```

### 발신 메시지 (BuilderToManagerMessage)

```typescript
interface BuilderToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_complete' | 'build_progress' | 'error'
  payload: {
    success?: boolean
    output?: string                   // 빌드 로그
    artifacts?: string[]              // 생성된 파일 경로
    duration?: number                 // 빌드 소요 시간 (ms)
    errors?: BuildError[]
    content: string
  }
}

interface BuildError {
  file?: string
  line?: number
  message: string
  suggestion: string
}
```

## 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 (`/health`) |
| Claude SDK | `@anthropic-ai/sdk` |
| Redis | `ioredis` |
| 빌드 실행 | `node:child_process` |
| 스키마 검증 | `zod` |
| 테스트 | Vitest 2 |
| 패키지 매니저 | pnpm |

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

## 레포 초기 구조

```
xzawedBuilder/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── src/
    ├── index.ts
    ├── config.ts
    ├── server.ts
    ├── streams/
    │   ├── consumer.ts   # manager:to-builder:{sessionId}
    │   └── producer.ts   # builder:to-manager:{sessionId}
    ├── claude/
    │   └── runner.ts
    ├── detector.ts       # 프로젝트 타입·빌드 명령 자동 감지
    ├── executor.ts       # child_process로 빌드 실행
    └── builder.ts        # 빌드 조율 로직
```

## 첫 번째 작동 버전의 범위

1. Redis consumer로 `build_request` 수신
2. `detector.ts`로 빌드 명령 감지 (`package.json` scripts, `Cargo.toml` 등)
3. `executor.ts`로 빌드 실행 (스트리밍 출력)
4. 성공/실패 파싱 후 `build_complete` 발신
5. 실패 시 Claude로 오류 분석 및 suggestion 생성

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## 보안 고려사항

- `WORKSPACE_ROOT` 외부 경로 빌드 차단
- 빌드 타임아웃 강제 적용
- 빌드 프로세스 리소스 제한

## xzawedManager와의 연결

xzawedManager의 `build_project` 도구가 이 서비스로 위임된다.
Manager의 `tools/build-project.ts`를 `RedisAgentHandler`로 교체하면 연결 완료.
