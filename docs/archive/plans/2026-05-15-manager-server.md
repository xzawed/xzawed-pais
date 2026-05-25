# xzawedManager Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the xzawedManager service — a standalone TypeScript server that consumes Redis Streams from xzawedOrchestrator, runs a Claude API tool-calling loop to select and execute project-management tools, and publishes results back via Redis Streams.

**Architecture:** The Manager exposes a Fastify HTTP server (port 3001) with a `POST /api/sessions/:sessionId/start` endpoint that triggers a per-session Redis Stream consumer. Each consumer starts a Claude tool-calling loop with 7 Claude-backed stub tools (`plan_task`, `develop_code`, `design_ui`, `run_tests`, `build_project`, `watch_changes`, `security_audit`). Tools implement `ToolHandler<TInput, TOutput>` so they can later be swapped for real sub-agent handlers without touching the manager loop. The `request_info` special tool lets Claude pause the loop and ask the user for additional input via Redis.

**Tech Stack:** TypeScript 5 (strict, NodeNext), `@anthropic-ai/sdk` 0.27+, `ioredis` 5 (Redis Streams, consumer groups), `zod` 3 (config validation), Fastify 5, Vitest 2, pnpm workspaces + Turborepo

---

## File Map

| File | Purpose |
|------|---------|
| `package.json` | Root workspace: turbo scripts, pnpm version |
| `tsconfig.base.json` | Shared TS options (ES2022, NodeNext, strict) |
| `pnpm-workspace.yaml` | Declares `packages/*` workspace |
| `turbo.json` | Build/test pipeline |
| `.gitignore` | Node, dist, .env |
| `.env.example` | Documents all required env vars |
| `packages/server/package.json` | Server deps + dev/test scripts |
| `packages/server/tsconfig.json` | Extends base, sets rootDir/outDir |
| `packages/server/vitest.config.ts` | Vitest node environment config |
| `packages/server/src/types/streams.ts` | Wire types: `OrchestratorToManagerMessage`, `ManagerToOrchestratorMessage`, `UISpec` |
| `packages/server/src/config.ts` | Env loading + zod parse — throws on missing vars |
| `packages/server/src/streams/redis.client.ts` | Singleton `ioredis` client |
| `packages/server/src/streams/producer.ts` | Publishes to `manager:to-orchestrator:{sessionId}` |
| `packages/server/src/streams/consumer.ts` | XREADGROUP loop on `orchestrator:to-manager:{sessionId}`, group `manager-consumers` |
| `packages/server/src/sessions/session.store.ts` | Session state: idle → running → waiting_info; `waitForInfo` / `resolveInfo` / `abort` |
| `packages/server/src/tools/handler.interface.ts` | `ToolHandler<TInput, TOutput>` + `AnthropicInputSchema` types |
| `packages/server/src/tools/registry.ts` | Registers handlers; `toAnthropicTools()` converts to SDK format |
| `packages/server/src/tools/plan-task.ts` | Claude stub for xzawedPlanner |
| `packages/server/src/tools/develop-code.ts` | Claude stub for xzawedDeveloper |
| `packages/server/src/tools/design-ui.ts` | Claude stub for xzawedDesigner |
| `packages/server/src/tools/run-tests.ts` | Claude stub for xzawedTester |
| `packages/server/src/tools/build-project.ts` | Claude stub for xzawedBuilder |
| `packages/server/src/tools/watch-changes.ts` | Claude stub for xzawedWatcher |
| `packages/server/src/tools/security-audit.ts` | Claude stub for xzawedSecurity |
| `packages/server/src/claude/runner.ts` | Tool-calling loop: calls Claude, executes tools, publishes status/info |
| `packages/server/src/api/health.route.ts` | `GET /health` Fastify plugin |
| `packages/server/src/api/sessions.route.ts` | `POST /api/sessions/:sessionId/start` Fastify plugin |
| `packages/server/src/server.ts` | Fastify factory: wires all plugins and dependencies |
| `packages/server/src/index.ts` | Entry point: load config, build server, listen |

Tests mirror `src/` under `packages/server/test/`.

---

## Task 1: Repository Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts`

- [ ] **Step 1: Initialize git repository**

```bash
cd f:/DEVELOPMENT/SOURCE/CLAUDE/xzawedManager
git init
git add 2026-05-15-xzawed-manager-design.md
git commit -m "docs: add manager design spec"
```

- [ ] **Step 2: Create root workspace files**

`package.json`:
```json
{
  "name": "xzawed-manager",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  },
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
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

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

`turbo.json`:
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
    "test": {}
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
*.log
.turbo/
```

`.env.example`:
```
# Claude
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3001
MODE=local
```

- [ ] **Step 3: Create packages/server config files**

`packages/server/package.json`:
```json
{
  "name": "@xzawed/manager-server",
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
    "fastify": "^5.0.0",
    "ioredis": "^5.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/server/tsconfig.json`:
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

`packages/server/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    isolate: true,
  },
})
```

- [ ] **Step 4: Install dependencies**

```bash
cd f:/DEVELOPMENT/SOURCE/CLAUDE/xzawedManager
pnpm install
```

Expected: `packages/server/node_modules/` created, `pnpm-lock.yaml` generated.

- [ ] **Step 5: Verify TypeScript setup**

```bash
cd packages/server && pnpm exec tsc --noEmit --allowImportingTsExtensions 2>&1 || echo "No src files yet — OK"
```

Expected: no errors (no src files yet).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json pnpm-workspace.yaml turbo.json .gitignore .env.example packages/server/package.json packages/server/tsconfig.json packages/server/vitest.config.ts pnpm-lock.yaml
git commit -m "chore: initialize workspace scaffold"
```

---

## Task 2: Stream Types + Config

**Files:**
- Create: `packages/server/src/types/streams.ts`
- Create: `packages/server/src/config.ts`
- Create: `packages/server/test/config.test.ts`

- [ ] **Step 1: Create src directory and type definitions**

`packages/server/src/types/streams.ts`:
```typescript
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

export type UIFieldType = 'text' | 'textarea' | 'select' | 'checkbox_group' | 'number'

export interface UIField {
  id: string
  type: UIFieldType
  label: string
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
}

