# xzawedOrchestrator — Server Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo 기반 위에 Claude 실행기·Redis Streams·세션 관리·REST API·WebSocket·MCP 서버를 포함한 xzawedOrchestrator 백엔드를 구현한다.

**Architecture:** pnpm workspace + Turborepo monorepo. `packages/shared`에 공통 타입, `packages/server`에 Fastify 기반 백엔드. Claude는 CLI·API·Remote 세 모드를 `ClaudeRunner` 인터페이스로 추상화. 세션별 Redis Streams 스트림으로 xzawedManager와 비동기 통신.

**Tech Stack:** TypeScript 5, pnpm workspaces, Turborepo, Fastify 5, @anthropic-ai/sdk, @modelcontextprotocol/sdk, ioredis, Vitest, tsx

---

## 파일 맵

```
xzawedOrchestrator/
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
└── packages/
    ├── shared/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── types/
    │       │   ├── message.ts            # Message, Chunk 타입
    │       │   ├── session.ts            # Session, SessionState
    │       │   ├── ui-spec.ts            # UISpec, UIField
    │       │   └── streams.ts            # OrchestratorToManager, ManagerToOrchestrator
    │       └── index.ts
    └── server/
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── index.ts                  # 진입점 (서버 기동)
            ├── server.ts                 # Fastify 인스턴스 + 플러그인 등록
            ├── config.ts                 # 환경변수 로드·검증
            ├── claude/
            │   ├── runner.interface.ts   # ClaudeRunner 인터페이스
            │   ├── cli-runner.ts         # claude CLI 서브프로세스
            │   ├── api-runner.ts         # @anthropic-ai/sdk 직접 호출
            │   ├── remote-runner.ts      # SSH / HTTP 외부 서버
            │   └── runner.factory.ts     # CLAUDE_MODE 기반 인스턴스 생성
            ├── streams/
            │   ├── redis.client.ts       # ioredis 싱글턴
            │   ├── producer.ts           # 스트림 발행
            │   └── consumer.ts           # 스트림 구독 + ACK
            ├── sessions/
            │   ├── session.ts            # Session 클래스
            │   └── session.store.ts      # 인메모리 세션 저장소
            ├── api/
            │   ├── sessions.route.ts     # /sessions REST 엔드포인트
            │   └── health.route.ts       # /health
            ├── ws/
            │   └── session.ws.ts         # WebSocket /ws/sessions/:id
            └── mcp/
                └── server.ts             # MCP 서버 (send_message, get_status)
        └── test/
            ├── claude/
            │   ├── cli-runner.test.ts
            │   └── api-runner.test.ts
            ├── streams/
            │   └── producer.test.ts
            ├── sessions/
            │   └── session-store.test.ts
            └── api/
                └── sessions.test.ts
```

---

## Task 1: Monorepo 초기 설정

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: pnpm 설치 확인**

```bash
pnpm --version
```
Expected: `9.x.x` 이상. 없으면 `npm install -g pnpm`

- [ ] **Step 2: workspace root `package.json` 작성**

```json
{
  "name": "xzawed-orchestrator",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

- [ ] **Step 3: `pnpm-workspace.yaml` 작성**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 4: `turbo.json` 작성**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

- [ ] **Step 5: `tsconfig.base.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 6: `.env.example` 작성**

```env
# 서버 모드
MODE=local
PORT=3000
AUTH=none

# Claude 실행 모드: cli | api | remote
CLAUDE_MODE=cli

# API 모드 (CLAUDE_MODE=api)
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-6

# 원격 CLI - HTTP 래퍼 (CLAUDE_MODE=remote)
REMOTE_CLI_URL=

# 원격 CLI - SSH (CLAUDE_MODE=remote, REMOTE_CLI_URL 미설정 시)
REMOTE_HOST=
REMOTE_USER=
REMOTE_KEY_PATH=

# Redis
REDIS_URL=redis://localhost:6379
```

- [ ] **Step 7: `.gitignore` 작성**

```
node_modules/
dist/
.env
.env.local
*.log
.turbo/
.superpowers/
```

- [ ] **Step 8: 커밋**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .env.example .gitignore
git commit -m "feat: initialize monorepo with pnpm workspaces and Turborepo"
```

---

## Task 2: shared 패키지 — 공통 타입

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types/message.ts`
- Create: `packages/shared/src/types/session.ts`
- Create: `packages/shared/src/types/ui-spec.ts`
- Create: `packages/shared/src/types/streams.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: `packages/shared/package.json` 작성**

```json
{
  "name": "@xzawed/shared",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: `packages/shared/tsconfig.json` 작성**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/shared/src/types/message.ts` 작성**

```typescript
export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  timestamp: number
  uiSpec?: UISpec
}

