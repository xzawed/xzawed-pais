import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Message } from '@xzawed/shared'

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}))

/**
 * spawn mock을 반환하는 헬퍼.
 * stdout/stderr는 EventEmitter이며 data/end 이벤트를 수동으로 제어한다.
 */
function makeMockProcess() {
  const stdout = Object.assign(new EventEmitter(), { resume: () => {} })

  const stderr = Object.assign(new EventEmitter(), { resume: vi.fn() })
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    pid: 1234,
    kill: vi.fn(),
  })

  return proc
}

describe('CLIRunner', () => {
  it('streams text from claude CLI stdout', async () => {
    const { spawn } = await import('node:child_process')
    const proc = makeMockProcess()
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>)

    const { CLIRunner } = await import('../../src/claude/cli-runner.js')
    const runner = new CLIRunner()
    const messages: Message[] = [{
      id: '1', sessionId: 's1', role: 'user',
      content: 'Hello', timestamp: Date.now()
    }]

    const resultPromise = (async () => {
      const chunks: string[] = []
      for await (const chunk of runner.send(messages)) {
        if (chunk.type === 'text') chunks.push(chunk.content)
      }
      return chunks
    })()

    // 이벤트를 수동으로 주입
    await Promise.resolve() // 제너레이터가 첫 번째 await에 도달하도록
    proc.stdout.emit('data', Buffer.from(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }) + '\n'
    ))
    proc.emit('close', 0)

    const chunks = await resultPromise
    expect(chunks).toContain('Hi')
  })

  it('yields error chunk when CLI exits with non-zero code', async () => {
    const { spawn } = await import('node:child_process')
    const proc = makeMockProcess()
    vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>)

    const { CLIRunner } = await import('../../src/claude/cli-runner.js')
    const runner = new CLIRunner()

    const resultPromise = (async () => {
      const chunks: import('@xzawed/shared').Chunk[] = []
      for await (const chunk of runner.send([])) chunks.push(chunk)
      return chunks
    })()

    await Promise.resolve()
    proc.emit('close', 1)

    const chunks = await resultPromise
    expect(chunks.some(c => c.type === 'error')).toBe(true)
  })
})
