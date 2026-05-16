[홈](../index.md) > [레퍼런스](.) > MCP 도구 레퍼런스

# MCP 도구 레퍼런스

xzawedOrchestrator MCP 서버에서 제공하는 모든 도구의 파라미터, 반환값, 사용 예시를 설명합니다.

---

## MCP 서버 정보

- **서버 이름:** `xzawed-orchestrator`
- **버전:** `0.1.0`
- **전송 방식:** stdio
- **실행 명령:** `pnpm --filter @xzawed/server mcp`

---

## create_session

새로운 대화 세션을 생성합니다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `userId` | string | 예 | 세션 소유자의 사용자 ID |

### 반환값

성공 시 `content` 배열의 첫 번째 항목에 JSON 문자열로 반환됩니다.

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"sessionId\":\"550e8400-e29b-41d4-a716-446655440000\"}"
    }
  ]
}
```

파싱 후:

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 예시

Claude Code에서 자연어로:

```
xzawedOrchestrator에 새 세션을 만들어줘. userId는 "shopping-mall-project"야.
```

Claude Code가 내부적으로 호출하는 도구:

```json
{
  "tool": "create_session",
  "arguments": {
    "userId": "shopping-mall-project"
  }
}
```

반환 결과:

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## get_session_status

세션의 현재 상태와 메타데이터를 조회합니다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `sessionId` | string | 예 | 조회할 세션의 UUID |

### 반환값

**세션 존재 시:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"id\":\"550e8400-...\",\"userId\":\"shopping-mall-project\",\"state\":\"active\",\"claudeMode\":\"cli\",\"createdAt\":1747267200000,\"updatedAt\":1747267200000}"
    }
  ]
}
```

파싱 후:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "shopping-mall-project",
  "state": "active",
  "claudeMode": "cli",
  "createdAt": 1747267200000,
  "updatedAt": 1747267200000
}
```

**Session 객체 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 세션 UUID |
| `userId` | string | 소유자 ID |
| `state` | SessionState | 현재 상태 |
| `claudeMode` | `"cli"` \| `"api"` \| `"remote"` | Claude 실행 모드 |
| `createdAt` | number | 생성 시각 (Unix ms) |
| `updatedAt` | number | 최종 수정 시각 (Unix ms) |

**세션 미존재 시:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":\"Session not found\"}"
    }
  ]
}
```

### SessionState 값

| 값 | 설명 |
|----|------|
| `active` | 활성 상태. 메시지 수신 가능 |
| `waiting_manager` | xzawedManager 회신 대기 |
| `waiting_user` | 사용자 추가 입력 대기 |
| `completed` | 작업 완료 |
| `error` | 오류 발생 |

### 예시

```
세션 550e8400-의 현재 상태를 확인해줘
```

---

## list_sessions

특정 사용자의 모든 세션 목록을 반환합니다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `userId` | string | 예 | 세션을 조회할 사용자 ID |

### 반환값

```json
{
  "content": [
    {
      "type": "text",
      "text": "[{\"id\":\"550e8400-...\",\"userId\":\"user-1\",\"state\":\"active\",...},{\"id\":\"661f9500-...\",\"userId\":\"user-1\",\"state\":\"completed\",...}]"
    }
  ]
}
```

파싱 후:

```json
[
  {
    "id": "550e8400-...",
    "userId": "user-1",
    "state": "active",
    "claudeMode": "cli",
    "createdAt": 1747267200000,
    "updatedAt": 1747267201000
  },
  {
    "id": "661f9500-...",
    "userId": "user-1",
    "state": "completed",
    "claudeMode": "api",
    "createdAt": 1747267000000,
    "updatedAt": 1747267100000
  }
]
```

**사용자에게 세션이 없는 경우:** 빈 배열 `[]` 반환

### 예시

```
"user-1"의 모든 세션 목록을 보여줘
```

---

## MCP 서버 설정 예시

전체 설정 방법은 [MCP 서버 통합 가이드](../guides/mcp-integration.md)를 참고하세요.

```json
{
  "mcpServers": {
    "xzawed-orchestrator": {
      "command": "node",
      "args": ["packages/server/dist/mcp/entry.js"],
      "cwd": "/path/to/xzawedOrchestrator",
      "env": {
        "MODE": "local",
        "CLAUDE_MODE": "cli"
      }
    }
  }
}
```

---

## 다음 단계

- [REST API 레퍼런스](rest-api.md) — HTTP API로 세션 관리
- [MCP 서버 통합 가이드](../guides/mcp-integration.md) — Claude Code 등록 방법

---

## 관련 문서

- [세션 수명주기](../concepts/sessions.md)
- [WebSocket 프로토콜](websocket.md)
