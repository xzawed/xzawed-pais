[홈](../index.md) > [개념](.) > Claude 실행 모드

# Claude 실행 모드

xzawedOrchestrator가 Claude를 실행하는 네 가지 방식과 `ClaudeRunner` 인터페이스 추상화 구조를 설명한다.

---

## ClaudeRunner 인터페이스

네 가지 실행 방식은 모두 동일한 인터페이스를 구현한다. 호출 코드는 어떤 Runner가 사용되는지 알 필요가 없다.

```typescript
// packages/server/src/claude/runner.interface.ts
export interface ClaudeRunner {
  send(messages: Message[], options?: RunOptions): AsyncIterable<Chunk>
}

export interface RunOptions {
  model?: string
  systemPrompt?: string
  signal?: AbortSignal
  claudeSessionId?: string  // CLI 세션 재개용 ID (--resume 플래그)
}
```

`send()`는 `AsyncIterable<Chunk>`를 반환한다. 호출자는 for-await-of로 청크를 소비하고 WebSocket으로 푸시한다.

```typescript
// packages/shared/src/types/message.ts
export type Chunk =
  | { type: 'text'; content: string }          // 스트리밍 텍스트 조각
  | { type: 'done'; content: string }          // 스트림 종료
  | { type: 'error'; content: string }         // 오류 발생
  | { type: 'claude_session'; content: string } // CLI 세션 ID 전파
```

---

## 모드 비교

| 모드 | `CLAUDE_MODE` | Runner 클래스 | 설명 |
|------|---------------|--------------|------|
| API | `api` (기본값) | `APIRunner` | Anthropic SDK 직접 호출 |
| CLI | `cli` | `CLIRunner` | 로컬 Claude Code CLI 서브프로세스 |
| HTTP Remote | `remote` + `REMOTE_CLI_URL` | `HTTPRemoteRunner` | 원격 HTTP 서버 NDJSON 스트리밍 |
| SSH Remote | `remote` (URL 없음) | `SSHRemoteRunner` | SSH + exec 원격 실행 |

---

## API 모드 (`CLAUDE_MODE=api`)

`APIRunner`는 `@anthropic-ai/sdk`로 Claude API를 직접 호출한다. `ANTHROPIC_API_KEY`가 필요하며 토큰 단위로 과금된다.

```env
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
```

### 동작 방식

```typescript
// packages/server/src/claude/api-runner.ts
const stream = this.client.messages.stream({
  model: options.model ?? this.model,
  max_tokens: 8096,
  system: options.systemPrompt,
  messages: messages.map(m => ({ role: m.role, content: m.content })),
}, { signal: options.signal })

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    yield { type: 'text', content: event.delta.text }
  }
}
yield { type: 'done', content: '' }
```

### 지원 모델

| 모델 | 특성 |
|------|------|
| `claude-sonnet-4-6` | 기본값. 속도와 성능의 균형 |
| `claude-opus-4-7` | 최고 성능, 장기 에이전트 작업 |
| `claude-haiku-4-5` | 빠른 응답, 높은 비용 효율성 |

### 속도 제한 및 재시도

Anthropic SDK는 HTTP 429(rate_limit_error)와 HTTP 529(overloaded_error)에 대해 지수 백오프로 자동 재시도한다(기본 `maxRetries: 2`). 재시도 횟수를 늘리려면 `new Anthropic({ maxRetries: 5 })`를 설정한다.

---

## CLI 모드 (`CLAUDE_MODE=cli`)

`CLIRunner`는 로컬에 설치된 Claude Code CLI를 child process로 실행한다. Claude 구독이 있는 사용자에게 적합하다.

```env
CLAUDE_MODE=cli
```

### 동작 방식

```typescript
// packages/server/src/claude/cli-runner.ts
const args = [
  ...(claudeSessionId ? ['--resume', claudeSessionId] : []),
  '--print',
  '--output-format', 'stream-json',
  '--verbose',
  ...(systemPrompt ? ['--system-prompt', systemPrompt] : []),
  '--',              // end-of-options 구분자 (CLI 플래그 인젝션 방지)
  lastUserMessage,
]
const proc = spawn('claude', args, { shell: false })
```

`shell: false`로 실행하여 명령 인젝션을 방지한다. `--` 구분자는 사용자 메시지가 CLI 플래그로 해석되는 것을 막는다.

stdout을 readline으로 읽어 JSON 파싱 후 `Chunk`로 변환한다. `claude_session` 청크에 포함된 세션 ID는 `claudeSessionIds` Map에 저장되어 다음 요청에서 `--resume`으로 재사용된다.

### 폴백 동작

로컬에 Claude CLI가 없으면 서버 시작 시 `CLAUDE_MODE=cli`이더라도 `createRunner()`가 `APIRunner`로 폴백한다. 폴백하려면 `ANTHROPIC_API_KEY`가 설정되어 있어야 한다.

---

## HTTP Remote 모드 (`CLAUDE_MODE=remote` + `REMOTE_CLI_URL`)

`HTTPRemoteRunner`는 원격 HTTP 서버에 메시지를 전송하고 NDJSON 스트리밍으로 응답을 받는다.

```env
CLAUDE_MODE=remote
REMOTE_CLI_URL=https://my-claude-server.example.com
```

### 동작 방식

```typescript
// packages/server/src/claude/http-remote-runner.ts
const response = await fetch(`${this.remoteUrl}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages, claudeSessionId, model, systemPrompt }),
  signal: options.signal,
})
// ReadableStream → NDJSON 파싱 → Chunk yield
yield* readNdjsonStream(response.body)
```

생성자에서 `validateRemoteUrl()`로 URL scheme을 검증한다. `http:` 또는 `https:` 외의 scheme은 거부한다.

---

## SSH Remote 모드 (`CLAUDE_MODE=remote`, `REMOTE_CLI_URL` 미설정)

`SSHRemoteRunner`는 SSH로 원격 서버에 접속하여 Claude CLI를 실행한다.

```env
CLAUDE_MODE=remote
REMOTE_HOST=my.server.com
REMOTE_USER=ubuntu
REMOTE_KEY_PATH=~/.ssh/id_rsa
```

---

## 모드 선택 팩토리

`createRunner()`는 환경변수를 읽어 적절한 Runner 인스턴스를 반환한다.

```typescript
// packages/server/src/claude/runner.factory.ts
export function createRunner(config: Config): ClaudeRunner {
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

## 모드 선택 기준

```
API 키가 있고 토큰 과금이 허용되는가?
  예 → API 모드 (기본값, 즉시 사용 가능)

로컬에 Claude CLI가 설치되어 있고 구독이 있는가?
  예 → CLI 모드 (구독 요금만 발생)

원격 서버가 Claude CLI를 HTTP로 노출하는가?
  예 → HTTP Remote 모드 (REMOTE_CLI_URL 설정)

SSH로 접근 가능한 원격 서버가 있는가?
  예 → SSH Remote 모드
```

---

## 관련 문서

- [시스템 아키텍처](architecture.md) — Runner가 사용되는 위치
- [설정 옵션 완전 가이드](../guides/configuration.md) — Claude 관련 환경변수 전체
- [환경변수 목록](../reference/environment-variables.md) — 상세 설정값
