# xzawedBuilder 첫 번째 작동 버전 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redis Streams로 빌드 요청을 수신해 실행하고, 실패 시 Claude로 오류를 분석해 반환하는 xzawedBuilder 첫 번째 작동 버전을 구현한다.

**Architecture:** Consumer가 `manager:to-builder:{sessionId}` 스트림을 구독하고, Detector가 빌드 명령을 감지하고, Executor가 child_process로 실행하며, 실패 시 ClaudeRunner가 오류를 분석한다. Producer가 결과를 `builder:to-manager:{sessionId}`로 발행한다.

**Tech Stack:** TypeScript 5 (strict, NodeNext), Fastify 5, ioredis 5, @anthropic-ai/sdk, zod, Vitest 2, pnpm

> **작업 디렉토리:** `f:/DEVELOPMENT/SOURCE/CLAUDE/xzawedBuilder/.worktrees/feat-initial-implementation`
> 모든 git 커밋은 이 디렉토리에서 실행한다.

---

## 파일 맵

| 생성 | 경로 | 책임 |
|---|---|---|
| 신규 | `package.json` | 의존성 및 스크립트 |
| 신규 | `tsconfig.json` | TypeScript 설정 |
| 신규 | `vitest.config.ts` | 테스트 설정 |
| 신규 | `src/types.ts` | 공유 인터페이스 |
| 신규 | `src/config.ts` | 환경변수 zod 검증 |
| 신규 | `src/detector.ts` | 빌드 명령 감지 |
| 신규 | `src/detector.test.ts` | detector 단위 테스트 |
| 신규 | `src/executor.ts` | child_process 빌드 실행 |
| 신규 | `src/executor.test.ts` | executor 단위 테스트 |
| 신규 | `src/streams/producer.ts` | Redis 발행 |
| 신규 | `src/streams/producer.test.ts` | producer 단위 테스트 |
| 신규 | `src/streams/consumer.ts` | Redis 소비 |
| 신규 | `src/streams/consumer.test.ts` | consumer 단위 테스트 |
| 신규 | `src/claude/runner.ts` | Anthropic SDK 오류 분석 |
| 신규 | `src/claude/runner.test.ts` | runner 단위 테스트 |
| 신규 | `src/builder.ts` | 빌드 조율 로직 |
| 신규 | `src/builder.test.ts` | builder 단위 테스트 |
| 신규 | `src/server.ts` | Fastify /health |
| 신규 | `src/server.test.ts` | server 단위 테스트 |
| 신규 | `src/index.ts` | 진입점 |

---

### Task 1: 프로젝트 초기화

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "xzawed-builder",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx --env-file=.env watch src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "fastify": "^5.0.0",
    "ioredis": "^5.4.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: vitest.config.ts 작성**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: src/types.ts 작성**

```typescript
export interface BuildError {
  file?: string
  line?: number
  message: string
  suggestion: string
}

export interface ManagerToBuilderMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_request' | 'abort'
  payload: {
    projectPath: string
    target: 'development' | 'production'
    command?: string
    context: Record<string, unknown>
  }
}

export interface BuilderToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_complete' | 'build_progress' | 'error'
  payload: {
    success?: boolean
    output?: string
    artifacts?: string[]
    duration?: number
    errors?: BuildError[]
    content: string
  }
}
```

- [ ] **Step 5: 의존성 설치**

```bash
pnpm install
```

Expected: `node_modules/` 생성, `pnpm-lock.yaml` 생성

- [ ] **Step 6: TypeScript 컴파일 확인**

```bash
pnpm build
```

Expected: `dist/` 생성, 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add package.json tsconfig.json vitest.config.ts src/types.ts pnpm-lock.yaml
git commit -m "feat: project initialization with types and build config"
```

---

### Task 2: config.ts — 환경변수 검증

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/config.test.ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('필수 변수 누락 시 ZodError를 던진다', () => {
    expect(() => loadConfig({})).toThrow()
  })

  it('유효한 환경변수로 Config를 반환한다', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      WORKSPACE_ROOT: '/workspace',
    })
    expect(config.anthropicApiKey).toBe('sk-ant-test')
    expect(config.workspaceRoot).toBe('/workspace')
    expect(config.port).toBe(3006)
    expect(config.buildTimeoutMs).toBe(120000)
    expect(config.claudeModel).toBe('claude-sonnet-4-6')
    expect(config.mode).toBe('local')
  })

  it('WORKSPACE_ROOT 누락 시 오류를 던진다', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-test' })).toThrow()
  })

  it('PORT와 BUILD_TIMEOUT_MS를 숫자로 파싱한다', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      WORKSPACE_ROOT: '/workspace',
      PORT: '3007',
      BUILD_TIMEOUT_MS: '60000',
    })
    expect(config.port).toBe(3007)
    expect(config.buildTimeoutMs).toBe(60000)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/config.test.ts
```

