# xzawedDeveloper

Manager로부터 코드 구현 계획을 수신하여 실제 파일을 생성·수정하고 결과를 반환하는 서비스.

**포트:** 3003

---

## Overview

xzawedDeveloper는 `manager:to-developer:{sessionId}` 스트림에서 `develop_request`를 수신한다. `plan`과 `projectPath`를 Claude API에 전달하여 `FileChange[]`를 생성한 뒤 파일시스템에 적용한다. 적용 결과를 `developer:to-manager:{sessionId}` 스트림으로 발행한다.

**입력:** Redis Stream `manager:to-developer:{sessionId}` (`develop_request`, `abort`)
**출력:** Redis Stream `developer:to-manager:{sessionId}` (`develop_complete`, `error`)

---

## API / Redis Streams 인터페이스

### Redis 수신

스트림: `manager:to-developer:{sessionId}`
Consumer Group: `developer-consumers`

```typescript
interface ManagerToDeveloperMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_request' | 'abort'
  payload: {
    plan: string           // 자연어 구현 지시
    projectPath: string    // 프로젝트 루트 경로 (WORKSPACE_ROOT 기준 상대경로)
    context: Record<string, unknown>
    userContext?: UserContext
  }
}

interface UserContext {
  userId: string
  projectId: string
  workspaceRoot: string
  githubRepo?: { owner: string; repo: string; branch: string }
}
```

### Redis 발신

스트림: `developer:to-manager:{sessionId}`

```typescript
interface DeveloperToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_complete' | 'error'
  payload: {
    artifacts?: string[]  // 생성·수정된 파일 경로 목록 (삭제 파일 제외)
    summary?: string
    content: string
  }
}
```

### FileChange

```typescript
interface FileChange {
  path: string
  operation: 'create' | 'modify' | 'delete'
  content?: string
}
```

---

## Architecture

```
src/
├── index.ts            # 진입점: Redis consumer + Fastify 서버 시작
├── config.ts           # 환경변수 검증 (Zod) — WORKSPACE_ROOT 필수 검증 포함
├── server.ts           # Fastify HTTP 서버 (/health, 포트 3003)
├── developer.ts        # Developer 클래스 — handle() 메서드로 메시지 처리 조율
├── fileio.ts           # validatePath(), applyChange() — 경로 검증 및 파일 I/O
├── types.ts            # ManagerToDeveloperMessage, DeveloperToManagerMessage, FileChange 타입 정의
├── streams/
│   ├── consumer.ts     # Consumer — BaseConsumer<ManagerToDeveloperMessage> 확장
│   └── producer.ts     # Producer — developer:to-manager:{sessionId} 발행
└── claude/
    └── runner.ts       # ClaudeRunner — generateChanges() → FileChange[] 생성
```

### 데이터 흐름

1. `consumer.ts` → `develop_request` 수신
2. `developer.ts` → `runner.generateChanges()` 호출
3. `userContext.workspaceRoot` 또는 `config.workspaceRoot` 기준으로 `applyChange()` 실행
4. `producer.publish()` → `develop_complete` 발행

### 경로 보안

`fileio.ts`의 `validatePath()`는 다음을 강제한다:

- `validateWorkspaceRoot(workspaceRoot)`로 파일시스템 루트(`/`, `C:\`) 차단
- `path.resolve(workspaceRoot, filePath)`로 절대경로 정규화
- `path.relative(realRoot, realFile)` 결과가 `..`로 시작하거나 절대경로면 거부 (path traversal 차단)
- 파일 삭제 (`operation: 'delete'`)는 실제 삭제 대신 `.bak.{timestamp}` 리네임으로 처리

---

## Configuration

| 환경변수 | 필수 | 기본값 | 설명 |
|---------|------|--------|------|
| `ANTHROPIC_API_KEY` | 예 | — | Anthropic API 키 |
| `CLAUDE_MODEL` | 아니오 | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `REDIS_URL` | 아니오 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 아니오 | `3003` | HTTP 서버 포트 |
| `MODE` | 아니오 | `local` | `local` \| `remote` |
| `WORKSPACE_ROOT` | 예 | — | 파일 I/O 루트 경로 (절대경로 필수, 파일시스템 루트 불가) |

---

## Development

> 사전 조건: xzawedShared를 먼저 빌드해야 한다.
> ```bash
> cd xzawedShared && pnpm install && pnpm build && cd ..
> ```

```bash
pnpm install

pnpm dev         # tsx watch 개발 모드

pnpm test        # Vitest 전체 실행 (31건)

pnpm test src/fileio.test.ts  # 단일 파일

pnpm build       # TypeScript 컴파일 → dist/
```

---

## Related

- [xzawedManager](manager.md)
- [Redis Streams](../concepts/redis-streams.md)
- [환경변수 레퍼런스](../reference/environment-variables.md)