export interface UISpec {
  type: 'form' | 'mockup_viewer' | 'progress_board'
  title?: string
  fields?: UIField[]
  submitAction?: string
  content?: string
}
```

- [ ] **Step 2: Write the failing config test**

`packages/server/test/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('loadConfig', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns parsed config when all required vars are set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key'
    process.env.REDIS_URL = 'redis://localhost:6379'
    const { loadConfig } = await import('../src/config.js')
    const config = loadConfig()
    expect(config.ANTHROPIC_API_KEY).toBe('sk-test-key')
    expect(config.PORT).toBe(3001)
    expect(config.CLAUDE_MODEL).toBe('claude-sonnet-4-6')
  })

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { loadConfig } = await import('../src/config.js')
    expect(() => loadConfig()).toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/config.test.ts
```

Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 4: Implement config**

`packages/server/src/config.ts`:
```typescript
import { z } from 'zod'

const configSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3001),
  MODE: z.enum(['local', 'remote']).default('local'),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  return configSchema.parse(process.env)
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/config.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/types/streams.ts packages/server/src/config.ts packages/server/test/config.test.ts
git commit -m "feat: add stream types and config validation"
```

---

## Task 3: Redis Client + StreamProducer

**Files:**
- Create: `packages/server/src/streams/redis.client.ts`
- Create: `packages/server/src/streams/producer.ts`
- Create: `packages/server/test/streams/producer.test.ts`

- [ ] **Step 1: Write the failing producer test**

`packages/server/test/streams/producer.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ManagerToOrchestratorMessage } from '../../src/types/streams.js'

const mockXadd = vi.fn().mockResolvedValue('1234-0')
vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    xadd = mockXadd
    quit = vi.fn()
  }
}))

describe('StreamProducer', () => {
  beforeEach(() => { mockXadd.mockClear() })

  it('publishes to manager:to-orchestrator:{sessionId} stream', async () => {
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const producer = new StreamProducer('redis://localhost:6379')

    const msg: ManagerToOrchestratorMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'status_update',
      payload: { agentId: 'manager', content: 'Starting plan_task...' },
    }

    const id = await producer.publish(msg)

    expect(id).toBe('1234-0')
    expect(mockXadd).toHaveBeenCalledWith(
      'manager:to-orchestrator:sess-1',
      '*',
      'data',
      JSON.stringify(msg)
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/streams/producer.test.ts
```

Expected: FAIL — `Cannot find module '../../src/streams/producer.js'`

- [ ] **Step 3: Implement Redis client and producer**

`packages/server/src/streams/redis.client.ts`:
```typescript
import { Redis } from 'ioredis'

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

`packages/server/src/streams/producer.ts`:
```typescript
import type { ManagerToOrchestratorMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `manager:to-orchestrator:${sessionId}`

export class StreamProducer {
  constructor(private redisUrl: string) {}

  async publish(message: ManagerToOrchestratorMessage): Promise<string> {
    const redis = getRedisClient(this.redisUrl)
    const id = await redis.xadd(
      streamKey(message.sessionId),
      '*',
      'data',
      JSON.stringify(message)
    )
    return id!
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/streams/producer.test.ts
```

Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/streams/redis.client.ts packages/server/src/streams/producer.ts packages/server/test/streams/producer.test.ts
git commit -m "feat: add Redis client singleton and StreamProducer"
```

---

## Task 4: StreamConsumer

**Files:**
- Create: `packages/server/src/streams/consumer.ts`
- Create: `packages/server/test/streams/consumer.test.ts`

- [ ] **Step 1: Write the failing consumer test**

`packages/server/test/streams/consumer.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrchestratorToManagerMessage } from '../../src/types/streams.js'

const mockXreadgroup = vi.fn()
const mockXgroup = vi.fn().mockResolvedValue('OK')
const mockXack = vi.fn().mockResolvedValue(1)

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    xreadgroup = mockXreadgroup
    xgroup = mockXgroup
    xack = mockXack
    quit = vi.fn()
  }
}))

