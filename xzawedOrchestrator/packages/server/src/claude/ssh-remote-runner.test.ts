import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Message } from '@xzawed/shared'
import { EventEmitter } from 'node:events'

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('fake-private-key')),
}))

vi.mock('ssh2', () => {
  return { Client: vi.fn() }
})

import { Client } from 'ssh2'
import { SSHRemoteRunner } from './ssh-remote-runner.js'

const MockClient = vi.mocked(Client)
const MSG: Message = { id: '1', sessionId: 's', role: 'user', content: 'hello world', timestamp: 0 }

interface MockStream extends EventEmitter {
  stderr: EventEmitter
  _lines: string[]
  _exitCode: number
}

function makeStream(stdoutLines: string[], exitCode = 0): MockStream {
  return Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    _lines: stdoutLines,
    _exitCode: exitCode,
  }) as MockStream
}

function makeClientInstance(opts: {
  execStream?: MockStream
  execError?: Error
  connectError?: Error
}) {
  const inst = Object.assign(new EventEmitter(), {
    connect: vi.fn().mockImplementation(() => {
      if (opts.connectError) {
        setTimeout(() => inst.emit('error', opts.connectError), 0)
      } else {
        setTimeout(() => inst.emit('ready'), 0)
      }
    }),
    exec: vi.fn().mockImplementation((_cmd: string, cb: (err: Error | undefined, stream: unknown) => void) => {
      if (opts.execError) {
        cb(opts.execError, undefined)
      } else {
        const stream = opts.execStream!
        cb(undefined, stream)
        // Fire events after exec callback registers handlers
        setImmediate(() => {
          for (const line of stream._lines) {
            stream.emit('data', Buffer.from(line + '\n'))
          }
          stream.emit('close', stream._exitCode, null)
        })
      }
    }),
    end: vi.fn(),
  })
  return inst
}

describe('SSHRemoteRunner', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('yields error when SSH key file cannot be read', async () => {
    const { readFileSync } = await import('node:fs')
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file')
    })

    const runner = new SSHRemoteRunner('host', 'user', '/no/such/key')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results[0]).toMatchObject({ type: 'error', content: expect.stringContaining('ENOENT') })
  })

  it('yields error on SSH connection failure', async () => {
    const inst = makeClientInstance({ connectError: new Error('Connection refused') })
    MockClient.mockImplementation(function () { return inst as unknown as InstanceType<typeof Client> })

    const runner = new SSHRemoteRunner('host', 'user', '/key')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results[0]).toMatchObject({ type: 'error', content: expect.stringContaining('Connection refused') })
  })

  it('yields error when exec fails', async () => {
    const inst = makeClientInstance({ execError: new Error('exec failed') })
    MockClient.mockImplementation(function () { return inst as unknown as InstanceType<typeof Client> })

    const runner = new SSHRemoteRunner('host', 'user', '/key')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results[0]).toMatchObject({ type: 'error', content: 'exec failed' })
  })

  it('yields text chunks and done from successful SSH execution', async () => {
    const jsonLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Result text' }] },
    })
    const stream = makeStream([jsonLine])
    const inst = makeClientInstance({ execStream: stream })
    MockClient.mockImplementation(function () { return inst as unknown as InstanceType<typeof Client> })

    const runner = new SSHRemoteRunner('host', 'user', '/key')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results).toContainEqual({ type: 'text', content: 'Result text' })
    expect(results).toContainEqual({ type: 'done', content: '' })
  })

  it('conn.exec 에 실제로 넘기는 명령에서 프롬프트가 인용된다', async () => {
    // **이 자리가 결함이 살아남은 이유다.** 기존 5개 테스트는 전송 계층만 보고,
    // exec mock 이 첫 인자를 `_cmd` 로 버려 명령 문자열을 아무도 검증하지 않았다.
    // buildRemoteCommand 가 순수 함수로 통과해도 클래스가 그것을 실제로 쓰지 않으면
    // 무의미하므로, 러너의 실제 send() 경로를 통과시켜 캡처한다.
    const stream = makeStream([])
    const inst = makeClientInstance({ execStream: stream })
    MockClient.mockImplementation(function () { return inst as unknown as InstanceType<typeof Client> })

    const runner = new SSHRemoteRunner('host', 'user', '/key')
    const injected = { ...MSG, content: 'summarize; echo nope' }
    for await (const _chunk of runner.send([injected])) { void _chunk }

    expect(inst.exec).toHaveBeenCalledWith(
      "claude --print --output-format stream-json --verbose -- 'summarize; echo nope'",
      expect.any(Function),
    )
  })

  it('yields error chunk when remote process exits non-zero', async () => {
    const stream = makeStream([], 1)
    const inst = makeClientInstance({ execStream: stream })
    MockClient.mockImplementation(function () { return inst as unknown as InstanceType<typeof Client> })

    const runner = new SSHRemoteRunner('host', 'user', '/key')
    const results: object[] = []
    for await (const chunk of runner.send([MSG])) results.push(chunk)

    expect(results[0]).toMatchObject({ type: 'error', content: expect.stringContaining('code 1') })
  })
})