Expected: FAIL — "Cannot find module './config.js'"

- [ ] **Step 3: config.ts 구현**

```typescript
// src/config.ts
import { z } from 'zod'

const ConfigSchema = z.object({
  anthropicApiKey: z.string().min(1),
  claudeModel: z.string().default('claude-sonnet-4-6'),
  redisUrl: z.string().default('redis://localhost:6379'),
  port: z.coerce.number().int().positive().default(3006),
  mode: z.enum(['local', 'remote']).default('local'),
  workspaceRoot: z.string().min(1),
  buildTimeoutMs: z.coerce.number().int().positive().default(120000),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse({
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    claudeModel: env.CLAUDE_MODEL,
    redisUrl: env.REDIS_URL,
    port: env.PORT,
    mode: env.MODE,
    workspaceRoot: env.WORKSPACE_ROOT,
    buildTimeoutMs: env.BUILD_TIMEOUT_MS,
  })
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/config.test.ts
```

Expected: PASS — 4 tests

- [ ] **Step 5: 커밋**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add config.ts with zod env validation"
```

---

### Task 3: detector.ts — 빌드 명령 자동 감지

**Files:**
- Create: `src/detector.ts`
- Create: `src/detector.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/detector.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { detectBuildCommand } from './detector.js'
import * as fs from 'node:fs/promises'

const fsMock = vi.mocked(fs)

describe('detectBuildCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('package.json에 scripts.build가 있으면 그 값을 반환한다', async () => {
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { build: 'tsc --noEmit' } }) as any
    )
    const result = await detectBuildCommand('/project')
    expect(result).toBe('tsc --noEmit')
  })

  it('package.json에 scripts.build가 없으면 pnpm run build를 반환한다', async () => {
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ name: 'myapp' }) as any)
    const result = await detectBuildCommand('/project')
    expect(result).toBe('pnpm run build')
  })

  it('package.json이 없고 Cargo.toml이 있으면 cargo build를 반환한다', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    fsMock.access.mockResolvedValueOnce(undefined as any) // Cargo.toml 존재
    const result = await detectBuildCommand('/project')
    expect(result).toBe('cargo build --release')
  })

  it('package.json, Cargo.toml이 없고 Makefile이 있으면 make build를 반환한다', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    fsMock.access.mockRejectedValueOnce(new Error('ENOENT')) // Cargo.toml 없음
    fsMock.access.mockResolvedValueOnce(undefined as any) // Makefile 존재
    const result = await detectBuildCommand('/project')
    expect(result).toBe('make build')
  })

  it('아무 파일도 없으면 오류를 던진다', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    fsMock.access.mockRejectedValue(new Error('ENOENT'))
    await expect(detectBuildCommand('/project')).rejects.toThrow('빌드 명령을 감지할 수 없음')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/detector.test.ts
```

Expected: FAIL — "Cannot find module './detector.js'"

- [ ] **Step 3: detector.ts 구현**

```typescript
// src/detector.ts
import fs from 'node:fs/promises'
import path from 'node:path'

export async function detectBuildCommand(projectPath: string): Promise<string> {
  // 1. package.json 확인
  try {
    const content = await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
    const pkg = JSON.parse(content) as { scripts?: { build?: string } }
    return pkg.scripts?.build ?? 'pnpm run build'
  } catch {}

  // 2. Cargo.toml 확인
  try {
    await fs.access(path.join(projectPath, 'Cargo.toml'))
    return 'cargo build --release'
  } catch {}

  // 3. Makefile 확인
  try {
    await fs.access(path.join(projectPath, 'Makefile'))
    return 'make build'
  } catch {}

  throw new Error('빌드 명령을 감지할 수 없음')
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/detector.test.ts
```

Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

```bash
git add src/detector.ts src/detector.test.ts
git commit -m "feat: add detector.ts with build command auto-detection"
```

---

### Task 4: executor.ts — child_process 빌드 실행

**Files:**
- Create: `src/executor.ts`
- Create: `src/executor.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/executor.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:child_process')
vi.mock('node:fs/promises')

import { exec, validatePath } from './executor.js'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'

const spawnMock = vi.mocked(spawn)
const fsMock = vi.mocked(fs)

function makeMockProc(exitCode: number, stdout = '', stderr = '') {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr))
    proc.emit('close', exitCode)
  })
  return proc
}