export interface Chunk {
  type: 'text' | 'error' | 'done'
  content: string
}

import type { UISpec } from './ui-spec.js'
```

- [ ] **Step 4: `packages/shared/src/types/session.ts` 작성**

```typescript
export type SessionState =
  | 'active'
  | 'waiting_manager'
  | 'waiting_user'
  | 'completed'
  | 'error'

export type ClaudeMode = 'cli' | 'api' | 'remote'

export interface Session {
  id: string
  userId: string
  state: SessionState
  claudeMode: ClaudeMode
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 5: `packages/shared/src/types/ui-spec.ts` 작성**

```typescript
export type UIFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox_group'
  | 'number'

export interface UISelectOption {
  value: string
  label: string
}

export interface UIField {
  id: string
  type: UIFieldType
  label: string
  required?: boolean
  options?: UISelectOption[]   // select, checkbox_group 전용
  placeholder?: string
}

export type UISpecType = 'form' | 'mockup_viewer' | 'progress_board'

export interface UISpec {
  type: UISpecType
  title?: string
  fields?: UIField[]           // form 전용
  submitAction?: string        // form 전용: 제출 시 서버로 보낼 액션 이름
  content?: string             // mockup_viewer, progress_board 전용
}
```

- [ ] **Step 6: `packages/shared/src/types/streams.ts` 작성**

```typescript
import type { UISpec } from './ui-spec.js'

export type OrchestratorMessageType = 'task_request' | 'info_response' | 'abort'
export type ManagerMessageType = 'status_update' | 'info_request' | 'task_complete' | 'error'

export interface OrchestratorToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: OrchestratorMessageType
  payload: {
    intent: string
    context: Record<string, unknown>
    priority: 'normal' | 'high'
  }
}

export interface ManagerToOrchestratorMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: ManagerMessageType
  payload: {
    agentId: string
    content: string
    uiSpec?: UISpec
  }
}
```

- [ ] **Step 7: `packages/shared/src/index.ts` 작성**

```typescript
export * from './types/message.js'
export * from './types/session.js'
export * from './types/ui-spec.js'
export * from './types/streams.js'
```

- [ ] **Step 8: shared 패키지 빌드**

```bash
cd packages/shared && pnpm build
```
Expected: `dist/` 디렉터리 생성, 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add packages/shared/
git commit -m "feat(shared): add common TypeScript types for messages, sessions, UI spec, and streams"
```

---

## Task 3: server 패키지 초기 설정 + config

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/config.ts`
- Create: `packages/server/test/config.test.ts`

- [ ] **Step 1: `packages/server/package.json` 작성**

```json
{
  "name": "@xzawed/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@xzawed/shared": "workspace:*",
    "fastify": "^5.0.0",
    "@fastify/websocket": "^11.0.0",
    "ioredis": "^5.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: `packages/server/tsconfig.json` 작성**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 의존성 설치**

```bash
pnpm install
```
Expected: `node_modules` 설치 완료, lock 파일 업데이트

- [ ] **Step 4: `packages/server/src/config.ts` 테스트 작성**

`packages/server/test/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    // 환경변수 초기화
    delete process.env.PORT
    delete process.env.CLAUDE_MODE
    delete process.env.REDIS_URL
  })

  it('defaults PORT to 3000', async () => {
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.port).toBe(3000)
  })

  it('reads PORT from env', async () => {
    process.env.PORT = '4000'
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.port).toBe(4000)
  })

  it('defaults CLAUDE_MODE to cli', async () => {
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.claudeMode).toBe('cli')
  })

  it('throws when CLAUDE_MODE=api but ANTHROPIC_API_KEY missing', async () => {
    process.env.CLAUDE_MODE = 'api'
    delete process.env.ANTHROPIC_API_KEY
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow('ANTHROPIC_API_KEY')
  })
})
```

- [ ] **Step 5: 테스트 실행 — 실패 확인**

```bash
cd packages/server && pnpm test
```
Expected: FAIL — `config.js` 없음

- [ ] **Step 6: `packages/server/src/config.ts` 구현**

```typescript
import type { ClaudeMode } from '@xzawed/shared'

export interface Config {
  port: number
  mode: 'local' | 'remote'
  auth: 'none' | 'jwt'
  claudeMode: ClaudeMode
  anthropicApiKey?: string
  claudeModel: string
  remoteCLIUrl?: string
  remoteHost?: string
  remoteUser?: string
  remoteKeyPath?: string
  redisUrl: string
}

