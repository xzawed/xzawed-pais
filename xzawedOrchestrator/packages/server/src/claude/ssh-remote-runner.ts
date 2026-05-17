import { Client } from 'ssh2'
import { readFileSync } from 'node:fs'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function parseCLILine(line: string): Chunk | null {
  if (!line.trim()) return null
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    if (
      event.type === 'system' &&
      event.subtype === 'init' &&
      typeof event.session_id === 'string'
    ) {
      return { type: 'claude_session', content: event.session_id }
    }
    if (event.type === 'assistant') {
      const content = (event.message as { content?: unknown[] })?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type: string; text?: string }
          if (b.type === 'text' && b.text !== undefined) {
            return { type: 'text', content: b.text }
          }
        }
      }
    }
  } catch { /* ignore */ }
  return null
}

export class SSHRemoteRunner implements ClaudeRunner {
  constructor(
    private remoteHost: string,
    private remoteUser: string,
    private remoteKeyPath: string,
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
      parts.push('--resume', shellEscape(options.claudeSessionId))
    }
    parts.push('--print', '--output-format', 'stream-json', '--verbose')
    if (options.systemPrompt) {
      parts.push('--system-prompt', shellEscape(options.systemPrompt))
    }
    parts.push('--', shellEscape(lastUserMessage))
    const command = parts.join(' ')

    const pending: Chunk[] = []
    let closed = false
    let wakeup: (() => void) | null = null

    const signal = () => {
      if (wakeup) {
        const fn = wakeup
        wakeup = null
        fn()
      }
    }

    const conn = new Client()
    let buffer = ''

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          pending.push({ type: 'error', content: err.message })
          closed = true
          signal()
          return
        }

        stream.on('data', (data: Buffer) => {
          buffer += data.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const chunk = parseCLILine(line)
            if (chunk) pending.push(chunk)
          }
          signal()
        })

        stream.on('close', (code: number) => {
          if (buffer.trim()) {
            const chunk = parseCLILine(buffer)
            if (chunk) pending.push(chunk)
          }
          pending.push(
            code === 0
              ? { type: 'done', content: '' }
              : { type: 'error', content: `claude CLI exited with code ${code}` },
          )
          closed = true
          conn.end()
          signal()
        })

        stream.stderr.on('data', (_data: Buffer) => {
          // stderr intentionally ignored — claude writes progress there
        })
      })
    })

    conn.on('error', (err: Error) => {
      pending.push({ type: 'error', content: `SSH error: ${err.message}` })
      closed = true
      signal()
    })

    conn.connect({
      host: this.remoteHost,
      port: 22,
      username: this.remoteUser,
      privateKey,
    })

    while (true) {
      while (pending.length > 0) {
        const next = pending.shift()
        if (next !== undefined) yield next
      }
      if (closed) break
      await new Promise<void>(r => {
        wakeup = r
        if (pending.length > 0 || closed) {
          wakeup = null
          r()
        }
      })
    }
  }
}
