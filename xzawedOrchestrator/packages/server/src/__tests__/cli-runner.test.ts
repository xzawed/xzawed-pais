import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import type { Chunk, Message } from '@xzawed/shared'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

import { spawn } from 'node:child_process'
import { CLIRunner } from '../claude/cli-runner.js'

function makeMockProc(): ChildProcess {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter }
  proc.stdout = new EventEmitter()
  return proc as unknown as ChildProcess
}

async function collectChunks(gen: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = []
  for await (const c of gen) chunks.push(c)
  return chunks
}

const USER_MSG: Message = {
  id: 'msg-1',
  sessionId: 'sess-1',
  role: 'user',
  content: 'hello',
  timestamp: 0,
}

describe('CLIRunner', () => {
  let mockProc: ReturnType<typeof makeMockProc> & { stdout: EventEmitter }

  beforeEach(() => {
    vi.clearAllMocks()
    mockProc = makeMockProc() as ReturnType<typeof makeMockProc> & { stdout: EventEmitter }
    vi.mocked(spawn).mockReturnValue(mockProc)
  })

  it('emits claude_session chunk from system/init event', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG])

    setImmediate(() => {
      ;(mockProc as unknown as EventEmitter & { stdout: EventEmitter }).stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-abc' }) + '\n'
        )
      )
      ;(mockProc as unknown as EventEmitter).emit('close', 0)
    })

    const chunks = await collectChunks(gen)
    expect(chunks).toContainEqual({ type: 'claude_session', content: 'sess-abc' })
    expect(chunks.at(-1)).toEqual({ type: 'done', content: '' })
  })

  it('emits text chunks from assistant message', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG])

    setImmediate(() => {
      ;(mockProc as unknown as EventEmitter & { stdout: EventEmitter }).stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Hello world' }] },
          }) + '\n'
        )
      )
      ;(mockProc as unknown as EventEmitter).emit('close', 0)
    })

    const chunks = await collectChunks(gen)
    expect(chunks).toContainEqual({ type: 'text', content: 'Hello world' })
    expect(chunks.at(-1)).toEqual({ type: 'done', content: '' })
  })

  it('emits error chunk on non-zero exit code', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG])

    setImmediate(() => {
      ;(mockProc as unknown as EventEmitter).emit('close', 1)
    })

    const chunks = await collectChunks(gen)
    expect(chunks).toEqual([{ type: 'error', content: 'claude CLI exited with code 1' }])
  })

  it('emits error chunk on process error event', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG])

    setImmediate(() => {
      ;(mockProc as unknown as EventEmitter).emit('error', new Error('ENOENT'))
    })

    const chunks = await collectChunks(gen)
    expect(chunks).toEqual([{ type: 'error', content: 'ENOENT' }])
  })

  it('passes --resume flag when claudeSessionId provided', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG], { claudeSessionId: 'existing-sess' })

    setImmediate(() => {
      ;(mockProc as unknown as EventEmitter).emit('close', 0)
    })

    await collectChunks(gen)
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--resume', 'existing-sess']),
      expect.any(Object)
    )
  })

  it('omits --resume flag when no claudeSessionId', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG])

    setImmediate(() => {
      ;(mockProc as unknown as EventEmitter).emit('close', 0)
    })

    await collectChunks(gen)
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args).not.toContain('--resume')
  })

  it('sends last user message content as final CLI argument', async () => {
    const messages: Message[] = [
      { id: '1', sessionId: 's', role: 'user', content: 'first', timestamp: 0 },
      { id: '2', sessionId: 's', role: 'assistant', content: 'reply', timestamp: 1 },
      { id: '3', sessionId: 's', role: 'user', content: 'second question', timestamp: 2 },
    ]
    const runner = new CLIRunner()
    const gen = runner.send(messages)

    setImmediate(() => {
      ;(mockProc as unknown as EventEmitter).emit('close', 0)
    })

    await collectChunks(gen)
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(args.at(-1)).toBe('second question')
  })

  it('flushes remaining buffer on process close', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG])

    setImmediate(() => {
      // Emit without trailing newline — should be flushed on close
      ;(mockProc as unknown as EventEmitter & { stdout: EventEmitter }).stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'partial' }] },
          })
        )
      )
      ;(mockProc as unknown as EventEmitter).emit('close', 0)
    })

    const chunks = await collectChunks(gen)
    expect(chunks).toContainEqual({ type: 'text', content: 'partial' })
  })

  it('handles multi-line stdout in a single data event', async () => {
    const runner = new CLIRunner()
    const gen = runner.send([USER_MSG])

    setImmediate(() => {
      const line1 = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'line one' }] },
      })
      const line2 = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'line two' }] },
      })
      ;(mockProc as unknown as EventEmitter & { stdout: EventEmitter }).stdout.emit(
        'data',
        Buffer.from(line1 + '\n' + line2 + '\n')
      )
      ;(mockProc as unknown as EventEmitter).emit('close', 0)
    })

    const chunks = await collectChunks(gen)
    const textChunks = chunks.filter(c => c.type === 'text')
    expect(textChunks).toEqual([
      { type: 'text', content: 'line one' },
      { type: 'text', content: 'line two' },
    ])
  })
})
