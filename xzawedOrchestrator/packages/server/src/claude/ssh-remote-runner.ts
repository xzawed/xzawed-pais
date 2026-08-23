import { Client } from 'ssh2'
import { readFileSync } from 'node:fs'
import type { Chunk, Message } from '@xzawed/shared'
import type { ClaudeRunner, RunOptions } from './runner.interface.js'
import { drainBuffer, flushRemainder } from './cli-parser.js'
import { ChunkQueue } from './chunk-queue.js'
import { posixQuote } from './posix-shell-quote.js'

/**
 * `conn.exec()` 에 넘길 명령 문자열 하나를 조립한다.
 *
 * 컴파일 상수가 아닌 값은 **전부** `posixQuote` 를 거친다 — 원격 로그인 셸이 이
 * 문자열을 파싱하는 시점에는 원격 `claude` 프로세스가 아직 존재하지도 않는다.
 *
 * **`--` 구분자는 셸 주입 방어가 아니다.** 셸이 단어 분해를 이미 끝낸 뒤에야 `claude`
 * 가 argv 를 본다. `--` 가 실제로 하는 일은 하나뿐이다 — 인용 덕에 단어 하나로 살아남은
 * `--output-format=evil` 같은 프롬프트가 CLI 플래그로 읽히는 것을 막는다.
 *
 * 클래스 메서드가 아니라 export 된 순수 함수인 이유: 기존 테스트가 `ssh2` 를 통째로
 * mock 하고 `exec` 의 첫 인자를 `_cmd` 로 버려 **명령 문자열을 아무도 검증하지 않았다.**
 * 그것이 이 결함이 살아남은 이유다. 순수 함수로 빼면 mock 과 무관하게 고정된다.
 */
export function buildRemoteCommand(lastUserMessage: string, options: RunOptions = {}): string {
  const parts: string[] = ['claude']
  if (options.claudeSessionId) {
    parts.push('--resume', posixQuote(options.claudeSessionId))
  }
  parts.push('--print', '--output-format', 'stream-json', '--verbose')
  if (options.systemPrompt) {
    parts.push('--system-prompt', posixQuote(options.systemPrompt))
  }
  parts.push('--', posixQuote(lastUserMessage))
  return parts.join(' ')
}

export class SSHRemoteRunner implements ClaudeRunner {
  private privateKey: Buffer | undefined

  constructor(
    private readonly remoteHost: string,
    private readonly remoteUser: string,
    private readonly remoteKeyPath: string,
  ) {}

  async *send(messages: Message[], options: RunOptions = {}): AsyncIterable<Chunk> {
    if (!this.privateKey) {
      try {
        this.privateKey = readFileSync(this.remoteKeyPath)
      } catch (err) {
        yield {
          type: 'error',
          content: `Failed to read SSH key: ${err instanceof Error ? err.message : String(err)}`,
        }
        return
      }
    }
    const privateKey = this.privateKey

    const lastUserMessage = messages.findLast(m => m.role === 'user')?.content ?? ''
    const command = buildRemoteCommand(lastUserMessage, options)

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