export function loadConfig(): Config {
  const claudeMode = (process.env.CLAUDE_MODE ?? 'cli') as ClaudeMode

  if (claudeMode === 'api' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when CLAUDE_MODE=api')
  }

  if (claudeMode === 'remote' && !process.env.REMOTE_CLI_URL && !process.env.REMOTE_HOST) {
    throw new Error('REMOTE_CLI_URL or REMOTE_HOST is required when CLAUDE_MODE=remote')
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    mode: (process.env.MODE ?? 'local') as 'local' | 'remote',
    auth: (process.env.AUTH ?? 'none') as 'none' | 'jwt',
    claudeMode,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    claudeModel: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    remoteCLIUrl: process.env.REMOTE_CLI_URL,
    remoteHost: process.env.REMOTE_HOST,
    remoteUser: process.env.REMOTE_USER,
    remoteKeyPath: process.env.REMOTE_KEY_PATH,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  }
}
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
cd packages/server && pnpm test test/config.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 8: 커밋**

```bash
git add packages/server/
git commit -m "feat(server): add package scaffold and config loader with validation"
```

---

## Task 4: Claude 실행기 — ClaudeRunner 인터페이스 + APIRunner

**Files:**
- Create: `packages/server/src/claude/runner.interface.ts`
- Create: `packages/server/src/claude/api-runner.ts`
- Create: `packages/server/test/claude/api-runner.test.ts`

- [ ] **Step 1: `packages/server/src/claude/runner.interface.ts` 작성**

```typescript
import type { Chunk, Message } from '@xzawed/shared'

export interface RunOptions {
  model?: string
  systemPrompt?: string
  signal?: AbortSignal
}

export interface ClaudeRunner {
  send(messages: Message[], options?: RunOptions): AsyncIterable<Chunk>
}
```

- [ ] **Step 2: APIRunner 테스트 작성**

`packages/server/test/claude/api-runner.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Message } from '@xzawed/shared'

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      stream: vi.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }
          yield { type: 'message_stop' }
        }
      })
    }
  }
}))

describe('APIRunner', () => {
  it('streams text chunks from Anthropic API', async () => {
    const { APIRunner } = await import('../../src/claude/api-runner.js')
    const runner = new APIRunner({ apiKey: 'test-key', model: 'claude-sonnet-4-6' })

    const messages: Message[] = [{
      id: '1', sessionId: 's1', role: 'user',
      content: 'Hello', timestamp: Date.now()
    }]

    const chunks: string[] = []
    for await (const chunk of runner.send(messages)) {
      if (chunk.type === 'text') chunks.push(chunk.content)
    }

    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('yields error chunk on API failure', async () => {
    const { APIRunner } = await import('../../src/claude/api-runner.js')
    const runner = new APIRunner({ apiKey: 'bad-key', model: 'claude-sonnet-4-6' })

    vi.mocked((await import('@anthropic-ai/sdk')).default.prototype.messages.stream)
      .mockRejectedValueOnce(new Error('Unauthorized'))

    const chunks: import('@xzawed/shared').Chunk[] = []
    for await (const chunk of runner.send([])) {
      chunks.push(chunk)
    }

    expect(chunks[0]).toMatchObject({ type: 'error', content: expect.stringContaining('Unauthorized') })
  })
})
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
cd packages/server && pnpm test test/claude/api-runner.test.ts
```
Expected: FAIL — `api-runner.js` 없음

- [ ] **Step 4: `packages/server/src/claude/api-runner.ts` 구현**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'

interface APIRunnerOptions {
  apiKey: string
  model: string
}

export class APIRunner implements ClaudeRunner {
  private client: Anthropic
  private model: string

  constructor(options: APIRunnerOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model
  }

  async *send(messages: Message[], options: RunOptions = {}): AsyncIterable<Chunk> {
    try {
      const stream = this.client.messages.stream({
        model: options.model ?? this.model,
        max_tokens: 8096,
        system: options.systemPrompt,
        messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      }, { signal: options.signal })

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text', content: event.delta.text }
        }
      }

      yield { type: 'done', content: '' }
    } catch (err) {
      yield { type: 'error', content: err instanceof Error ? err.message : String(err) }
    }
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd packages/server && pnpm test test/claude/api-runner.test.ts
```
Expected: 2 tests PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/server/src/claude/ packages/server/test/claude/
git commit -m "feat(server): add ClaudeRunner interface and APIRunner with streaming"
```

---

## Task 5: Claude 실행기 — CLIRunner

**Files:**
- Create: `packages/server/src/claude/cli-runner.ts`
- Create: `packages/server/test/claude/cli-runner.test.ts`

- [ ] **Step 1: CLIRunner 테스트 작성**

