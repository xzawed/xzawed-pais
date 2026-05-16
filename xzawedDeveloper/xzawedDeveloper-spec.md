# CLAUDE.md — xzawedDeveloper

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedDeveloper는 xzawed 멀티 에이전트 시스템의 **코드 개발 에이전트**다.
xzawedManager로부터 실행 계획(Step[])을 받아 실제 코드를 생성·수정·리팩토링하고 파일 변경 목록을 반환한다.

## 역할 및 책임

- 계획(Step[])에 따라 파일 생성·수정·삭제
- TypeScript, Python, React 등 다양한 언어/프레임워크 코드 생성
- 기존 코드 분석 후 최소 침습적 수정
- 생성된 코드에 대한 요약 보고

## Redis Streams 인터페이스

**수신:** `manager:to-developer:{sessionId}`
**발신:** `developer:to-manager:{sessionId}`
**Consumer Group:** `developer-consumers`

### 수신 메시지 (ManagerToDeveloperMessage)

```typescript
interface ManagerToDeveloperMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_request' | 'abort'
  payload: {
    plan: Step[]                      // xzawedPlanner가 생성한 계획
    projectPath: string               // 작업 대상 프로젝트 경로
    context: Record<string, unknown>
  }
}
```

### 발신 메시지 (DeveloperToManagerMessage)

```typescript
interface DeveloperToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_complete' | 'develop_progress' | 'info_request' | 'error'
  payload: {
    artifacts?: FileChange[]
    summary?: string
    content: string
    uiSpec?: UISpec
  }
}

interface FileChange {
  path: string
  operation: 'create' | 'modify' | 'delete'
  content?: string                    // create/modify 시
}
```

## 기술 스택

| 항목 | 기술 |
|---|---|
| 언어 | TypeScript 5 (strict, NodeNext) |
| 서버 | Fastify 5 (`/health`) |
| Claude SDK | `@anthropic-ai/sdk` |
| Redis | `ioredis` |
| 파일 I/O | `node:fs/promises` |
| 스키마 검증 | `zod` |
| 테스트 | Vitest 2 |
| 패키지 매니저 | pnpm |

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3003
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE   # 작업 가능한 루트 경로
```

## 레포 초기 구조

```
xzawedDeveloper/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── src/
    ├── index.ts
    ├── config.ts
    ├── server.ts
    ├── streams/
    │   ├── consumer.ts   # manager:to-developer:{sessionId}
    │   └── producer.ts   # developer:to-manager:{sessionId}
    ├── claude/
    │   └── runner.ts
    └── developer.ts      # 파일 조작 + Claude 코드 생성 로직
```

## 첫 번째 작동 버전의 범위

1. Redis consumer로 `develop_request` 수신
2. Claude에게 plan + projectPath 전달하여 FileChange[] 생성
3. 실제 파일 시스템에 변경 적용 (WORKSPACE_ROOT 하위만 허용)
4. `develop_complete` 메시지로 발신

## 핵심 명령어

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## 보안 고려사항

- `WORKSPACE_ROOT` 경로 외부 접근 차단
- 파일 삭제 전 백업 생성
- 심볼릭 링크 경로 탈출 방지

## xzawedManager와의 연결

xzawedManager의 `develop_code` 도구가 이 서비스로 위임된다.
Manager의 `tools/develop-code.ts`를 `RedisAgentHandler`로 교체하면 연결 완료.
