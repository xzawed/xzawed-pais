import fs from 'node:fs/promises'
import path from 'node:path'
import { detectBuildInfo } from './detector.js'
import { exec, validatePath } from './executor.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import type { ManagerToBuilderMessage, BuilderToManagerMessage } from './types.js'
import type { Config } from './config.js'

const ALLOWED_PREFIXES = [
  'pnpm', 'npm', 'npx', 'yarn',
  'cargo build', 'make', 'cmake',
  'gradle', 'mvn', 'go build',
  'tsc', 'webpack', 'vite build',
]

function validateBuildCommand(cmd: string): void {
  const normalized = cmd.trim()
  const isAllowed = ALLOWED_PREFIXES.some(prefix => normalized.startsWith(prefix))
  if (!isAllowed) {
    throw new Error(`Build command not allowed: ${normalized}`)
  }
  if (/[;&|`$><]/.test(normalized)) {
    throw new Error(`Shell metacharacters are not permitted in build command`)
  }
}

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

      let buildCmd: string
      let buildRoot: string

      if (command) {
        validateBuildCommand(command)
        buildCmd = command
        buildRoot = validatedPath
      } else {
        const detected = await detectBuildInfo(validatedPath, this.config.workspaceRoot)
        buildCmd = detected.command
        buildRoot = detected.buildRoot
      }

      await this.runPreInstall(buildRoot, sessionId)

      const { success, output, duration } = await exec(
        buildCmd,
        buildRoot,
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

  private async runPreInstall(buildRoot: string, sessionId: string): Promise<void> {
    const hasPkg = await fs.access(path.join(buildRoot, 'package.json')).then(() => true).catch(() => false)
    if (!hasPkg) return

    const hasModules = await fs.access(path.join(buildRoot, 'node_modules')).then(() => true).catch(() => false)
    if (hasModules) return

    const hasPnpmLock = await fs.access(path.join(buildRoot, 'pnpm-lock.yaml')).then(() => true).catch(() => false)
    const installCmd = hasPnpmLock ? 'pnpm install' : 'npm install'

    await exec(
      installCmd,
      buildRoot,
      async (chunk) => {
        await this.producer.publish(sessionId, this.makeProgress(sessionId, chunk))
      },
      this.config.buildTimeoutMs,
    )
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
