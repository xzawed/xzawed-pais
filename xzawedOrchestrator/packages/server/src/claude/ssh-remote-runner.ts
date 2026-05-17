import { Client } from 'ssh2'
import { readFileSync } from 'node:fs'
import { Shescape } from 'shescape'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'
import { drainBuffer, flushRemainder } from './cli-parser.js'
import { ChunkQueue } from './chunk-queue.js'

const shescape = new Shescape({ shell: false })

export class SSHRemoteRunner implements ClaudeRunner {
  constructor(
    private readonly remoteHost: string,
    private readonly remoteUser: string,
    private readonly remoteKeyPath: string,
  ) {}

  async *send(messages: Message[], options: RunOptions = {}): AsyncIterable<Chunk> {
    let privateKey: Buffer
    try {
      privateKey = readFileSync(this.remoteKeyPath)
    } catch (err) {
      yield {
        type: 'error',
        content: `Failed to read SSH key: ${err instanceof Error ? err.message : String(err)}`,
      }
      return
    }

    const lastUserMessage = messages.findLast(m => m.role === 'user')?.content ?? ''
    const parts: string[] = ['claude']
    if (options.claudeSessionId) {
      parts.push('--resume', shescape.escape(options.claudeSessionId))
    }
    parts.push('--print', '--output-format', 'stream-json', '--verbose')
    if (options.systemPrompt) {
      parts.push('--system-prompt', shescape.escape(options.systemPrompt))
    }
    parts.push('--', shescape.escape(lastUserMessage))
    const command = parts.join(' ')

    const queue = new ChunkQueue()
    const conn = new Client()
    let buffer = ''

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          queue.push({ type: 'error', content: err.message })
          queue.close()
          return
        }

        stream.on('data', (data: Buffer) => {
          buffer = drainBuffer(buffer, data, queue.push.bind(queue))
        })

        stream.on('close', (code: number) => {
          flushRemainder(buffer, queue.push.bind(queue))
          queue.push(
            code === 0
              ? { type: 'done', content: '' }
              : { type: 'error', content: `claude CLI exited with code ${code}` },
          )
          conn.end()
          queue.close()
        })

        stream.stderr.on('data', (_data: Buffer) => {
          // stderr intentionally ignored — claude writes progress there
        })
      })
    })

    conn.on('error', (err: Error) => {
      queue.push({ type: 'error', content: `SSH error: ${err.message}` })
      queue.close()
    })

    conn.connect({
      host: this.remoteHost,
      port: 22,
      username: this.remoteUser,
      privateKey,
    })

    yield* queue
  }
}