describe('StreamConsumer', () => {
  beforeEach(() => {
    mockXreadgroup.mockReset()
    mockXgroup.mockClear()
    mockXack.mockClear()
  })

  it('calls handler for each received message and ACKs it', async () => {
    const msg: OrchestratorToManagerMessage = {
      sessionId: 'sess-1',
      messageId: 'msg-1',
      timestamp: 1000,
      type: 'task_request',
      payload: { intent: 'build app', context: {}, priority: 'normal' },
    }

    // First call: return one message. Second call: stop the loop.
    mockXreadgroup
      .mockResolvedValueOnce([
        ['orchestrator:to-manager:sess-1', [['1234-0', ['data', JSON.stringify(msg)]]]]
      ])
      .mockResolvedValueOnce(null)

    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')

    const handler = vi.fn().mockResolvedValue(undefined)

    // Stop after two iterations
    let calls = 0
    mockXreadgroup.mockImplementation(async () => {
      calls++
      if (calls === 1) {
        return [['orchestrator:to-manager:sess-1', [['1234-0', ['data', JSON.stringify(msg)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1', handler)

    expect(handler).toHaveBeenCalledWith(msg)
    expect(mockXack).toHaveBeenCalledWith(
      'orchestrator:to-manager:sess-1',
      'manager-consumers',
      '1234-0'
    )
  })

  it('creates consumer group with MKSTREAM on ensureGroup', async () => {
    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')
    await consumer.ensureGroup('sess-2')
    expect(mockXgroup).toHaveBeenCalledWith(
      'CREATE',
      'orchestrator:to-manager:sess-2',
      'manager-consumers',
      '$',
      'MKSTREAM'
    )
  })

  it('ignores BUSYGROUP error on ensureGroup', async () => {
    mockXgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group already exists'))
    const { StreamConsumer } = await import('../../src/streams/consumer.js')
    const consumer = new StreamConsumer('redis://localhost:6379')
    await expect(consumer.ensureGroup('sess-3')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/streams/consumer.test.ts
```

Expected: FAIL — `Cannot find module '../../src/streams/consumer.js'`

- [ ] **Step 3: Implement StreamConsumer**

`packages/server/src/streams/consumer.ts`:
```typescript
import type { OrchestratorToManagerMessage } from '../types/streams.js'
import { getRedisClient } from './redis.client.js'

const streamKey = (sessionId: string) => `orchestrator:to-manager:${sessionId}`
const GROUP = 'manager-consumers'

export type MessageHandler = (msg: OrchestratorToManagerMessage) => Promise<void>

export class StreamConsumer {
  private running = false

  constructor(private redisUrl: string) {}

  async ensureGroup(sessionId: string): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    try {
      await redis.xgroup('CREATE', streamKey(sessionId), GROUP, '$', 'MKSTREAM')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err
    }
  }

  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)
    this.running = true
    const redis = getRedisClient(this.redisUrl)
    const consumerId = `manager-${process.pid}`

    while (this.running) {
      const results = await redis.xreadgroup(
        'GROUP', GROUP, consumerId,
        'COUNT', '10', 'BLOCK', '2000',
        'STREAMS', streamKey(sessionId), '>'
      ) as [string, [string, string[]][]][] | null

      if (!results) continue

      for (const [, entries] of results) {
        for (const [id, fields] of entries) {
          const dataIdx = fields.indexOf('data')
          if (dataIdx === -1) continue
          const msg = JSON.parse(fields[dataIdx + 1]) as OrchestratorToManagerMessage
          await handler(msg)
          await redis.xack(streamKey(sessionId), GROUP, id)
        }
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/streams/consumer.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/streams/consumer.ts packages/server/test/streams/consumer.test.ts
git commit -m "feat: add StreamConsumer with XREADGROUP loop and manager-consumers group"
```

---

## Task 5: Session Store

**Files:**
- Create: `packages/server/src/sessions/session.store.ts`
- Create: `packages/server/test/sessions/session.store.test.ts`

- [ ] **Step 1: Write the failing session store test**

`packages/server/test/sessions/session.store.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { SessionStore } from '../../src/sessions/session.store.js'

describe('SessionStore', () => {
  it('creates a session in idle state', () => {
    const store = new SessionStore()
    store.create('sess-1')
    expect(store.get('sess-1')?.status).toBe('idle')
  })

  it('resolves waitForInfo when resolveInfo is called', async () => {
    const store = new SessionStore()
    store.create('sess-1')

    const promise = store.waitForInfo('sess-1')
    store.resolveInfo('sess-1', 'user answer')
    const answer = await promise

    expect(answer).toBe('user answer')
    expect(store.get('sess-1')?.status).toBe('running')
  })

  it('sets status to waiting_info when waitForInfo is called', () => {
    const store = new SessionStore()
    store.create('sess-1')
    void store.waitForInfo('sess-1')
    expect(store.get('sess-1')?.status).toBe('waiting_info')
  })

  it('abort resolves pending waitForInfo with ABORTED sentinel', async () => {
    const store = new SessionStore()
    store.create('sess-1')
    const promise = store.waitForInfo('sess-1')
    store.abort('sess-1')
    const answer = await promise
    expect(answer).toBe('ABORTED')
  })

  it('abort signals the AbortController', () => {
    const store = new SessionStore()
    store.create('sess-1')
    const signal = store.getAbortSignal('sess-1')
    expect(signal.aborted).toBe(false)
    store.abort('sess-1')
    expect(signal.aborted).toBe(true)
  })

  it('delete removes session', () => {
    const store = new SessionStore()
    store.create('sess-1')
    store.delete('sess-1')
    expect(store.get('sess-1')).toBeUndefined()
  })

  it('throws when getting abort signal for unknown session', () => {
    const store = new SessionStore()
    expect(() => store.getAbortSignal('unknown')).toThrow('Session not found: unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/sessions/session.store.test.ts
```

Expected: FAIL — `Cannot find module '../../src/sessions/session.store.js'`

- [ ] **Step 3: Implement SessionStore**

`packages/server/src/sessions/session.store.ts`:
```typescript
interface SessionState {
  status: 'idle' | 'running' | 'waiting_info'
  infoResolve: ((answer: string) => void) | null
  abortController: AbortController
}

export class SessionStore {
  private sessions = new Map<string, SessionState>()

  create(sessionId: string): void {
    this.sessions.set(sessionId, {
      status: 'idle',
      infoResolve: null,
      abortController: new AbortController(),
    })
  }

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  waitForInfo(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    session.status = 'waiting_info'
    return new Promise<string>((resolve) => {
      session.infoResolve = resolve
    })
  }

  resolveInfo(sessionId: string, answer: string): void {
    const session = this.sessions.get(sessionId)
    if (!session?.infoResolve) return
    session.infoResolve(answer)
    session.infoResolve = null
    session.status = 'running'
  }

  abort(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.abortController.abort()
    if (session.infoResolve) {
      session.infoResolve('ABORTED')
      session.infoResolve = null
    }
  }

  getAbortSignal(sessionId: string): AbortSignal {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return session.abortController.signal
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/sessions/session.store.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sessions/session.store.ts packages/server/test/sessions/session.store.test.ts
git commit -m "feat: add SessionStore with waitForInfo/resolveInfo/abort state machine"
```

---

## Task 6: ToolHandler Interface + Registry

**Files:**
- Create: `packages/server/src/tools/handler.interface.ts`
- Create: `packages/server/src/tools/registry.ts`
- Create: `packages/server/test/tools/registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

`packages/server/test/tools/registry.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { ToolRegistry } from '../../src/tools/registry.js'
import type { ToolHandler } from '../../src/tools/handler.interface.js'

const makeHandler = (name: string): ToolHandler => ({
  name,
  description: `Handler for ${name}`,
  inputSchema: {
    type: 'object',
    properties: { input: { type: 'string', description: 'test input' } },
    required: ['input'],
  },
  execute: vi.fn().mockResolvedValue({ result: 'ok' }),
})

describe('ToolRegistry', () => {
  it('registers a handler and retrieves it by name', () => {
    const registry = new ToolRegistry()
    const handler = makeHandler('plan_task')
    registry.register(handler)
    expect(registry.get('plan_task')).toBe(handler)
  })

  it('returns undefined for unknown handler', () => {
    const registry = new ToolRegistry()
    expect(registry.get('unknown_tool')).toBeUndefined()
  })

  it('toAnthropicTools converts handlers to Anthropic SDK format', () => {
    const registry = new ToolRegistry()
    registry.register(makeHandler('plan_task'))
    registry.register(makeHandler('develop_code'))

    const tools = registry.toAnthropicTools()

    expect(tools).toHaveLength(2)
    expect(tools[0]).toEqual({
      name: 'plan_task',
      description: 'Handler for plan_task',
      input_schema: {
        type: 'object',
        properties: { input: { type: 'string', description: 'test input' } },
        required: ['input'],
      },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/tools/registry.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tools/registry.js'`

- [ ] **Step 3: Implement interface and registry**

`packages/server/src/tools/handler.interface.ts`:
```typescript
export type AnthropicInputSchema = {
  type: 'object'
  properties: Record<string, { type: string; description: string }>
  required?: string[]
}

export interface ToolHandler<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: AnthropicInputSchema
  execute(input: TInput, sessionId: string): Promise<TOutput>
}
```

`packages/server/src/tools/registry.ts`:
```typescript
import type { ToolHandler, AnthropicInputSchema } from './handler.interface.js'

export type AnthropicTool = {
  name: string
  description: string
  input_schema: AnthropicInputSchema
}

export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>()

  register(handler: ToolHandler): void {
    this.handlers.set(handler.name, handler)
  }

  get(name: string): ToolHandler | undefined {
    return this.handlers.get(name)
  }

  toAnthropicTools(): AnthropicTool[] {
    return Array.from(this.handlers.values()).map((h) => ({
      name: h.name,
      description: h.description,
      input_schema: h.inputSchema,
    }))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/tools/registry.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools/handler.interface.ts packages/server/src/tools/registry.ts packages/server/test/tools/registry.test.ts
git commit -m "feat: add ToolHandler interface and ToolRegistry"
```

---

## Task 7: 7 Claude Stub Tool Handlers

**Files:**
- Create: `packages/server/src/tools/plan-task.ts`
- Create: `packages/server/src/tools/develop-code.ts`
- Create: `packages/server/src/tools/design-ui.ts`
- Create: `packages/server/src/tools/run-tests.ts`
- Create: `packages/server/src/tools/build-project.ts`
- Create: `packages/server/src/tools/watch-changes.ts`
- Create: `packages/server/src/tools/security-audit.ts`
- Create: `packages/server/test/tools/tools.test.ts`

- [ ] **Step 1: Write the failing tools test**

`packages/server/test/tools/tools.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  }
}))

describe('Tool stubs', () => {
  beforeEach(() => { mockCreate.mockClear() })

  it('PlanTaskHandler returns steps and estimatedTime', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Step 1: Define scope\nStep 2: Write code\nStep 3: Test' }]
    })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { PlanTaskHandler } = await import('../../src/tools/plan-task.js')
    const handler = new PlanTaskHandler(new Anthropic({ apiKey: 'test' }))

    const result = await handler.execute({ intent: 'build app', context: {} }, 'sess-1')

    expect(result.steps).toBeInstanceOf(Array)
    expect(result.steps.length).toBeGreaterThan(0)
    expect(result.estimatedTime).toBeTruthy()
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('DevelopCodeHandler returns artifacts and summary', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Created src/app.ts with main application logic' }]
    })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { DevelopCodeHandler } = await import('../../src/tools/develop-code.js')
    const handler = new DevelopCodeHandler(new Anthropic({ apiKey: 'test' }))

    const result = await handler.execute({ plan: ['step1'], projectPath: '/tmp/app' }, 'sess-1')

    expect(result.artifacts).toBeInstanceOf(Array)
    expect(result.summary).toBeTruthy()
  })

  it('DesignUiHandler returns spec and components', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'UI spec: React component with form and button' }]
    })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { DesignUiHandler } = await import('../../src/tools/design-ui.js')
    const handler = new DesignUiHandler(new Anthropic({ apiKey: 'test' }))

    const result = await handler.execute({ requirements: 'login form', stack: 'react' }, 'sess-1')

    expect(result.spec).toBeTruthy()
    expect(result.components).toBeInstanceOf(Array)
  })

  it('RunTestsHandler returns passed, failed, report', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'All 5 tests passed. Coverage: 80%.' }]
    })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { RunTestsHandler } = await import('../../src/tools/run-tests.js')
    const handler = new RunTestsHandler(new Anthropic({ apiKey: 'test' }))

    const result = await handler.execute({ artifacts: ['src/app.ts'], testTypes: ['unit'] }, 'sess-1')

    expect(typeof result.passed).toBe('number')
    expect(typeof result.failed).toBe('number')
    expect(result.report).toBeTruthy()
  })

  it('BuildProjectHandler returns success, output, artifacts', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Build successful. Output: dist/app.js' }]
    })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { BuildProjectHandler } = await import('../../src/tools/build-project.js')
    const handler = new BuildProjectHandler(new Anthropic({ apiKey: 'test' }))

    const result = await handler.execute({ projectPath: '/tmp/app', target: 'production' }, 'sess-1')

    expect(typeof result.success).toBe('boolean')
    expect(result.output).toBeTruthy()
    expect(result.artifacts).toBeInstanceOf(Array)
  })

  it('WatchChangesHandler returns watcherId and status', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Watcher started for /tmp/app. ID: watcher-001' }]
    })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { WatchChangesHandler } = await import('../../src/tools/watch-changes.js')
    const handler = new WatchChangesHandler(new Anthropic({ apiKey: 'test' }))

    const result = await handler.execute({ projectPath: '/tmp/app', triggers: ['*.ts'] }, 'sess-1')

    expect(result.watcherId).toBeTruthy()
    expect(result.status).toBeTruthy()
  })

  it('SecurityAuditHandler returns issues and score', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'No critical issues found. Score: 95/100.' }]
    })
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { SecurityAuditHandler } = await import('../../src/tools/security-audit.js')
    const handler = new SecurityAuditHandler(new Anthropic({ apiKey: 'test' }))

    const result = await handler.execute({ artifacts: ['src/app.ts'], severity: 'high' }, 'sess-1')

    expect(result.issues).toBeInstanceOf(Array)
    expect(typeof result.score).toBe('number')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/tools/tools.test.ts
```

Expected: FAIL — `Cannot find module '../../src/tools/plan-task.js'`

- [ ] **Step 3: Implement all 7 tool stubs**

`packages/server/src/tools/plan-task.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export interface PlanTaskInput {
  intent: string
  context: Record<string, unknown>
}

export interface PlanTaskOutput {
  steps: string[]
  estimatedTime: string
}

export class PlanTaskHandler implements ToolHandler<PlanTaskInput, PlanTaskOutput> {
  name = 'plan_task'
  description = 'Create a detailed step-by-step implementation plan for a development task'
  inputSchema = {
    type: 'object' as const,
    properties: {
      intent: { type: 'string', description: 'What needs to be built or accomplished' },
      context: { type: 'object', description: 'Additional context, constraints, and background' },
    },
    required: ['intent', 'context'],
  }

  constructor(private client: Anthropic) {}

  async execute(input: PlanTaskInput, _sessionId: string): Promise<PlanTaskOutput> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Create a concise implementation plan for: ${input.intent}\n\nContext: ${JSON.stringify(input.context)}`,
      }],
    })
    const text = response.content.find((b) => b.type === 'text')?.text ?? 'Plan created'
    const steps = text.split('\n').filter((s) => s.trim().length > 0).slice(0, 10)
    return { steps, estimatedTime: '1-2 hours' }
  }
}
```

`packages/server/src/tools/develop-code.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export interface DevelopCodeInput {
  plan: string[]
  projectPath: string
}

export interface DevelopCodeOutput {
  artifacts: string[]
  summary: string
}

export class DevelopCodeHandler implements ToolHandler<DevelopCodeInput, DevelopCodeOutput> {
  name = 'develop_code'
  description = 'Implement code according to a development plan in the specified project directory'
  inputSchema = {
    type: 'object' as const,
    properties: {
      plan: { type: 'array', description: 'List of implementation steps to execute' } as unknown as { type: string; description: string },
      projectPath: { type: 'string', description: 'Absolute path to the project directory' },
    },
    required: ['plan', 'projectPath'],
  }

  constructor(private client: Anthropic) {}

  async execute(input: DevelopCodeInput, _sessionId: string): Promise<DevelopCodeOutput> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Describe the code artifacts that would be created for plan: ${JSON.stringify(input.plan)} in ${input.projectPath}`,
      }],
    })
    const summary = response.content.find((b) => b.type === 'text')?.text ?? 'Code developed'
    return { artifacts: [`${input.projectPath}/src/index.ts`], summary }
  }
}
```

`packages/server/src/tools/design-ui.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export interface DesignUiInput {
  requirements: string
  stack: string
}

export interface DesignUiOutput {
  spec: string
  components: string[]
}

export class DesignUiHandler implements ToolHandler<DesignUiInput, DesignUiOutput> {
  name = 'design_ui'
  description = 'Design UI components and specifications for given requirements'
  inputSchema = {
    type: 'object' as const,
    properties: {
      requirements: { type: 'string', description: 'UI/UX requirements to implement' },
      stack: { type: 'string', description: 'Frontend technology stack (e.g. react, vue, svelte)' },
    },
    required: ['requirements', 'stack'],
  }

  constructor(private client: Anthropic) {}

  async execute(input: DesignUiInput, _sessionId: string): Promise<DesignUiOutput> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Design UI for: ${input.requirements} using ${input.stack}. List component names.`,
      }],
    })
    const spec = response.content.find((b) => b.type === 'text')?.text ?? 'UI spec created'
    return { spec, components: ['App', 'Layout', 'Form'] }
  }
}
```

`packages/server/src/tools/run-tests.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export interface RunTestsInput {
  artifacts: string[]
  testTypes: string[]
}

export interface RunTestsOutput {
  passed: number
  failed: number
  report: string
}

export class RunTestsHandler implements ToolHandler<RunTestsInput, RunTestsOutput> {
  name = 'run_tests'
  description = 'Execute test suites for the given code artifacts'
  inputSchema = {
    type: 'object' as const,
    properties: {
      artifacts: { type: 'array', description: 'List of file paths to test' } as unknown as { type: string; description: string },
      testTypes: { type: 'array', description: 'Types of tests to run: unit, integration, e2e' } as unknown as { type: string; description: string },
    },
    required: ['artifacts', 'testTypes'],
  }

  constructor(private client: Anthropic) {}

  async execute(input: RunTestsInput, _sessionId: string): Promise<RunTestsOutput> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Simulate running ${input.testTypes.join(', ')} tests for: ${input.artifacts.join(', ')}`,
      }],
    })
    const report = response.content.find((b) => b.type === 'text')?.text ?? 'Tests completed'
    return { passed: 5, failed: 0, report }
  }
}
```

`packages/server/src/tools/build-project.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export interface BuildProjectInput {
  projectPath: string
  target: string
}

export interface BuildProjectOutput {
  success: boolean
  output: string
  artifacts: string[]
}

export class BuildProjectHandler implements ToolHandler<BuildProjectInput, BuildProjectOutput> {
  name = 'build_project'
  description = 'Build the project for the specified deployment target'
  inputSchema = {
    type: 'object' as const,
    properties: {
      projectPath: { type: 'string', description: 'Absolute path to the project directory' },
      target: { type: 'string', description: 'Build target: development, production, staging' },
    },
    required: ['projectPath', 'target'],
  }

  constructor(private client: Anthropic) {}

  async execute(input: BuildProjectInput, _sessionId: string): Promise<BuildProjectOutput> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Describe building ${input.projectPath} for ${input.target} target`,
      }],
    })
    const output = response.content.find((b) => b.type === 'text')?.text ?? 'Build completed'
    return { success: true, output, artifacts: [`${input.projectPath}/dist/index.js`] }
  }
}
```

`packages/server/src/tools/watch-changes.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export interface WatchChangesInput {
  projectPath: string
  triggers: string[]
}

export interface WatchChangesOutput {
  watcherId: string
  status: string
}

export class WatchChangesHandler implements ToolHandler<WatchChangesInput, WatchChangesOutput> {
  name = 'watch_changes'
  description = 'Start a file watcher that triggers actions on specified file changes'
  inputSchema = {
    type: 'object' as const,
    properties: {
      projectPath: { type: 'string', description: 'Absolute path to the directory to watch' },
      triggers: { type: 'array', description: 'Glob patterns for files to watch (e.g. *.ts)' } as unknown as { type: string; description: string },
    },
    required: ['projectPath', 'triggers'],
  }

  constructor(private client: Anthropic) {}

  async execute(input: WatchChangesInput, sessionId: string): Promise<WatchChangesOutput> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Confirm watcher setup for ${input.projectPath} watching ${input.triggers.join(', ')}`,
      }],
    })
    const text = response.content.find((b) => b.type === 'text')?.text ?? 'Watcher started'
    return { watcherId: `watcher-${sessionId}-${Date.now()}`, status: text.slice(0, 100) }
  }
}
```

`packages/server/src/tools/security-audit.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export interface SecurityAuditInput {
  artifacts: string[]
  severity: string
}

export interface SecurityAuditOutput {
  issues: string[]
  score: number
}

export class SecurityAuditHandler implements ToolHandler<SecurityAuditInput, SecurityAuditOutput> {
  name = 'security_audit'
  description = 'Audit code artifacts for security vulnerabilities at the specified severity level'
  inputSchema = {
    type: 'object' as const,
    properties: {
      artifacts: { type: 'array', description: 'List of file paths to audit' } as unknown as { type: string; description: string },
      severity: { type: 'string', description: 'Minimum severity level to report: low, medium, high, critical' },
    },
    required: ['artifacts', 'severity'],
  }

  constructor(private client: Anthropic) {}

  async execute(input: SecurityAuditInput, _sessionId: string): Promise<SecurityAuditOutput> {
    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Security audit ${input.artifacts.join(', ')} for ${input.severity}+ severity issues`,
      }],
    })
    const text = response.content.find((b) => b.type === 'text')?.text ?? 'No issues found'
    return { issues: [], score: 95 }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/tools/tools.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/tools/ packages/server/test/tools/tools.test.ts
git commit -m "feat: add 7 Claude stub tool handlers (plan_task, develop_code, design_ui, run_tests, build_project, watch_changes, security_audit)"
```

---

## Task 8: Claude Runner (Tool-Calling Loop)

**Files:**
- Create: `packages/server/src/claude/runner.ts`
- Create: `packages/server/test/claude/runner.test.ts`

The runner sends messages to Claude with tool definitions, handles `tool_use` responses by executing tools, and loops until Claude returns `end_turn`. The special `request_info` tool pauses the loop and waits for user input via `SessionStore.waitForInfo`.

- [ ] **Step 1: Write the failing runner test**

`packages/server/test/claude/runner.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionStore } from '../../src/sessions/session.store.js'
import { ToolRegistry } from '../../src/tools/registry.js'
import type { ToolHandler } from '../../src/tools/handler.interface.js'

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  }
}))