`packages/server/test/claude/cli-runner.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Message } from '@xzawed/shared'

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}))

function makeMockProcess(lines: string[]) {
  const stdout = new EventEmitter() as NodeJS.EventEmitter & { on: (event: string, cb: (chunk: Buffer) => void) => NodeJS.EventEmitter }
  const proc = Object.assign(new EventEmitter(), { stdout, stderr: new EventEmitter(), pid: 1234 })

  setTimeout(() => {
    for (const line of lines) {
      stdout.emit('data', Buffer.from(line + '\n'))
    }
    proc.emit('close', 0)
  }, 0)

  return proc
}

describe('CLIRunner', () => {
  it('streams text from claude CLI stdout', async () => {
    const { spawn } = await import('node:child_process')
    vi.mocked(spawn).mockReturnValue(makeMockProcess([
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success' })
    ]) as ReturnType<typeof spawn>)

    const { CLIRunner } = await import('../../src/claude/cli-runner.js')
    const runner = new CLIRunner()
    const messages: Message[] = [{
      id: '1', sessionId: 's1', role: 'user',
      content: 'Hello', timestamp: Date.now()
    }]

    const chunks: string[] = []
    for await (const chunk of runner.send(messages)) {
      if (chunk.type === 'text') chunks.push(chunk.content)
    }
    expect(chunks).toContain('Hi')
  })

  it('yields error chunk when CLI exits with non-zero code', async () => {
    const { spawn } = await import('node:child_process')
    const proc = makeMockProcess([])
    setTimeout(() => proc.emit('close', 1), 5)
    vi.mocked(spawn).mockReturnValue(proc as ReturnType<typeof spawn>)

    const { CLIRunner } = await import('../../src/claude/cli-runner.js')
    const runner = new CLIRunner()

    const chunks: import('@xzawed/shared').Chunk[] = []
    for await (const chunk of runner.send([])) chunks.push(chunk)

    expect(chunks.some(c => c.type === 'error')).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && pnpm test test/claude/cli-runner.test.ts
```
Expected: FAIL — `cli-runner.js` 없음

- [ ] **Step 3: `packages/server/src/claude/cli-runner.ts` 구현**

```typescript
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'

export class CLIRunner implements ClaudeRunner {
  async *send(messages: Message[], options: RunOptions = {}): AsyncIterable<Chunk> {
    const lastUserMessage = messages.findLast(m => m.role === 'user')?.content ?? ''

    const proc = spawn('claude', [
      '--output-format', 'stream-json',
      '--no-interactive',
      ...(options.systemPrompt ? ['--system-prompt', options.systemPrompt] : []),
      lastUserMessage,
    ], { env: process.env })

    const rl = createInterface({ input: proc.stdout })
    let exitCode: number | null = null

    const exitPromise = new Promise<number>((resolve) => {
      proc.on('close', (code) => resolve(code ?? 1))
    })

    try {
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                yield { type: 'text', content: block.text }
              }
            }
          }
        } catch {
          // JSON 파싱 실패 라인 무시
        }
      }

      exitCode = await exitPromise
      if (exitCode !== 0) {
        yield { type: 'error', content: `claude CLI exited with code ${exitCode}` }
      } else {
        yield { type: 'done', content: '' }
      }
    } catch (err) {
      proc.kill()
      yield { type: 'error', content: err instanceof Error ? err.message : String(err) }
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd packages/server && pnpm test test/claude/cli-runner.test.ts
```
Expected: 2 tests PASS

- [ ] **Step 5: `packages/server/src/claude/runner.factory.ts` 작성**

```typescript
import type { Config } from '../config.js'
import type { ClaudeRunner } from './runner.interface.js'
import { CLIRunner } from './cli-runner.js'
import { APIRunner } from './api-runner.js'

export function createRunner(config: Config): ClaudeRunner {
  switch (config.claudeMode) {
    case 'api':
      return new APIRunner({
        apiKey: config.anthropicApiKey!,
        model: config.claudeModel,
      })
    case 'remote':
      // RemoteCLIRunner는 Task 6에서 구현. 미구현 시 CLIRunner 폴백.
      return new CLIRunner()
    case 'cli':
    default:
      return new CLIRunner()
  }
}
```

- [ ] **Step 6: 커밋**

```bash
git add packages/server/src/claude/ packages/server/test/claude/
git commit -m "feat(server): add CLIRunner for local claude CLI subprocess and runner factory"
```

---

## Task 6: Redis Streams — Producer + Consumer

**Files:**
- Create: `packages/server/src/streams/redis.client.ts`
- Create: `packages/server/src/streams/producer.ts`
- Create: `packages/server/src/streams/consumer.ts`
- Create: `packages/server/test/streams/producer.test.ts`

- [ ] **Step 1: Producer 테스트 작성**