describe('validatePath', () => {
  beforeEach(() => vi.resetAllMocks())

  it('WORKSPACE_ROOT 내부 경로는 통과한다', async () => {
    fsMock.realpath.mockImplementation(async (p) => String(p))
    await expect(validatePath('/workspace/project', '/workspace')).resolves.toBe('/workspace/project')
  })

  it('WORKSPACE_ROOT 외부 경로는 오류를 던진다', async () => {
    fsMock.realpath.mockImplementation(async (p) => String(p))
    await expect(validatePath('/etc/passwd', '/workspace')).rejects.toThrow('경로 거부')
  })
})

describe('exec', () => {
  beforeEach(() => vi.resetAllMocks())

  it('exitCode 0이면 success: true를 반환한다', async () => {
    spawnMock.mockReturnValueOnce(makeMockProc(0, 'Build succeeded\n') as any)
    const chunks: string[] = []
    const result = await exec('pnpm build', '/project', (c) => chunks.push(c), 5000)
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Build succeeded')
    expect(chunks).toHaveLength(1)
  })

  it('exitCode 1이면 success: false를 반환한다', async () => {
    spawnMock.mockReturnValueOnce(makeMockProc(1, '', 'Error: type mismatch\n') as any)
    const result = await exec('pnpm build', '/project', () => {}, 5000)
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('Error: type mismatch')
  })

  it('타임아웃 초과 시 reject한다', async () => {
    const proc = new EventEmitter() as any
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    // 절대 close 이벤트를 발행하지 않는 프로세스
    spawnMock.mockReturnValueOnce(proc as any)

    await expect(exec('sleep 100', '/project', () => {}, 50)).rejects.toThrow('빌드 타임아웃')
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/executor.test.ts
```

Expected: FAIL — "Cannot find module './executor.js'"

- [ ] **Step 3: executor.ts 구현**

```typescript
// src/executor.ts
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface ExecResult {
  success: boolean
  output: string
  exitCode: number
  duration: number
}

export async function validatePath(projectPath: string, workspaceRoot: string): Promise<string> {
  const realProject = await fs.realpath(projectPath).catch(() => path.resolve(projectPath))
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  if (!realProject.startsWith(realRoot)) {
    throw new Error(`경로 거부: ${projectPath}`)
  }
  return realProject
}

export async function exec(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void,
  timeoutMs: number
): Promise<ExecResult> {
  const startTime = Date.now()
  const chunks: string[] = []

  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], { cwd, shell: true })
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
    }, timeoutMs)

    proc.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString()
      chunks.push(str)
      onChunk(str)
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString()
      chunks.push(str)
      onChunk(str)
    })

    proc.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`빌드 타임아웃: ${timeoutMs}ms 초과`))
        return
      }
      const exitCode = code ?? 1
      resolve({
        success: exitCode === 0,
        output: chunks.join(''),
        exitCode,
        duration: Date.now() - startTime,
      })
    })

    proc.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/executor.test.ts
```

Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

```bash
git add src/executor.ts src/executor.test.ts
git commit -m "feat: add executor.ts with path validation and streaming child_process"
```

---

### Task 5: streams/producer.ts — Redis 발행

**Files:**
- Create: `src/streams/producer.ts`
- Create: `src/streams/producer.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/streams/producer.test.ts
import { vi, describe, it, expect } from 'vitest'
import { Producer } from './producer.js'
import type { BuilderToManagerMessage } from '../types.js'

function makeRedis() {
  return { xadd: vi.fn().mockResolvedValue('1-0') }
}

const buildComplete = (sessionId: string): BuilderToManagerMessage => ({
  sessionId,
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'build_complete',
  payload: { success: true, content: '빌드 완료', duration: 500 },
})

