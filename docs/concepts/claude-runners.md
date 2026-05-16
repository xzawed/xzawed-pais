[홈](../index.md) > [개념](.) > Claude 실행 모드

# Claude 실행 모드

xzawedOrchestrator는 세 가지 Claude 실행 모드를 지원합니다. 모두 동일한 `ClaudeRunner` 인터페이스를 구현하므로 코드 변경 없이 환경변수만으로 전환할 수 있습니다.

---

## 모드 비교

| 모드 | 환경변수 | 방식 | 비용 | 요구 사항 |
|------|----------|------|------|-----------|
| **CLI** (기본) | `CLAUDE_MODE=cli` | 로컬 설치된 Claude Code CLI 서브프로세스 | Claude 구독 요금만 | 로컬에 Claude CLI 설치 |
| **API** | `CLAUDE_MODE=api` | Anthropic SDK 직접 호출 | 토큰당 과금 | `ANTHROPIC_API_KEY` 환경변수 |
| **원격 CLI** | `CLAUDE_MODE=remote` | 원격 서버의 Claude CLI 사용 | 서버 운영 비용 | `REMOTE_CLI_URL` 또는 SSH 설정 |

---

## CLI 모드 (`CLAUDE_MODE=cli`)

로컬에 설치된 Claude Code CLI를 child process로 실행합니다. Claude 구독이 있는 사용자에게 가장 경제적입니다.

```env
CLAUDE_MODE=cli
```

### 동작 방식

```
Fastify 서버
    │
    ▼ child_process.spawn('claude', [
    │   '--output-format', 'stream-json',
    │   '--no-interactive',
    │   '<user message>'
    │ ])
    │
    ▼ stdout readline 스트리밍
    │
    ▼ JSON 파싱 → Chunk 변환
    │
    ▼ WebSocket 푸시
```

### 폴백 동작

로컬에 Claude CLI가 설치되어 있지 않은 경우, 자동으로 API 모드로 폴백합니다. (단, `ANTHROPIC_API_KEY`가 설정되어 있어야 합니다.)

### Claude CLI 설치

```bash
npm install -g @anthropic-ai/claude-code
```

---

## API 모드 (`CLAUDE_MODE=api`)

Anthropic SDK를 통해 Claude API를 직접 호출합니다. 토큰 단위로 과금됩니다.

```env
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

### 동작 방식

```
Fastify 서버
    │
    ▼ new Anthropic({ apiKey })
    │
    ▼ client.messages.stream({
    │   model: 'claude-sonnet-4-6',
    │   messages: [...],
    │   max_tokens: 8096
    │ })
    │
    ▼ AsyncIterable<MessageStreamEvent>
    │
    ▼ content_block_delta 이벤트 → Chunk 변환
    │
    ▼ WebSocket 푸시
```

### 지원 모델

| 모델 | 설명 |
|------|------|
| `claude-sonnet-4-6` | 기본값. 속도와 성능의 균형 |
| `claude-opus-4-5` | 최고 성능, 높은 비용 |
| `claude-haiku-3-5` | 빠른 응답, 낮은 비용 |

---

## 원격 CLI 모드 (`CLAUDE_MODE=remote`)

원격 서버에 설치된 Claude CLI를 사용합니다. 두 가지 연결 방식을 지원합니다.

### HTTP 래퍼 방식

원격 서버가 Claude CLI를 HTTP API로 래핑한 경우 사용합니다.

```env
CLAUDE_MODE=remote
REMOTE_CLI_URL=https://my-claude-server.example.com
```

### SSH 터널 방식

```env
CLAUDE_MODE=remote
REMOTE_HOST=my.server.com
REMOTE_USER=ubuntu
REMOTE_KEY_PATH=~/.ssh/id_rsa
```

> **Note:** RemoteCLIRunner의 SSH 구현은 현재 CLIRunner 폴백으로 처리되며, 상세 구현은 추후 릴리스에서 제공됩니다.

---

## ClaudeRunner 인터페이스

세 가지 모드는 모두 동일한 인터페이스를 구현합니다.

```typescript
interface ClaudeRunner {
  send(messages: Message[], options?: RunOptions): AsyncIterable<Chunk>
}

interface RunOptions {
  model?: string
  systemPrompt?: string
  signal?: AbortSignal
}

// Chunk 타입
type Chunk =
  | { type: 'text'; content: string }
  | { type: 'done'; content: '' }
  | { type: 'error'; content: string }
```

### 모드 선택 팩토리

```typescript
// packages/server/src/claude/runner.factory.ts
function createRunner(config: Config): ClaudeRunner {
  switch (config.claudeMode) {
    case 'api':
      return new APIRunner({ apiKey: config.anthropicApiKey!, model: config.claudeModel })
    case 'remote':
      return new RemoteCLIRunner(config)  // 또는 CLIRunner 폴백
    case 'cli':
    default:
      return new CLIRunner()
  }
}
```

---

## 모드 선택 가이드

```
Claude CLI가 로컬에 설치되어 있나요?
├── 예 → CLI 모드 (CLAUDE_MODE=cli)
│         가장 경제적 (구독 요금만)
│
└── 아니오 ──→ Anthropic API 키가 있나요?
               ├── 예 → API 모드 (CLAUDE_MODE=api)
               │         토큰당 과금이지만 즉시 사용 가능
               │
               └── 아니오 → 원격 서버가 있나요?
                            ├── 예 → 원격 CLI 모드 (CLAUDE_MODE=remote)
                            └── 아니오 → Claude 구독 또는 API 키 필요
```

---

## 다음 단계

- [설정 옵션 완전 가이드](../guides/configuration.md) — Claude 관련 환경변수 전체
- [환경변수 목록](../reference/environment-variables.md) — 상세 설정값

---

## 관련 문서

- [시스템 아키텍처](architecture.md)
- [로컬 배포 가이드](../guides/local-deployment.md)
- [원격 배포 가이드](../guides/remote-deployment.md)