`packages/server/test/streams/producer.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrchestratorToManagerMessage } from '@xzawed/shared'

const mockXadd = vi.fn().mockResolvedValue('1234-0')
vi.mock('ioredis', () => ({
  default: class MockRedis {
    xadd = mockXadd
    quit = vi.fn()
  }
}))

describe('StreamProducer', () => {
  beforeEach(() => { mockXadd.mockClear() })

  it('publishes message to orchestrator:to-manager stream', async () => {
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: OrchestratorToManagerMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: '쇼핑몰 만들기', context: {}, priority: 'normal' },
    }

    await producer.publish(msg)

    expect(mockXadd).toHaveBeenCalledWith(
      'orchestrator:to-manager:sess-1',
      '*',
      'data',
      JSON.stringify(msg)
    )
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && pnpm test test/streams/producer.test.ts
```
Expected: FAIL — `producer.js` 없음

- [ ] **Step 3: `packages/server/src/streams/redis.client.ts` 작성**

```typescript
import Redis from 'ioredis'

let client: Redis | null = null

export function getRedisClient(url: string): Redis {
  if (!client) {
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
  }
  return client
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
  }
}
```

- [ ] **Step 4: `packages/server/src/streams/producer.ts` 작성**

```typescript
import type { OrchestratorToManagerMessage } from '@xzawed/shared'
import { getRedisClient } from './redis.client.js'

const STREAM_KEY = (sessionId: string) => `orchestrator:to-manager:${sessionId}`

export class StreamProducer {
  private redisUrl: string

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl
  }

  async publish(message: OrchestratorToManagerMessage): Promise<string> {
    const redis = getRedisClient(this.redisUrl)
    const id = await redis.xadd(
      STREAM_KEY(message.sessionId),
      '*',
      'data',
      JSON.stringify(message)
    )
    return id!
  }
}
```

- [ ] **Step 5: `packages/server/src/streams/consumer.ts` 작성**