const mockPublish = vi.fn().mockResolvedValue('1234-0')
vi.mock('../../src/streams/producer.js', () => ({
  StreamProducer: class {
    publish = mockPublish
  }
}))

describe('ClaudeRunner', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockPublish.mockClear()
  })

  it('returns final text when Claude responds with end_turn immediately', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Task analysis complete.' }],
    })

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const { ClaudeRunner } = await import('../../src/claude/runner.js')

    const registry = new ToolRegistry()
    const runner = new ClaudeRunner(new Anthropic({ apiKey: 'test' }), 'claude-haiku-4-5-20251001', registry)
    const sessionStore = new SessionStore()
    sessionStore.create('sess-1')

    const result = await runner.run({
      sessionId: 'sess-1',
      intent: 'analyze project',
      context: {},
      producer: new StreamProducer('redis://localhost:6379'),
      sessionStore,
    })

    expect(result).toBe('Task analysis complete.')
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('executes tool and continues loop when Claude uses a tool', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'I will plan this.' },
          { type: 'tool_use', id: 'tool-1', name: 'plan_task', input: { intent: 'build app', context: {} } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Planning complete.' }],
      })

    const mockToolExecute = vi.fn().mockResolvedValue({ steps: ['step1'], estimatedTime: '1h' })
    const fakeHandler: ToolHandler = {
      name: 'plan_task',
      description: 'Plan a task',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: mockToolExecute,
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const { ClaudeRunner } = await import('../../src/claude/runner.js')

    const registry = new ToolRegistry()
    registry.register(fakeHandler)
    const runner = new ClaudeRunner(new Anthropic({ apiKey: 'test' }), 'claude-haiku-4-5-20251001', registry)
    const sessionStore = new SessionStore()
    sessionStore.create('sess-1')

    const result = await runner.run({
      sessionId: 'sess-1',
      intent: 'build app',
      context: {},
      producer: new StreamProducer('redis://localhost:6379'),
      sessionStore,
    })

    expect(result).toBe('Planning complete.')
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockToolExecute).toHaveBeenCalledWith({ intent: 'build app', context: {} }, 'sess-1')
    // Two status_update publishes: starting + completed
    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(mockPublish.mock.calls[0][0]).toMatchObject({ type: 'status_update', payload: { agentId: 'manager' } })
  })

  it('publishes status_update with result content after tool completes', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tool-2', name: 'plan_task', input: { intent: 'test', context: {} } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done.' }],
      })

    const fakeHandler: ToolHandler = {
      name: 'plan_task',
      description: 'Plan',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: vi.fn().mockResolvedValue({ steps: ['a', 'b'], estimatedTime: '2h' }),
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const { ClaudeRunner } = await import('../../src/claude/runner.js')

    const registry = new ToolRegistry()
    registry.register(fakeHandler)
    const runner = new ClaudeRunner(new Anthropic({ apiKey: 'test' }), 'claude-haiku-4-5-20251001', registry)
    const sessionStore = new SessionStore()
    sessionStore.create('sess-2')

    await runner.run({
      sessionId: 'sess-2',
      intent: 'test',
      context: {},
      producer: new StreamProducer('redis://localhost:6379'),
      sessionStore,
    })

    const completionCall = mockPublish.mock.calls[1][0]
    expect(completionCall.type).toBe('status_update')
    expect(completionCall.payload.content).toContain('plan_task')
  })

  it('throws when Claude calls unknown tool', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tool-3', name: 'nonexistent_tool', input: {} },
      ],
    })

    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { StreamProducer } = await import('../../src/streams/producer.js')
    const { ClaudeRunner } = await import('../../src/claude/runner.js')

    const registry = new ToolRegistry()
    const runner = new ClaudeRunner(new Anthropic({ apiKey: 'test' }), 'claude-haiku-4-5-20251001', registry)
    const sessionStore = new SessionStore()
    sessionStore.create('sess-3')

    await expect(runner.run({
      sessionId: 'sess-3',
      intent: 'test',
      context: {},
      producer: new StreamProducer('redis://localhost:6379'),
      sessionStore,
    })).rejects.toThrow('Unknown tool: nonexistent_tool')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/claude/runner.test.ts
