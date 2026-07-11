# CLAUDE.md — xzawedDeveloper

## 프로젝트 개요

xzawedDeveloper는 xzawed 멀티 에이전트 시스템의 **코드 생성 에이전트**다.
xzawedManager로부터 계획(plan)과 프로젝트 경로를 받아 코드를 생성·수정하고 결과를 반환한다.

**현재 상태: 구현 완료 (63/63 테스트 통과)**

## 핵심 명령어

```bash
# xzawedShared 먼저 빌드 필수
cd ../xzawedShared && pnpm install && pnpm build && cd ../xzawedDeveloper

pnpm install       # 의존성 설치
pnpm dev           # tsx watch 개발 모드
pnpm test          # Vitest 전체 테스트
pnpm test <파일>   # 단일 파일 테스트
pnpm build         # TypeScript 컴파일 → dist/
```

## 디렉토리 구조

```
src/
├── index.ts          # 진입점: config 로드, Redis 연결, Consumer·Producer·Runner 초기화
├── config.ts         # 환경변수 검증 (Zod) — workspaceRoot 포함
├── server.ts         # Fastify HTTP 서버 (/health, PORT=3003)
├── developer.ts      # 코드 생성·수정 조율 로직
├── fileio.ts         # 파일 읽기/쓰기/삭제 — 삭제는 .bak 리네임으로 보존
├── types.ts          # FileChange, ManagerToDeveloperMessageSchema, DeveloperToManagerMessage
├── streams/
│   ├── consumer.ts   # BaseConsumer 확장 — manager:to-developer:{sessionId}
│   └── producer.ts   # developer:to-manager:{sessionId} 발행
└── claude/
    ├── runner.ts     # Anthropic SDK — plan → FileChange[] 생성
    └── runner.test.ts
```

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
    userContext?: { userId: string; projectId: string; workspaceRoot: string }
  }
}

// 발신: developer:to-manager:{sessionId}
interface DeveloperToManagerMessage {
  sessionId: string; messageId: string; timestamp: number
  type: 'develop_complete' | 'error'
  payload: {
    artifacts?: string[]    // 생성·수정된 파일 경로
    summary?: string
    content: string
  }
}

interface FileChange {
  path: string
  operation: 'create' | 'modify' | 'delete'
  content?: string          // delete 시 없음
}
```

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | 필수 | — | Anthropic API 인증 키 |
| `CLAUDE_MODEL` | 선택 | `claude-sonnet-4-6` | Claude 모델 |
| `REDIS_URL` | 선택 | `redis://localhost:6379` | Redis 연결 URL |
| `PORT` | 선택 | `3003` | HTTP 서버 포트 |
| `MODE` | 선택 | `local` | 실행 모드 |
| `WORKSPACE_ROOT` | 필수 | — | 허용 경로 상한선 (절대경로, 파일시스템 루트 불가) |

## 구현 참고사항

**파일 I/O 보안 (fileio.ts)**
- 파일 삭제: 실제 삭제 대신 `.bak` 리네임으로 처리 (복구 가능)
- `WORKSPACE_ROOT`가 파일시스템 루트이면 즉시 거부 (`validateWorkspaceRoot()`)
- LLM 생성 절대경로는 `workspaceRoot` 기준 상대경로로 강제 변환 (`path.resolve(workspaceRoot, filePath)`)

**Claude 프롬프트**
- SYSTEM_PROMPT: LLM에게 절대경로 대신 상대경로 사용 지시 (`src/index.ts` 형태)
- `claude/runner.ts`: `FileChange[]` JSON 응답 파싱 후 `fileio.applyChange()` 호출

**공통 보안 패턴**
- Redis 메시지: `ManagerToDeveloperMessageSchema.safeParse()` 검증. 실패 시 xack 후 skip
- xack 보장: `handler()` `try/finally` 래핑으로 PEL 누수 방지

**협업·도메인 위키 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변
- `develop_complete`에 도메인 지식 emit: `parseResponse`가 `{changes, knowledge}` 객체 형식을 우선 시도하고 실패 시 `FileChange[]` 배열로 폴백하는 tolerant 파서 — `knowledge`는 구현 결정·제약 `string[]`

**Manager 연결:** `xzawedManager/packages/server/src/tools/develop-code.ts` (`createDevelopCodeHandler`)
