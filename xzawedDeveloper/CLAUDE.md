# CLAUDE.md — xzawedDeveloper

## 프로젝트 개요

xzawedDeveloper는 xzawed 멀티 에이전트 시스템의 **코드 생성 에이전트**다.
xzawedManager로부터 계획(plan)과 프로젝트 경로를 받아 코드를 생성·수정하고 결과를 반환한다.

## 구조

`src/` 트리 → [docs/services/developer.md](../docs/services/developer.md#architecture). **여기 복사하지 않는다** —
두 벌을 손으로 유지하다 양쪽이 다 낡았다(한쪽은 없는 파일을, 다른 쪽은 없는 테스트를 적고 있었다).
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

`src/config.ts`의 Zod 스키마가 진실원천이다. 공통 변수(`ANTHROPIC_API_KEY`·`CLAUDE_MODEL`·`REDIS_URL`·`PORT`·`MODE`·`WORKSPACE_ROOT`)와 그 의미는 [루트 CLAUDE.md](../CLAUDE.md)에 있다.

## 구현 참고사항

**파일 I/O 보안 (fileio.ts)**
- 파일 삭제: 실제 삭제 대신 `.bak` 리네임으로 처리 (복구 가능)
- `WORKSPACE_ROOT`가 파일시스템 루트이면 즉시 거부 (`validateWorkspaceRoot()`)
- **빈 상대경로는 워크스페이스 루트 자신이다.** `.`·`''`·`a/..` 는 `path.resolve` 후 루트와 같아지고, 그 상태로 delete 가 돌면 **워크스페이스 전체가 `.bak` 으로 rename 된다**. 파서(`claude/runner.ts`)가 그 모양을 먼저 거르고 `fileio.ts` 가 `resolved === realRoot` 를 다시 막는다 — **둘 다 필요하다**
- **파싱 실패는 `changes: []` 로 떨어져 성공한 no-op 과 같은 모양이다.** 감사 필드가 없어 Manager 가 구별하지 못한다
- LLM 이 낸 **절대경로는 파서가 거부한다**(`claude/runner.ts` — 변환하지 않는다). 파일 I/O 는 `realpath` 한 워크스페이스 루트 기준으로만 해석한다

**Claude 프롬프트**
- SYSTEM_PROMPT: LLM에게 절대경로 대신 상대경로 사용 지시 (`src/index.ts` 형태)
- `claude/runner.ts` 는 `FileChange[]` **파싱만** 한다 — `fileio.applyChange()` 호출은 `developer.ts` 다

**공통 보안 패턴**
- **소비 계약(스키마 검증·DLQ·ack·재시도)은 shared `BaseConsumer` 가 정본**이다 → [xzawedShared/CLAUDE.md](../xzawedShared/CLAUDE.md)

**협업·도메인 위키 (createCollaborativeHandler)**
- `handle()`는 `createCollaborativeHandler`로 감싸 다른 에이전트의 교차질의에 `runner.answerQuery`로 답변
- `develop_complete`에 도메인 지식 emit: `parseResponse`가 `{changes, knowledge}` 객체 형식을 우선 시도하고 실패 시 `FileChange[]` 배열로 폴백하는 tolerant 파서 — `knowledge`는 구현 결정·제약 `string[]`

**Manager 연결:** `xzawedManager/packages/server/src/tools/develop-code.ts` (`createDevelopCodeHandler`)