```

Expected: FAIL — `Cannot find module '../../src/claude/runner.js'`

- [ ] **Step 3: Implement ClaudeRunner**

`packages/server/src/claude/runner.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { ToolRegistry } from '../tools/registry.js'
import type { StreamProducer } from '../streams/producer.js'
import type { SessionStore } from '../sessions/session.store.js'

const REQUEST_INFO_TOOL: Anthropic.Tool = {
  name: 'request_info',
  description: 'Ask the user for additional information needed to complete the task',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to present to the user' },
    },
    required: ['question'],
  },
}

export interface RunnerOptions {
  sessionId: string
  intent: string
  context: Record<string, unknown>
  producer: StreamProducer
  sessionStore: SessionStore
  signal?: AbortSignal
}

export class ClaudeRunner {
  constructor(
    private client: Anthropic,
    private model: string,
    private registry: ToolRegistry
  ) {}

  async run(options: RunnerOptions): Promise<string> {
    const { sessionId, intent, context, producer, sessionStore, signal } = options

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Task: ${intent}\n\nContext: ${JSON.stringify(context)}`,
      },
    ]

    const tools: Anthropic.Tool[] = [
      ...this.registry.toAnthropicTools().map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool['input_schema'],
      })),
      REQUEST_INFO_TOOL,
    ]

    while (true) {
      if (signal?.aborted) throw new Error('Session aborted')

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: 'You are xzawedManager, a project orchestration agent. Use the available tools to fulfill the task request.',
        messages,
        tools,
      })

      messages.push({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'end_turn') {
        const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
        return text
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue

          if (block.name === 'request_info') {
            const input = block.input as { question: string }
            await producer.publish({
              sessionId,
              messageId: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'info_request',
              payload: { agentId: 'manager', content: input.question },
            })
            const answer = await sessionStore.waitForInfo(sessionId)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: answer })
            continue
          }

          const handler = this.registry.get(block.name)
          if (!handler) throw new Error(`Unknown tool: ${block.name}`)

          await producer.publish({
            sessionId,
            messageId: crypto.randomUUID(),
            timestamp: Date.now(),
            type: 'status_update',
            payload: { agentId: 'manager', content: `Starting ${block.name}...` },
          })

          const result = await handler.execute(block.input, sessionId)

          await producer.publish({
            sessionId,
            messageId: crypto.randomUUID(),
            timestamp: Date.now(),
            type: 'status_update',
            payload: { agentId: 'manager', content: `Completed ${block.name}: ${JSON.stringify(result)}` },
          })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        }

        messages.push({ role: 'user', content: toolResults })
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/claude/runner.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/claude/runner.ts packages/server/test/claude/runner.test.ts
git commit -m "feat: add ClaudeRunner with tool-calling loop, status_update publishing, and info_request pause/resume"
```

---

## Task 9: Fastify Server (Health + Sessions Routes)

**Files:**
- Create: `packages/server/src/api/health.route.ts`
- Create: `packages/server/src/api/sessions.route.ts`
- Create: `packages/server/src/server.ts`
- Create: `packages/server/test/api/health.test.ts`
- Create: `packages/server/test/api/sessions.test.ts`

- [ ] **Step 1: Write the failing health test**

`packages/server/test/api/health.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { healthRoute } from '../../src/api/health.route.js'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = Fastify()
    await app.register(healthRoute)
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Run health test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/api/health.test.ts
```

Expected: FAIL — `Cannot find module '../../src/api/health.route.js'`

- [ ] **Step 3: Implement health route**

`packages/server/src/api/health.route.ts`:
```typescript
import type { FastifyInstance } from 'fastify'

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }))
}
```

- [ ] **Step 4: Run health test to verify it passes**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/api/health.test.ts
```

Expected: PASS (1 test)

- [ ] **Step 5: Write the failing sessions route test**

`packages/server/test/api/sessions.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { sessionsRoute } from '../../src/api/sessions.route.js'
import { SessionStore } from '../../src/sessions/session.store.js'

const mockConsumerStart = vi.fn().mockResolvedValue(undefined)
const mockConsumerStop = vi.fn()

vi.mock('../../src/streams/consumer.js', () => ({
  StreamConsumer: class {
    start = mockConsumerStart
    stop = mockConsumerStop
  }
}))

describe('POST /api/sessions/:sessionId/start', () => {
  it('returns 202 with sessionId and status started', async () => {
    const mockRun = vi.fn().mockResolvedValue('Task complete')
    const mockPublish = vi.fn().mockResolvedValue('1234-0')
    const sessionStore = new SessionStore()

    const app = Fastify()
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: mockRun } as never,
      producer: { publish: mockPublish } as never,
      sessionStore,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/sess-1/start',
    })

    expect(response.statusCode).toBe(202)
    expect(JSON.parse(response.body)).toEqual({ sessionId: 'sess-1', status: 'started' })
  })

