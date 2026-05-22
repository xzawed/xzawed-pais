[홈](../index.md) > [개념](.) > Claude 실행 모드

# Claude 실행 모드

xzawedOrchestrator는 세 가지 Claude 실행 모드를 지원합니다. 모두 동일한 `ClaudeRunner` 인터페이스를 구현하므로 코드 변경 없이 환경변수만으로 전환할 수 있습니다.

---

## 모드 비교

| 모드 | 환경변수 | 방식 | 비용 | 요구 사항 |
|------|----------|------|------|-----------|
| **API** (기본) | `CLAUDE_MODE=api` | Anthropic SDK 직접 호출 | 토큰당 과금 | `ANTHROPIC_API_KEY` 환경변수 |
| **CLI** | `CLAUDE_MODE=cli` | 로컬 설치된 Claude Code CLI 서브프로세스 | Claude 구독 요금만 | 로컬에 Claude CLI 설치 |
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
    │   '--print',
    │   '--output-format', 'stream-json',
    │   '--verbose',
    │   '--', '<user message>'
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
    │   max_tokens: 8096  # claude-sonnet-4-6 기준 최대 64K 출력 가능. 복잡한 에이전트 작업 시 증가 권장.
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
| `claude-opus-4-7` | 최고 성능, 장기 에이전트 작업 |
| `claude-haiku-4-5` | 빠른 응답, 높은 비용 효율성 |

### 속도 제한 및 재시도 (Rate Limiting)

Anthropic SDK는 기본적으로 429(속도 제한) 및 529(과부하) 오류에 대해 자동 재시도(기본 `maxRetries: 2`)를 수행한다.

- **HTTP 429** `rate_limit_error`: 요청 빈도 초과 — SDK가 지수 백오프로 자동 재시도
- **HTTP 529** `overloaded_error`: API 일시 과부하 — 동일하게 자동 재시도
- 애플리케이션 레벨의 추가 재시도가 필요한 경우 `new Anthropic({ maxRetries: 5 })` 설정

### 프롬프트 캐싱 (Prompt Caching)

반복되는 시스템 프롬프트와 도구 스키마에는 `cache_control: { type: "ephemeral" }` 마킹을 통해 비용 최대 90% 절감 가능. `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5` 모두 지원.

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

> **Note:** `REMOTE_CLI_URL` 설정 시 `HTTPRemoteRunner`(NDJSON 스트리밍), 미설정 시 `SSHRemoteRunner`(SSH + exec)가 사용됩니다.

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
  claudeSessionId?: string  // CLI 세션 재개용 ID (--resume 플래그)
}

// Chunk 타입
type Chunk =
  | { type: 'text'; content: string }
  | { type: 'done'; content: string }
  | { type: 'error'; content: string }
  | { type: 'claude_session'; content: string }  // CLI 세션 ID 전파
```

### 모드 선택 팩토리

```typescript
// packages/server/src/claude/runner.factory.ts
function createRunner(config: Config): ClaudeRunner {
  switch (config.claudeMode) {
    case 'remote':
      if (config.remoteCLIUrl) {
        return new HTTPRemoteRunner(config.remoteCLIUrl)
      }
      return new SSHRemoteRunner(config.remoteHost!, config.remoteUser!, config.remoteKeyPath!)
    case 'cli':
      return new CLIRunner()
    case 'api':
    default:
      return new APIRunner({ apiKey: config.anthropicApiKey!, model: config.claudeModel })
  }
}
```

---

## 모드 선택 가이드

```
Anthropic API 키가 있나요?
├── 예 → API 모드 (CLAUDE_MODE=api) ← 기본값
│         토큰당 과금, 즉시 사용 가능
│
└── 아니오 ──→ Claude CLI가 로컬에 설치되어 있나요?
               ├── 예 → CLI 모드 (CLAUDE_MODE=cli)
               │         가장 경제적 (구독 요금만)
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
