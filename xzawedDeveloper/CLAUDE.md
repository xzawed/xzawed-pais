# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedDeveloper는 xzawed 멀티 에이전트 시스템의 **코드 생성 에이전트**다.
xzawedManager로부터 계획(plan)과 프로젝트 경로를 받아 코드를 생성·수정하고 결과를 반환한다.

현재 상태: **구현 완료 (31/31 테스트 통과)**

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
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3003)
├── developer.ts      # 코드 생성·수정 조율 로직
├── fileio.ts         # 파일 읽기/쓰기/삭제 (삭제는 .bak 리네임 보존)
├── types.ts          # 메시지 타입, FileChange 정의
├── streams/
│   ├── consumer.ts   # 구독: manager:to-developer:{sessionId}
│   └── producer.ts   # 발행: developer:to-manager:{sessionId}
└── claude/
    └── runner.ts     # Anthropic SDK — 코드 생성
```

### 데이터 흐름

1. Redis consumer → `develop_request` 수신 (`ManagerToDeveloperMessage`)
2. `developer.ts` → `claude/runner.ts` 호출, `FileChange[]` 생성
3. `fileio.ts` → 변경 사항 적용 (`applyChange`)
4. Redis producer → `develop_complete` 발행 (`DeveloperToManagerMessage`)

## Redis Streams 인터페이스

**Consumer Group:** `developer-consumers`

```typescript
// 수신: manager:to-developer:{sessionId}
interface ManagerToDeveloperMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'develop_request' | 'abort'
  payload: {
    plan: string
    projectPath: string
    context: Record<string, unknown>
  }
}

// 발신: developer:to-manager:{sessionId}
interface DeveloperToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'develop_complete' | 'error'
  payload: {
    changes?: FileChange[]
    content: string
  }
}

interface FileChange {
  path: string
  action: 'create' | 'update' | 'delete'
  content?: string
}
```

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3003
MODE=local
WORKSPACE_ROOT=f:/DEVELOPMENT/SOURCE
```

## 구현 참고사항

- `fileio.ts`의 `applyChange`: 파일 삭제는 실제 삭제 대신 `.bak` 리네임으로 처리 (복구 가능)
- **경로 보안 강화** (`fileio.ts`):
  - `WORKSPACE_ROOT`가 파일시스템 루트(`/`, `C:\`)이면 즉시 거부
  - LLM 생성 절대경로는 `workspaceRoot` 기준 상대경로로 강제 변환 (`path.resolve(workspaceRoot, filePath)`)
- **SYSTEM_PROMPT**: LLM에게 절대경로 대신 상대경로 사용 지시 (`src/index.ts` 형태)
- Manager 연결: `xzawedManager/packages/server/src/tools/develop-code.ts` (`createDevelopCodeHandler`)

## xzawed 생태계 연결

전체 suite: `f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedPAIS\`
- 에이전트 간 통신: Redis Streams (ioredis), 포트 3002–3008
- 설계 스펙: `docs/services/developer.md`