  it('returns 409 when session is already active', async () => {
    const app = Fastify()
    const sessionStore = new SessionStore()
    await app.register(sessionsRoute, {
      redisUrl: 'redis://localhost:6379',
      runner: { run: vi.fn() } as never,
      producer: { publish: vi.fn() } as never,
      sessionStore,
    })

    await app.inject({ method: 'POST', url: '/api/sessions/sess-dup/start' })
    const response = await app.inject({ method: 'POST', url: '/api/sessions/sess-dup/start' })

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'Session already active' })
  })
})
```

- [ ] **Step 6: Run sessions test to verify it fails**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/api/sessions.test.ts
```

Expected: FAIL — `Cannot find module '../../src/api/sessions.route.js'`

- [ ] **Step 7: Implement sessions route**

`packages/server/src/api/sessions.route.ts`:
```typescript
import type { FastifyInstance } from 'fastify'
import { StreamConsumer } from '../streams/consumer.js'
import type { StreamProducer } from '../streams/producer.js'
import type { ClaudeRunner, RunnerOptions } from '../claude/runner.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { OrchestratorToManagerMessage } from '../types/streams.js'

interface SessionsRouteOptions {
  redisUrl: string
  runner: ClaudeRunner
  producer: StreamProducer
  sessionStore: SessionStore
}

export async function sessionsRoute(
  app: FastifyInstance,
  opts: SessionsRouteOptions
): Promise<void> {
  const { redisUrl, runner, producer, sessionStore } = opts
  const activeConsumers = new Map<string, StreamConsumer>()

  app.post<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/start',
    async (req, reply) => {
      const { sessionId } = req.params

      if (activeConsumers.has(sessionId)) {
        return reply.status(409).send({ error: 'Session already active' })
      }

      const consumer = new StreamConsumer(redisUrl)
      activeConsumers.set(sessionId, consumer)
      sessionStore.create(sessionId)

      void consumer.start(sessionId, async (msg: OrchestratorToManagerMessage) => {
        if (msg.type === 'task_request') {
          void (async () => {
            try {
              const result = await runner.run({
                sessionId,
                intent: msg.payload.intent,
                context: msg.payload.context,
                producer,
                sessionStore,
                signal: sessionStore.getAbortSignal(sessionId),
              } satisfies RunnerOptions)

              await producer.publish({
                sessionId,
                messageId: crypto.randomUUID(),
                timestamp: Date.now(),
                type: 'task_complete',
                payload: { agentId: 'manager', content: result },
              })
            } catch (err) {
              await producer.publish({
                sessionId,
                messageId: crypto.randomUUID(),
                timestamp: Date.now(),
                type: 'error',
                payload: {
                  agentId: 'manager',
                  content: err instanceof Error ? err.message : String(err),
                },
              })
            } finally {
              sessionStore.delete(sessionId)
              activeConsumers.delete(sessionId)
            }
          })()
        } else if (msg.type === 'info_response') {
          sessionStore.resolveInfo(sessionId, msg.payload.intent)
        } else if (msg.type === 'abort') {
          sessionStore.abort(sessionId)
          consumer.stop()
          activeConsumers.delete(sessionId)
        }
      })

      return reply.status(202).send({ sessionId, status: 'started' })
    }
  )
}
```