describe('Producer', () => {
  it('build_complete를 올바른 스트림에 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await producer.publish('sess-1', buildComplete('sess-1'))
    expect(redis.xadd).toHaveBeenCalledWith(
      'builder:to-manager:sess-1',
      '*',
      'data',
      expect.stringContaining('"type":"build_complete"')
    )
  })

  it('sessionId가 다르면 다른 스트림에 발행한다', async () => {
    const redis = makeRedis()
    const producer = new Producer(redis as any)
    await producer.publish('sess-2', buildComplete('sess-2'))
    expect(redis.xadd).toHaveBeenCalledWith(
      'builder:to-manager:sess-2',
      '*',
      'data',
      expect.any(String)
    )
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/streams/producer.test.ts
```

Expected: FAIL — "Cannot find module './producer.js'"

- [ ] **Step 3: producer.ts 구현**

```typescript
// src/streams/producer.ts
import type Redis from 'ioredis'
import type { BuilderToManagerMessage } from '../types.js'

export class Producer {
  constructor(private readonly redis: Redis) {}

  async publish(sessionId: string, message: BuilderToManagerMessage): Promise<void> {
    const stream = `builder:to-manager:${sessionId}`
    await this.redis.xadd(stream, '*', 'data', JSON.stringify(message))
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/streams/producer.test.ts
```

Expected: PASS — 2 tests

- [ ] **Step 5: 커밋**

```bash
git add src/streams/producer.ts src/streams/producer.test.ts
git commit -m "feat: add streams/producer.ts for Redis Streams publishing"
```

---

### Task 6: streams/consumer.ts — Redis 소비

**Files:**
- Create: `src/streams/consumer.ts`
- Create: `src/streams/consumer.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/streams/consumer.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { Consumer } from './consumer.js'
import type { ManagerToBuilderMessage } from '../types.js'

const buildRequest: ManagerToBuilderMessage = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'build_request',
  payload: {
    projectPath: '/workspace/project',
    target: 'production',
    context: {},
  },
}

function makeRedis(messages: ManagerToBuilderMessage[] = [buildRequest]) {
  let callCount = 0
  return {
    xgroup: vi.fn().mockResolvedValue('OK'),
    xack: vi.fn().mockResolvedValue(1),
    xreadgroup: vi.fn().mockImplementation(async () => {
      if (callCount >= messages.length) return null
      const msg = messages[callCount++]
      return [['manager:to-builder:sess-1', [['1-0', ['data', JSON.stringify(msg)]]]]]
    }),
  }
}

describe('Consumer', () => {
  it('consumer group을 생성한다', async () => {
    const redis = makeRedis([])
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)
    consumer.stop()
    await consumer.start('sess-1')
    expect(redis.xgroup).toHaveBeenCalledWith(
      'CREATE', 'manager:to-builder:sess-1', 'builder-consumers', '$', 'MKSTREAM'
    )
  })

  it('BUSYGROUP 오류는 무시한다', async () => {
    const redis = makeRedis([])
    redis.xgroup.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'))
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)
    consumer.stop()
    await expect(consumer.start('sess-1')).resolves.not.toThrow()
  })

  it('메시지를 수신해 핸들러를 호출하고 xack한다', async () => {
    const redis = makeRedis([buildRequest])
    const handler = vi.fn().mockResolvedValue(undefined)
    const consumer = new Consumer(redis as any, handler)

    // 첫 메시지 처리 후 stop
    let calls = 0
    redis.xreadgroup.mockImplementation(async () => {
      if (calls++ === 0) {
        return [['manager:to-builder:sess-1', [['1-0', ['data', JSON.stringify(buildRequest)]]]]]
      }
      consumer.stop()
      return null
    })

    await consumer.start('sess-1')
    expect(handler).toHaveBeenCalledWith(buildRequest)
    expect(redis.xack).toHaveBeenCalledWith('manager:to-builder:sess-1', 'builder-consumers', '1-0')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/streams/consumer.test.ts
```

Expected: FAIL — "Cannot find module './consumer.js'"

- [ ] **Step 3: consumer.ts 구현**

```typescript
// src/streams/consumer.ts
import type Redis from 'ioredis'
import type { ManagerToBuilderMessage } from '../types.js'

const CONSUMER_GROUP = 'builder-consumers'
const CONSUMER_NAME = 'builder-1'

export class Consumer {
  private running = false

  constructor(
    private readonly redis: Redis,
    private readonly onMessage: (msg: ManagerToBuilderMessage) => Promise<void>
  ) {}

  async start(sessionId: string): Promise<void> {
    const stream = `manager:to-builder:${sessionId}`

    try {
      await this.redis.xgroup('CREATE', stream, CONSUMER_GROUP, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }

    this.running = true
    while (this.running) {
      const results = await (this.redis as any).xreadgroup(
        'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
        'COUNT', '1', 'BLOCK', '1000',
        'STREAMS', stream, '>'
      ) as [string, [string, string[]][]][] | null

      if (!results || results.length === 0) continue

      const [, messages] = results[0]
      for (const [msgId, fields] of messages) {
        const dataIdx = fields.indexOf('data')
        if (dataIdx === -1) continue
        const message = JSON.parse(fields[dataIdx + 1]) as ManagerToBuilderMessage
        await this.onMessage(message)
        await this.redis.xack(stream, CONSUMER_GROUP, msgId)
      }
    }
  }

  stop(): void {
    this.running = false
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/streams/consumer.test.ts
```

Expected: PASS — 3 tests

- [ ] **Step 5: 커밋**

```bash
git add src/streams/consumer.ts src/streams/consumer.test.ts
git commit -m "feat: add streams/consumer.ts with XREADGROUP loop"
```

---

### Task 7: claude/runner.ts — 빌드 실패 오류 분석

**Files:**
- Create: `src/claude/runner.ts`
- Create: `src/claude/runner.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/claude/runner.test.ts
import { vi, describe, it, expect } from 'vitest'

vi.mock('@anthropic-ai/sdk')

import { ClaudeRunner } from './runner.js'
import Anthropic from '@anthropic-ai/sdk'

const AnthropicMock = vi.mocked(Anthropic)

function makeClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

describe('ClaudeRunner', () => {
  it('빌드 로그에서 BuildError 배열을 반환한다', async () => {
    const mockClient = makeClient(
      '[{"file":"src/index.ts","line":10,"message":"Type error","suggestion":"타입을 명시하세요"}]'
    )
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const errors = await runner.analyzeBuildFailure('error TS2345: ...')

    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('src/index.ts')
    expect(errors[0].line).toBe(10)
    expect(errors[0].message).toBe('Type error')
    expect(errors[0].suggestion).toBe('타입을 명시하세요')
  })

  it('SDK 오류 시 fallback BuildError를 반환한다', async () => {
    const mockClient = { messages: { create: vi.fn().mockRejectedValue(new Error('API error')) } }
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const errors = await runner.analyzeBuildFailure('build failed')

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('build failed')
    expect(errors[0].suggestion).toContain('Claude 분석 실패')
  })

  it('JSON이 없는 응답에서 fallback을 반환한다', async () => {
    const mockClient = makeClient('분석할 수 없는 응답입니다.')
    AnthropicMock.mockImplementation(() => mockClient as any)

    const runner = new ClaudeRunner('sk-ant-test', 'claude-sonnet-4-6')
    const errors = await runner.analyzeBuildFailure('build output')

    expect(errors).toHaveLength(1)
    expect(errors[0].suggestion).toContain('Claude 분석 실패')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/claude/runner.test.ts
```

Expected: FAIL — "Cannot find module './runner.js'"

- [ ] **Step 3: claude/runner.ts 구현**

```typescript
// src/claude/runner.ts
import Anthropic from '@anthropic-ai/sdk'
import type { BuildError } from '../types.js'

const SYSTEM_PROMPT = `You are a build error analyzer. Given a build log, extract errors as a JSON array.
Return ONLY valid JSON array: [{"file":"path","line":42,"message":"error text","suggestion":"fix suggestion"}]
Omit file and line if not present. Always include message and suggestion.`

export class ClaudeRunner {
  private readonly client: Anthropic

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey })
  }

  async analyzeBuildFailure(output: string): Promise<BuildError[]> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Build log:\n\`\`\`\n${output}\n\`\`\`` }],
      })

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')

      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) return this.fallback(output)

      return JSON.parse(jsonMatch[0]) as BuildError[]
    } catch {
      return this.fallback(output)
    }
  }

  private fallback(output: string): BuildError[] {
    return [{
      message: output.slice(0, 500),
      suggestion: 'Claude 분석 실패 — 빌드 로그를 직접 확인하세요',
    }]
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/claude/runner.test.ts
```

Expected: PASS — 3 tests

- [ ] **Step 5: 커밋**

```bash
git add src/claude/runner.ts src/claude/runner.test.ts
git commit -m "feat: add claude/runner.ts for build failure analysis"
```

---

### Task 8: builder.ts — 빌드 조율 로직

**Files:**
- Create: `src/builder.ts`
- Create: `src/builder.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/builder.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('./detector.js')
vi.mock('./executor.js')

import { Builder } from './builder.js'
import * as detector from './detector.js'
import * as executor from './executor.js'
import type { ManagerToBuilderMessage } from './types.js'

const detectorMock = vi.mocked(detector)
const executorMock = vi.mocked(executor)

const mockConfig = {
  workspaceRoot: '/workspace',
  buildTimeoutMs: 5000,
  anthropicApiKey: 'sk-test',
  claudeModel: 'claude-sonnet-4-6',
  redisUrl: 'redis://localhost:6379',
  port: 3006,
  mode: 'local' as const,
}

const buildRequest = (override?: Partial<ManagerToBuilderMessage['payload']>): ManagerToBuilderMessage => ({
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: 1000,
  type: 'build_request',
  payload: { projectPath: '/workspace/project', target: 'production', context: {}, ...override },
})

describe('Builder', () => {
  let producer: { publish: ReturnType<typeof vi.fn> }
  let runner: { analyzeBuildFailure: ReturnType<typeof vi.fn> }
  let builder: Builder

  beforeEach(() => {
    vi.resetAllMocks()
    producer = { publish: vi.fn().mockResolvedValue(undefined) }
    runner = { analyzeBuildFailure: vi.fn().mockResolvedValue([]) }
    builder = new Builder(producer as any, runner as any, mockConfig)

    executorMock.validatePath.mockResolvedValue('/workspace/project')
    detectorMock.detectBuildCommand.mockResolvedValue('pnpm build')
    executorMock.exec.mockResolvedValue({ success: true, output: 'Build OK', exitCode: 0, duration: 100 })
  })

  it('성공 빌드 시 build_complete(success:true)를 발행한다', async () => {
    await builder.handle(buildRequest())
    const calls = producer.publish.mock.calls
    const completeCall = calls.find(([, msg]) => msg.type === 'build_complete')
    expect(completeCall).toBeDefined()
    expect(completeCall![1].payload.success).toBe(true)
    expect(completeCall![1].payload.errors).toHaveLength(0)
  })

  it('실패 빌드 시 Claude를 호출하고 build_complete(success:false)를 발행한다', async () => {
    executorMock.exec.mockResolvedValue({ success: false, output: 'Error: ...', exitCode: 1, duration: 200 })
    runner.analyzeBuildFailure.mockResolvedValue([{ message: 'Type error', suggestion: '타입 확인' }])

    await builder.handle(buildRequest())
    expect(runner.analyzeBuildFailure).toHaveBeenCalledWith('Error: ...')
    const calls = producer.publish.mock.calls
    const completeCall = calls.find(([, msg]) => msg.type === 'build_complete')
    expect(completeCall![1].payload.success).toBe(false)
    expect(completeCall![1].payload.errors).toHaveLength(1)
  })

  it('커스텀 command가 있으면 detector를 호출하지 않는다', async () => {
    await builder.handle(buildRequest({ command: 'make build' }))
    expect(detectorMock.detectBuildCommand).not.toHaveBeenCalled()
    expect(executorMock.exec).toHaveBeenCalledWith('make build', expect.any(String), expect.any(Function), 5000)
  })

  it('경로 검증 실패 시 error 메시지를 발행한다', async () => {
    executorMock.validatePath.mockRejectedValue(new Error('경로 거부: /etc/passwd'))
    await builder.handle(buildRequest({ projectPath: '/etc/passwd' }))
    const calls = producer.publish.mock.calls
    const errorCall = calls.find(([, msg]) => msg.type === 'error')
    expect(errorCall).toBeDefined()
    expect(errorCall![1].payload.content).toContain('경로 거부')
  })

  it('abort 메시지는 무시한다', async () => {
    const abortMsg: ManagerToBuilderMessage = {
      ...buildRequest(),
      type: 'abort',
    }
    await builder.handle(abortMsg)
    expect(producer.publish).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/builder.test.ts
```

Expected: FAIL — "Cannot find module './builder.js'"

- [ ] **Step 3: builder.ts 구현**

```typescript
// src/builder.ts
import { detectBuildCommand } from './detector.js'
import { exec, validatePath } from './executor.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import type { ManagerToBuilderMessage, BuilderToManagerMessage } from './types.js'
import type { Config } from './config.js'

export class Builder {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
    private readonly config: Config
  ) {}

  async handle(message: ManagerToBuilderMessage): Promise<void> {
    if (message.type === 'abort') return

    const { sessionId, payload } = message
    const { projectPath, command } = payload

    try {
      const validatedPath = await validatePath(projectPath, this.config.workspaceRoot)
      const buildCmd = command ?? await detectBuildCommand(validatedPath)

      const { success, output, duration } = await exec(
        buildCmd,
        validatedPath,
        async (chunk) => {
          await this.producer.publish(sessionId, this.makeProgress(sessionId, chunk))
        },
        this.config.buildTimeoutMs
      )

      const errors = success ? [] : await this.runner.analyzeBuildFailure(output)

      await this.producer.publish(sessionId, {
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'build_complete',
        payload: {
          success,
          output,
          duration,
          errors,
          content: success ? '빌드 완료' : `빌드 실패: ${errors.length}개 오류`,
        },
      })
    } catch (e: unknown) {
      await this.producer.publish(sessionId, {
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'error',
        payload: { content: e instanceof Error ? e.message : String(e) },
      })
    }
  }

  private makeProgress(sessionId: string, content: string): BuilderToManagerMessage {
    return {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'build_progress',
      payload: { content },
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/builder.test.ts
```

Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

```bash
git add src/builder.ts src/builder.test.ts
git commit -m "feat: add builder.ts orchestrating detect → exec → analyze → publish"
```

---

### Task 9: server.ts + index.ts — HTTP 서버 및 진입점

**Files:**
- Create: `src/server.ts`
- Create: `src/server.test.ts`
- Create: `src/index.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/server.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from './server.js'

describe('createServer', () => {
  const app = createServer()

  afterEach(async () => {
    await app.close()
  })

  it('GET /health가 200과 status:ok를 반환한다', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.status).toBe('ok')
    expect(body.service).toBe('xzawedBuilder')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/server.test.ts
```

Expected: FAIL — "Cannot find module './server.js'"

- [ ] **Step 3: server.ts 구현**

```typescript
// src/server.ts
import Fastify from 'fastify'

export function createServer() {
  const app = Fastify({ logger: false })

  app.get('/health', async () => ({
    status: 'ok',
    service: 'xzawedBuilder',
  }))

  return app
}
```

- [ ] **Step 4: 서버 테스트 통과 확인**

```bash
pnpm test src/server.test.ts
```

Expected: PASS — 1 test

- [ ] **Step 5: index.ts 작성**

```typescript
// src/index.ts
import Redis from 'ioredis'
import { loadConfig } from './config.js'
import { createServer } from './server.js'
import { Producer } from './streams/producer.js'
import { Consumer } from './streams/consumer.js'
import { ClaudeRunner } from './claude/runner.js'
import { Builder } from './builder.js'

async function main() {
  const config = loadConfig()

  const redis = new Redis(config.redisUrl)
  const producer = new Producer(redis)
  const runner = new ClaudeRunner(config.anthropicApiKey, config.claudeModel)
  const builder = new Builder(producer, runner, config)

  const sessionId = process.env.BUILDER_SESSION_ID ?? 'default'
  const consumer = new Consumer(redis, (msg) => builder.handle(msg))

  const server = createServer()
  await server.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`xzawedBuilder listening on :${config.port} (session: ${sessionId})`)

  consumer.start(sessionId).catch(console.error)

  process.on('SIGTERM', async () => {
    consumer.stop()
    await server.close()
    await redis.quit()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 6: 전체 테스트 통과 확인**

```bash
pnpm test
```

Expected: PASS — 모든 테스트 통과 (config: 4, detector: 5, executor: 5, producer: 2, consumer: 3, runner: 3, builder: 5, server: 1 = 28 tests)

- [ ] **Step 7: TypeScript 빌드 확인**

```bash
pnpm build
```

Expected: `dist/` 생성, 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add src/server.ts src/server.test.ts src/index.ts
git commit -m "feat: add server.ts health endpoint and index.ts entry point"
```

---

## 완료 기준

```bash
# 전체 테스트
pnpm test
# Expected: 28 tests passing, 0 failing

# 빌드
pnpm build
# Expected: dist/ 생성, 오류 없음

# 파일 구조 확인
ls src/
# index.ts  config.ts  detector.ts  executor.ts  builder.ts  server.ts  types.ts
ls src/streams/
# consumer.ts  producer.ts
ls src/claude/
# runner.ts
```