```typescript
import type { ManagerToOrchestratorMessage } from '@xzawed/shared'
import { getRedisClient } from './redis.client.js'

const STREAM_KEY = (sessionId: string) => `manager:to-orchestrator:${sessionId}`
const GROUP = 'orchestrator-consumers'

export type MessageHandler = (msg: ManagerToOrchestratorMessage) => Promise<void>

export class StreamConsumer {
  private running = false
  private redisUrl: string

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl
  }

  async ensureGroup(sessionId: string): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    try {
      await redis.xgroup('CREATE', STREAM_KEY(sessionId), GROUP, '$', 'MKSTREAM')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err
    }
  }

  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)
    this.running = true
    const redis = getRedisClient(this.redisUrl)
    const consumerId = `consumer-${process.pid}`

    while (this.running) {
      const results = await redis.xreadgroup(
        'GROUP', GROUP, consumerId,
        'COUNT', '10', 'BLOCK', '2000',
        'STREAMS', STREAM_KEY(sessionId), '>'
      ) as [string, [string, string[]][]][] | null

      if (!results) continue

      for (const [, entries] of results) {
        for (const [id, fields] of entries) {
          const dataIdx = fields.indexOf('data')
          if (dataIdx === -1) continue
          const msg = JSON.parse(fields[dataIdx + 1]) as ManagerToOrchestratorMessage
          await handler(msg)
          await redis.xack(STREAM_KEY(sessionId), GROUP, id)
        }
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd packages/server && pnpm test test/streams/producer.test.ts
```
Expected: 1 test PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/server/src/streams/ packages/server/test/streams/
git commit -m "feat(server): add Redis Streams producer and consumer with ACK-based delivery"
```

---

## Task 7: 세션 관리

**Files:**
- Create: `packages/server/src/sessions/session.ts`
- Create: `packages/server/src/sessions/session.store.ts`
- Create: `packages/server/test/sessions/session-store.test.ts`

- [ ] **Step 1: 세션 스토어 테스트 작성**

`packages/server/test/sessions/session-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('SessionStore', () => {
  let store: import('../../src/sessions/session.store.js').SessionStore

  beforeEach(async () => {
    const { SessionStore } = await import('../../src/sessions/session.store.js')
    store = new SessionStore()
  })

  it('creates a session with unique id', () => {
    const s1 = store.create('user-1', 'cli')
    const s2 = store.create('user-1', 'cli')
    expect(s1.id).not.toBe(s2.id)
    expect(s1.state).toBe('active')
    expect(s1.claudeMode).toBe('cli')
  })

  it('finds session by id', () => {
    const created = store.create('user-1', 'api')
    const found = store.findById(created.id)
    expect(found).toEqual(created)
  })

  it('returns undefined for missing session', () => {
    expect(store.findById('non-existent')).toBeUndefined()
  })

  it('updates session state', () => {
    const session = store.create('user-1', 'cli')
    store.updateState(session.id, 'waiting_manager')
    expect(store.findById(session.id)?.state).toBe('waiting_manager')
  })

  it('lists sessions by userId', () => {
    store.create('user-1', 'cli')
    store.create('user-1', 'cli')
    store.create('user-2', 'cli')
    expect(store.findByUserId('user-1')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && pnpm test test/sessions/session-store.test.ts
```
Expected: FAIL

- [ ] **Step 3: `packages/server/src/sessions/session.ts` 작성**

```typescript
import type { Session, SessionState, ClaudeMode } from '@xzawed/shared'
import { randomUUID } from 'node:crypto'

export function createSession(userId: string, claudeMode: ClaudeMode): Session {
  const now = Date.now()
  return {
    id: randomUUID(),
    userId,
    state: 'active',
    claudeMode,
    createdAt: now,
    updatedAt: now,
  }
}
```

- [ ] **Step 4: `packages/server/src/sessions/session.store.ts` 작성**

```typescript
import type { Session, SessionState, ClaudeMode } from '@xzawed/shared'
import { createSession } from './session.js'

export class SessionStore {
  private sessions = new Map<string, Session>()

  create(userId: string, claudeMode: ClaudeMode): Session {
    const session = createSession(userId, claudeMode)
    this.sessions.set(session.id, session)
    return session
  }

  findById(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  findByUserId(userId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId)
  }

  updateState(id: string, state: SessionState): void {
    const session = this.sessions.get(id)
    if (session) {
      session.state = state
      session.updatedAt = Date.now()
    }
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd packages/server && pnpm test test/sessions/session-store.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/server/src/sessions/ packages/server/test/sessions/
git commit -m "feat(server): add Session model and in-memory SessionStore"
```

---

## Task 8: Fastify 서버 + REST API

**Files:**
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/api/health.route.ts`
- Create: `packages/server/src/api/sessions.route.ts`
- Create: `packages/server/test/api/sessions.test.ts`

- [ ] **Step 1: Sessions API 테스트 작성**

`packages/server/test/api/sessions.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

describe('Sessions API', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    const { buildServer } = await import('../../src/server.js')
    app = await buildServer({
      port: 0,
      mode: 'local',
      auth: 'none',
      claudeMode: 'cli',
      claudeModel: 'claude-sonnet-4-6',
      redisUrl: 'redis://localhost:6379',
    })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
  })

  it('POST /sessions creates session and returns id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { userId: 'user-1' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).toHaveProperty('sessionId')
    expect(typeof body.sessionId).toBe('string')
  })

  it('GET /sessions/:id/messages returns empty array for new session', async () => {
    const create = await app.inject({
      method: 'POST', url: '/sessions', payload: { userId: 'u1' }
    })
    const { sessionId } = create.json()
    const res = await app.inject({ method: 'GET', url: `/sessions/${sessionId}/messages` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([])
  })

  it('GET /sessions/:id/messages returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions/no-such-id/messages' })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && pnpm test test/api/sessions.test.ts
```
Expected: FAIL

- [ ] **Step 3: `packages/server/src/api/health.route.ts` 작성**

```typescript
import type { FastifyInstance } from 'fastify'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', timestamp: Date.now() }))
}
```

- [ ] **Step 4: `packages/server/src/api/sessions.route.ts` 작성**

```typescript
import type { FastifyInstance } from 'fastify'
import type { SessionStore } from '../sessions/session.store.js'
import type { Message } from '@xzawed/shared'

const messageStore = new Map<string, Message[]>()

export async function sessionsRoutes(
  app: FastifyInstance,
  { store }: { store: SessionStore }
): Promise<void> {
  app.post<{ Body: { userId: string } }>('/sessions', async (req, reply) => {
    const { userId } = req.body
    const session = store.create(userId ?? 'anonymous', 'cli')
    messageStore.set(session.id, [])
    return reply.status(201).send({ sessionId: session.id })
  })

  app.get<{ Params: { id: string } }>('/sessions/:id/messages', async (req, reply) => {
    const session = store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    return messageStore.get(req.params.id) ?? []
  })

  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/sessions/:id/messages',
    async (req, reply) => {
      const session = store.findById(req.params.id)
      if (!session) return reply.status(404).send({ error: 'Session not found' })

      const msg: Message = {
        id: crypto.randomUUID(),
        sessionId: req.params.id,
        role: 'user',
        content: req.body.content,
        timestamp: Date.now(),
      }
      messageStore.get(req.params.id)?.push(msg)
      return reply.status(202).send({ messageId: msg.id, status: 'accepted' })
    }
  )

  app.get<{ Params: { id: string } }>('/sessions/:id/tasks', async (req, reply) => {
    const session = store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    return { tasks: [] }
  })
}
```

- [ ] **Step 5: `packages/server/src/server.ts` 작성**

```typescript
import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.js'
import { SessionStore } from './sessions/session.store.js'
import { healthRoutes } from './api/health.route.js'
import { sessionsRoutes } from './api/sessions.route.js'

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.mode !== 'local' })
  const store = new SessionStore()

  await app.register(healthRoutes)
  await app.register(sessionsRoutes, { store })

  return app
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd packages/server && pnpm test test/api/sessions.test.ts
```
Expected: 4 tests PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/server/src/server.ts packages/server/src/api/ packages/server/test/api/
git commit -m "feat(server): add Fastify server with health and sessions REST API"
```

---

## Task 9: WebSocket + 진입점

**Files:**
- Create: `packages/server/src/ws/session.ws.ts`
- Create: `packages/server/src/index.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: `packages/server/src/ws/session.ws.ts` 작성**

```typescript
import type { FastifyInstance } from 'fastify'
import type { SessionStore } from '../sessions/session.store.js'

export async function sessionWsRoutes(
  app: FastifyInstance,
  { store }: { store: SessionStore }
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/ws/sessions/:id',
    { websocket: true },
    (socket, req) => {
      const sessionId = req.params.id
      const session = store.findById(sessionId)

      if (!session) {
        socket.send(JSON.stringify({ type: 'error', message: 'Session not found' }))
        socket.close()
        return
      }

      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          socket.send(JSON.stringify({ type: 'ack', messageId: msg.id }))
        } catch {
          socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
        }
      })

      socket.send(JSON.stringify({ type: 'connected', sessionId }))
    }
  )
}
```

- [ ] **Step 2: `server.ts`에 WebSocket + @fastify/websocket 등록**

`packages/server/src/server.ts` 전체 교체:
```typescript
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { Config } from './config.js'
import { SessionStore } from './sessions/session.store.js'
import { healthRoutes } from './api/health.route.js'
import { sessionsRoutes } from './api/sessions.route.js'
import { sessionWsRoutes } from './ws/session.ws.js'

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.mode !== 'local' })
  const store = new SessionStore()

  await app.register(websocket)
  await app.register(healthRoutes)
  await app.register(sessionsRoutes, { store })
  await app.register(sessionWsRoutes, { store })

  return app
}
```

- [ ] **Step 3: `packages/server/src/index.ts` 작성**

```typescript
import { loadConfig } from './config.js'
import { buildServer } from './server.js'

const config = loadConfig()
const app = await buildServer(config)

await app.listen({ port: config.port, host: '0.0.0.0' })
console.log(`xzawedOrchestrator server running on port ${config.port}`)
console.log(`CLAUDE_MODE=${config.claudeMode} | MODE=${config.mode}`)
```

- [ ] **Step 4: 기존 API 테스트 여전히 통과하는지 확인**

```bash
cd packages/server && pnpm test
```
Expected: 전체 PASS (WebSocket 등록 변경 후 기존 테스트 깨지지 않아야 함)

- [ ] **Step 5: 서버 직접 기동 확인**

```bash
cd packages/server && cp ../../.env.example .env && pnpm dev
```
Expected: `xzawedOrchestrator server running on port 3000`

다른 터미널에서:
```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok","timestamp":...}`

- [ ] **Step 6: 커밋**

```bash
git add packages/server/src/ws/ packages/server/src/index.ts packages/server/src/server.ts
git commit -m "feat(server): add WebSocket endpoint and server entry point"
```

---

## Task 10: MCP 서버

**Files:**
- Create: `packages/server/src/mcp/server.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: `packages/server/src/mcp/server.ts` 작성**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { SessionStore } from '../sessions/session.store.js'

export function createMcpServer(store: SessionStore): McpServer {
  const server = new McpServer({
    name: 'xzawed-orchestrator',
    version: '0.1.0',
  })

  server.tool(
    'create_session',
    'xzawedOrchestrator에 새 세션을 생성합니다',
    { userId: z.string().describe('사용자 ID') },
    async ({ userId }) => {
      const session = store.create(userId, 'cli')
      return {
        content: [{ type: 'text', text: JSON.stringify({ sessionId: session.id }) }]
      }
    }
  )

  server.tool(
    'get_session_status',
    '세션 상태를 조회합니다',
    { sessionId: z.string().describe('세션 ID') },
    async ({ sessionId }) => {
      const session = store.findById(sessionId)
      if (!session) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(session) }] }
    }
  )

  server.tool(
    'list_sessions',
    '사용자의 세션 목록을 조회합니다',
    { userId: z.string().describe('사용자 ID') },
    async ({ userId }) => {
      const sessions = store.findByUserId(userId)
      return { content: [{ type: 'text', text: JSON.stringify(sessions) }] }
    }
  )

  return server
}

export async function startMcpStdio(store: SessionStore): Promise<void> {
  const server = createMcpServer(store)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

- [ ] **Step 2: MCP 서버 단독 실행 스크립트를 `package.json`에 추가**

`packages/server/package.json`의 `scripts`에 추가:
```json
"mcp": "tsx src/mcp/entry.ts"
```

`packages/server/src/mcp/entry.ts` 작성:
```typescript
import { SessionStore } from '../sessions/session.store.js'
import { startMcpStdio } from './server.js'

const store = new SessionStore()
await startMcpStdio(store)
```

- [ ] **Step 3: 전체 테스트 + 빌드 확인**

```bash
cd packages/server && pnpm test && pnpm build
```
Expected: 전체 PASS, `dist/` 빌드 완료

- [ ] **Step 4: 커밋**

```bash
git add packages/server/src/mcp/
git commit -m "feat(server): add MCP server with create_session, get_status, list_sessions tools"
```

---

## Task 11: 통합 연기 + CLAUDE.md 업데이트

**Files:**
- Modify: `CLAUDE.md`
- Create: `packages/server/vitest.config.ts`

- [ ] **Step 1: `packages/server/vitest.config.ts` 작성**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
  },
})
```

- [ ] **Step 2: 루트에서 전체 테스트 실행**

```bash
pnpm test
```
Expected: 모든 패키지 테스트 통과

- [ ] **Step 3: CLAUDE.md 업데이트**

`CLAUDE.md` 전체 교체:
```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedOrchestrator는 xzawed 멀티 에이전트 시스템의 **프로젝트 지휘자** 역할을 하는 서비스다.
사용자 지시를 받아 의도를 정제한 뒤 xzawedManager(총관리자, 별도 서비스)로 전달하고 회신을 중계한다.

## 핵심 명령어

```bash
# 의존성 설치
pnpm install

# 서버 개발 모드
cd packages/server && pnpm dev

# 전체 테스트
pnpm test

# 특정 패키지 테스트
cd packages/server && pnpm test

# 빌드
pnpm build

# MCP 서버 (stdio 모드)
cd packages/server && pnpm mcp
```

## 아키텍처

```
packages/
├── shared/     # 공통 TypeScript 타입 (Message, Session, UISpec, Streams)
├── server/     # Fastify 백엔드 (API, WebSocket, MCP, Claude 실행기, Redis Streams)
└── app/        # Electron 앱 (Plan 2에서 구현 예정)
```

## Claude 실행 모드

`CLAUDE_MODE` 환경변수로 전환:
- `cli` (기본): 로컬 claude CLI 서브프로세스
- `api`: Anthropic SDK 직접 호출 (ANTHROPIC_API_KEY 필요)
- `remote`: 원격 서버 CLI (REMOTE_CLI_URL 또는 SSH 설정 필요)

## 배포 모드

`MODE=local` (기본) → 내장 서버, 로컬 Redis  
`MODE=remote` → 원격 서버, HTTPS + WebSocket

## 관련 프로젝트

xzawed suite: `f:\DEVELOPMENT\SOURCE\CLAUDE\`  
- xzawedManager, xzawedPlanner, xzawedDeveloper 등 — 별도 서비스, 추후 구현
- Redis Streams 통신 포맷: `docs/superpowers/specs/2026-05-15-xzawed-orchestrator-design.md` 참고
```

- [ ] **Step 4: 최종 커밋**

```bash
git add CLAUDE.md packages/server/vitest.config.ts
git commit -m "docs: update CLAUDE.md with dev commands and architecture overview"
```

---

## 자체 검토 결과

**스펙 커버리지:**
- ✅ Task 1-2: Monorepo + 공통 타입
- ✅ Task 3-5: Claude 3모드 실행기 (CLI, API, Remote stub)
- ✅ Task 6: Redis Streams Producer + Consumer
- ✅ Task 7: 세션 관리
- ✅ Task 8: REST API (/sessions, /health)
- ✅ Task 9: WebSocket + 진입점
- ✅ Task 10: MCP 서버 (create_session, get_status, list_sessions)
- ⚠️ RemoteCLIRunner: Task 5에서 CLIRunner 폴백 stub으로 처리. 실제 SSH 구현은 Plan 2에서 필요 시 추가.
- ⚠️ Claude 오케스트레이터 로직 (의도 파악·정제): Electron 앱 연동이 필요한 고수준 로직이므로 Plan 2에서 구현.

**타입 일관성:**
- `ClaudeRunner.send()` → Task 4에서 정의, Task 5에서 동일 시그니처 사용 ✅
- `Message`, `Session`, `UISpec` → Task 2에서 정의, 이후 Tasks에서 import ✅
- `SessionStore` → Task 7에서 정의, Task 8·9·10에서 동일 인터페이스 사용 ✅

---

**다음 플랜:** `2026-05-15-orchestrator-electron-app.md` — Electron 앱 (main process, renderer, React UI, 동적 패널, Settings)