- [ ] **Step 8: Implement Fastify server factory**

`packages/server/src/server.ts`:
```typescript
import Fastify from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import type { Config } from './config.js'
import { healthRoute } from './api/health.route.js'
import { sessionsRoute } from './api/sessions.route.js'
import { StreamProducer } from './streams/producer.js'
import { SessionStore } from './sessions/session.store.js'
import { ToolRegistry } from './tools/registry.js'
import { ClaudeRunner } from './claude/runner.js'
import { PlanTaskHandler } from './tools/plan-task.js'
import { DevelopCodeHandler } from './tools/develop-code.js'
import { DesignUiHandler } from './tools/design-ui.js'
import { RunTestsHandler } from './tools/run-tests.js'
import { BuildProjectHandler } from './tools/build-project.js'
import { WatchChangesHandler } from './tools/watch-changes.js'
import { SecurityAuditHandler } from './tools/security-audit.js'

export async function buildServer(config: Config) {
  const app = Fastify({ logger: config.MODE === 'local' })

  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

  const registry = new ToolRegistry()
  registry.register(new PlanTaskHandler(client))
  registry.register(new DevelopCodeHandler(client))
  registry.register(new DesignUiHandler(client))
  registry.register(new RunTestsHandler(client))
  registry.register(new BuildProjectHandler(client))
  registry.register(new WatchChangesHandler(client))
  registry.register(new SecurityAuditHandler(client))

  const runner = new ClaudeRunner(client, config.CLAUDE_MODEL, registry)
  const producer = new StreamProducer(config.REDIS_URL)
  const sessionStore = new SessionStore()

  await app.register(healthRoute)
  await app.register(sessionsRoute, {
    redisUrl: config.REDIS_URL,
    runner,
    producer,
    sessionStore,
  })

  return app
}
```

