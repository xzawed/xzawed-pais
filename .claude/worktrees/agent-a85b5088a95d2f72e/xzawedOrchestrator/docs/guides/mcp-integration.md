[홈](../index.md) > [가이드](.) > MCP 서버 통합

# MCP 서버 통합

xzawedOrchestrator는 MCP(Model Context Protocol) 서버를 내장하고 있어, Claude Code 등 외부 MCP 클라이언트에서 세션 관리 도구를 직접 사용할 수 있습니다.

---

## MCP 서버 개요

xzawedOrchestrator의 MCP 서버는 stdio 전송 방식으로 동작합니다. Claude Code가 이 서버를 MCP 서버로 등록하면, Claude Code 세션 내에서 자연어로 세션을 생성·조회할 수 있습니다.

```
Claude Code (MCP 클라이언트)
    │
    ▼ stdio (JSON-RPC)
xzawedOrchestrator MCP 서버
    │
    ▼ 세션 관리 (SessionStore)
세션 생성·조회·목록 반환
```

---

## Claude Code에서 MCP 서버 등록

### 방법 1: 개발 모드 (tsx 사용)

소스에서 직접 실행합니다. 개발 환경에 적합합니다.

```json
// Claude Code settings.json (예: ~/.claude/settings.json)
{
  "mcpServers": {
    "xzawed-orchestrator": {
      "command": "npx",
      "args": ["tsx", "packages/server/src/mcp/entry.ts"],
      "cwd": "f:\\DEVELOPMENT\\SOURCE\\CLAUDE\\xzawedOrchestrator",
      "env": {
        "MODE": "local",
        "CLAUDE_MODE": "cli"
      }
    }
  }
}
```

### 방법 2: 빌드 후 실행 (운영 권장)

```bash
# 빌드
pnpm build
```

```json
{
  "mcpServers": {
    "xzawed-orchestrator": {
      "command": "node",
      "args": ["packages/server/dist/mcp/entry.js"],
      "cwd": "f:\\DEVELOPMENT\\SOURCE\\CLAUDE\\xzawedOrchestrator",
      "env": {
        "MODE": "local",
        "CLAUDE_MODE": "api",
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### 방법 3: pnpm 스크립트 사용

```json
{
  "mcpServers": {
    "xzawed-orchestrator": {
      "command": "pnpm",
      "args": ["--filter", "@xzawed/server", "mcp"],
      "cwd": "f:\\DEVELOPMENT\\SOURCE\\CLAUDE\\xzawedOrchestrator"
    }
  }
}
```

---

## 사용 가능한 MCP 도구

### create_session

새로운 대화 세션을 생성합니다.

**파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `userId` | string | 예 | 세션 소유자의 사용자 ID |

**사용 예시 (Claude Code에서):**

```
xzawedOrchestrator에 "my-project" 세션을 만들어줘
```

Claude Code가 `create_session` 도구를 호출합니다:

```json
// 요청
{"userId": "my-project"}

// 응답
{"sessionId": "550e8400-e29b-41d4-a716-446655440000"}
```

---

### get_session_status

세션의 현재 상태를 조회합니다.

**파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `sessionId` | string | 예 | 조회할 세션 ID |

**사용 예시:**

```
세션 550e8400-...의 상태를 확인해줘
```

```json
// 응답
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "my-project",
  "state": "active",
  "claudeMode": "cli",
  "createdAt": 1747267200000,
  "updatedAt": 1747267200000
}
```

**세션 상태:**

| 상태 | 설명 |
|------|------|
| `active` | 활성. 메시지 수신 가능 |
| `waiting_manager` | xzawedManager 회신 대기 중 |
| `waiting_user` | 사용자 추가 입력 대기 중 |
| `completed` | 작업 완료 |
| `error` | 오류 발생 |

---

### list_sessions

사용자의 세션 목록을 조회합니다.

**파라미터:**

| 파라미터 | 타입 | 필수 | 설명 |
|----------|------|------|------|
| `userId` | string | 예 | 세션을 조회할 사용자 ID |

**사용 예시:**

```
"my-project" 사용자의 모든 세션을 보여줘
```

```json
// 응답
[
  {
    "id": "550e8400-...",
    "userId": "my-project",
    "state": "active",
    "claudeMode": "cli",
    "createdAt": 1747267200000
  }
]
```

---

## MCP 서버 단독 실행

REST API 서버와 별도로 MCP 서버만 실행할 수 있습니다.

```bash
cd packages/server
pnpm mcp
```

> **Note:** MCP 서버는 stdio 모드로 동작하므로 터미널에서 직접 실행해도 대화형 출력이 없습니다. MCP 클라이언트(예: Claude Code)를 통해서만 사용하세요.

---

## 문제 해결

### MCP 서버 연결 실패

Claude Code 로그에서 에러를 확인합니다.

```bash
# Claude Code 로그 위치 (macOS)
~/Library/Logs/Claude/mcp*.log

# Windows
%APPDATA%\Claude\logs\mcp*.log
```

### 빌드 없이 실행 시 오류

```bash
# packages/shared를 먼저 빌드해야 합니다
pnpm build
```

### 환경변수 미설정 오류

MCP 서버 실행 시 `.env` 파일을 읽지 않으므로 `env` 필드에 환경변수를 직접 지정해야 합니다.

```json
{
  "env": {
    "CLAUDE_MODE": "api",
    "ANTHROPIC_API_KEY": "sk-ant-..."
  }
}
```

---

## 다음 단계

- [MCP 도구 레퍼런스](../reference/mcp-tools.md) — 도구 파라미터·반환값 상세
- [REST API 레퍼런스](../reference/rest-api.md) — HTTP API로 세션 관리

---

## 관련 문서

- [세션 수명주기](../concepts/sessions.md)
- [설정 옵션 완전 가이드](configuration.md)
