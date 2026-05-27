[홈](../README.md) > [가이드](.) > MCP 서버 통합

# MCP 서버 통합

xzawedOrchestrator의 MCP 서버를 Claude Code에 등록하고 세션을 관리하는 방법을 안내합니다.

## 사전 조건

- Claude Code 설치
- xzawedOrchestrator 빌드 완료 (`pnpm build`)

---

## 동작 방식

MCP 서버는 stdio 전송 방식으로 동작합니다. Claude Code가 서버를 MCP 서버로 등록하면, Claude Code 세션 내에서 자연어로 xzawedOrchestrator 세션을 생성·조회할 수 있습니다.

```
Claude Code (MCP 클라이언트)
    │
    ▼ stdio (JSON-RPC)
xzawedOrchestrator MCP 서버
    │
    ▼ InMemorySessionStore
세션 생성·조회·목록 반환
```

MCP 서버는 독립적인 세션 스토어를 사용합니다. REST API 서버와 세션 상태를 공유하지 않습니다.

---

## Claude Code에 MCP 서버 등록

### 방법 1: 빌드 후 실행 (권장)

1. 서버를 빌드합니다:

   ```bash
   cd xzawedOrchestrator
   pnpm build
   ```

2. Claude Code `settings.json`에 추가합니다 (예: `~/.claude/settings.json`):

   ```json
   {
     "mcpServers": {
       "xzawed-orchestrator": {
         "command": "node",
         "args": ["packages/server/dist/mcp/entry.js"],
         "cwd": "/path/to/xzawedOrchestrator",
         "env": {
           "MODE": "local",
           "CLAUDE_MODE": "api",
           "ANTHROPIC_API_KEY": "sk-ant-..."
         }
       }
     }
   }
   ```

### 방법 2: tsx로 직접 실행 (개발용)

```json
{
  "mcpServers": {
    "xzawed-orchestrator": {
      "command": "npx",
      "args": ["tsx", "packages/server/src/mcp/entry.ts"],
      "cwd": "/path/to/xzawedOrchestrator",
      "env": {
        "MODE": "local",
        "CLAUDE_MODE": "cli"
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
      "cwd": "/path/to/xzawedOrchestrator"
    }
  }
}
```

> **참고:** MCP 서버의 `env` 필드에 환경변수를 직접 지정해야 합니다. MCP 서버는 `.env` 파일을 자동으로 읽지 않습니다.

---

## 사용 가능한 도구

MCP 서버는 3개의 도구를 제공합니다. 자세한 파라미터·반환값은 [MCP 도구 레퍼런스](../reference/mcp-tools.md)를 참고하세요.

| 도구 | 설명 |
|------|------|
| `create_session` | 새 세션을 생성하고 `sessionId`를 반환 |
| `get_session_status` | 세션의 현재 상태와 메타데이터를 조회 |
| `list_sessions` | 사용자의 모든 세션 목록을 반환 |

Claude Code에서 자연어로 도구를 호출하는 예시:

```
xzawedOrchestrator에 "shopping-mall" 사용자로 새 세션을 만들어줘
# → create_session 호출 → {"sessionId": "550e8400-..."}

세션 550e8400-의 상태를 확인해줘
# → get_session_status 호출 → {"id": "...", "state": "active", ...}

"shopping-mall" 사용자의 모든 세션을 보여줘
# → list_sessions 호출 → [{"id": "...", ...}]
```

---

## MCP 서버 단독 실행

REST API 서버와 별도로 MCP 서버만 실행할 수 있습니다.

```bash
cd xzawedOrchestrator/packages/server
pnpm mcp
```

MCP 서버는 stdio 모드로 동작하므로 터미널에서 직접 실행하면 대화형 출력이 없습니다. MCP 클라이언트(Claude Code 등)를 통해서만 사용합니다.

---

## 문제 해결

### MCP 서버 연결 실패

Claude Code 로그에서 에러를 확인합니다:

```bash
# macOS
~/Library/Logs/Claude/mcp*.log

# Windows
%APPDATA%\Claude\logs\mcp*.log
```

### 빌드 없이 실행 시 모듈 오류

`pnpm build`로 먼저 빌드합니다. `packages/shared`가 빌드되지 않으면 `packages/server`가 올바르게 동작하지 않습니다.

```bash
cd xzawedOrchestrator
pnpm build
```

### 환경변수 미설정 오류

`settings.json`의 `env` 필드에 필수 변수를 직접 지정합니다:

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
