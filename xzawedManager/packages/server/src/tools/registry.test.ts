import { describe, it, expect, vi } from 'vitest'
import { ToolRegistry } from './registry.js'
import type { ToolHandler } from './handler.interface.js'

function makeHandler(name: string, releaseSession?: ToolHandler['releaseSession']): ToolHandler {
  return {
    name,
    description: name,
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: vi.fn().mockResolvedValue(undefined),
    ...(releaseSession && { releaseSession }),
  }
}

describe('ToolRegistry.releaseAll — 부분 정리 금지 (5-B)', () => {
  it('T10 — 한 핸들러가 reject해도 나머지 전부가 해제된다', async () => {
    const calls: string[] = []
    const registry = new ToolRegistry()
    registry.register(makeHandler('a', async (sid) => { calls.push('a:' + sid) }))
    registry.register(makeHandler('b', async () => { throw new Error('b 실패') }))
    registry.register(makeHandler('c', async (sid) => { calls.push('c:' + sid) }))

    await expect(registry.releaseAll('s1')).resolves.toBeUndefined()
    expect(calls).toEqual(['a:s1', 'c:s1'])
  })

  it('동기 releaseSession도 그대로 지원한다 (하위호환)', async () => {
    const seen: string[] = []
    const registry = new ToolRegistry()
    registry.register(makeHandler('sync', (sid) => { seen.push(sid) }))

    await registry.releaseAll('s2')
    expect(seen).toEqual(['s2'])
  })

  it('releaseSession이 없는 핸들러는 건너뛴다', async () => {
    const registry = new ToolRegistry()
    registry.register(makeHandler('none'))
    await expect(registry.releaseAll('s3')).resolves.toBeUndefined()
  })
})
