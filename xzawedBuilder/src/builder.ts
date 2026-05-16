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