- [ ] **Step 9: Run all API tests to verify they pass**

```bash
cd packages/server && pnpm test -- --reporter=verbose test/api/
```

Expected: PASS (3 tests — 1 health + 2 sessions)

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/api/ packages/server/src/server.ts packages/server/test/api/
git commit -m "feat: add Fastify server with health and sessions routes"
```

---

## Task 10: Entry Point + Full Test Suite

**Files:**
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Implement entry point**

`packages/server/src/index.ts`:
```typescript
import { loadConfig } from './config.js'
import { buildServer } from './server.js'
import { closeRedisClient } from './streams/redis.client.js'

const config = loadConfig()
const server = await buildServer(config)

const shutdown = async () => {
  await server.close()
  await closeRedisClient()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

await server.listen({ port: config.PORT, host: '0.0.0.0' })
console.log(`xzawedManager running on port ${config.PORT}`)
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd packages/server && pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run the full test suite**

```bash
cd f:/DEVELOPMENT/SOURCE/CLAUDE/xzawedManager && pnpm test
```

Expected: All tests PASS. Output should show:
```
✓ test/config.test.ts (2)
✓ test/streams/producer.test.ts (1)
✓ test/streams/consumer.test.ts (3)
✓ test/sessions/session.store.test.ts (7)
✓ test/tools/registry.test.ts (3)
✓ test/tools/tools.test.ts (7)
✓ test/claude/runner.test.ts (4)
✓ test/api/health.test.ts (1)
✓ test/api/sessions.test.ts (2)

Test Files  9 passed
Tests      30 passed
```

- [ ] **Step 4: Build to verify dist output**

```bash
cd packages/server && pnpm build
```

Expected: `dist/` directory created with `.js` and `.d.ts` files.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: add entry point and verify full build + test suite"
```

- [ ] **Step 6: Move the design spec into docs**

```bash
mkdir -p docs/superpowers/specs
mv 2026-05-15-xzawed-manager-design.md docs/superpowers/specs/
git add docs/
git commit -m "docs: move design spec to docs/superpowers/specs/"
```

---

## Summary

After all 10 tasks:

- **30 tests pass** across 9 test files
- **`pnpm build`** produces clean TypeScript output in `dist/`
- **`POST /api/sessions/:sessionId/start`** triggers a per-session Redis Stream consumer
- **`GET /health`** returns `{ status: 'ok' }`
- **7 Claude stub tools** implement `ToolHandler<TInput, TOutput>` and are replaceable with real sub-agent handlers
- **`ClaudeRunner`** loops Claude tool-calling, publishes `status_update` on each tool call, handles `info_request` pause/resume, and publishes `task_complete` on completion
- **`SessionStore`** tracks session state and provides `waitForInfo` / `resolveInfo` / `abort` for the info-request flow

**Next steps (out of scope for this plan):**
- Update xzawedOrchestrator to call `POST /api/sessions/:sessionId/start` when creating a session
- Implement real sub-agents (xzawedPlanner etc.) and swap Claude stubs for `RedisAgentHandler`
- Add JWT authentication
- Add PostgreSQL session persistence
