import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 1234,
    on: vi.fn(),
    once: vi.fn((_event: string, cb: () => void) => { cb() }),
    kill: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })),
}))
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '[]'),
  mkdirSync: vi.fn(),
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } })) // NOSONAR

import { McpProcessManager } from '../../src/main/mcp-process-manager.js'

describe('McpProcessManager', () => {
  let manager: McpProcessManager

  beforeEach(() => { manager = new McpProcessManager() })
  afterEach(() => manager.stopAll())

  it('서버를 추가하고 목록에 반환한다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    expect(manager.listServers()).toHaveLength(1)
    expect(manager.listServers()[0].id).toBe('ctx7')
  })

  it('서버를 시작하면 status가 running이 된다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.startServer('ctx7')
    expect(manager.getStatus('ctx7')).toBe('running')
  })

  it('서버를 제거하면 목록에서 사라진다', async () => {
    await manager.addServer({ id: 'ctx7', name: 'context7', command: 'npx', args: ['@upstash/context7-mcp'], env: {}, autoStart: false })
    await manager.removeServer('ctx7')
    expect(manager.listServers()).toHaveLength(0)
  })
})
