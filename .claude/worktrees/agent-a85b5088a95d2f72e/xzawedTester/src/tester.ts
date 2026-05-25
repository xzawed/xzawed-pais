import path from 'node:path'
import type { ManagerToTesterMessage } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { validatePath, exec } from './executor.js'
import { detectTestCommand, buildCommandWithFiles, parseTestCounts } from './detector.js'
import type { Config } from './config.js'

const ALLOWED_PREFIXES = [
  'pnpm', 'npm', 'npx', 'yarn', 'vitest', 'jest', 'mocha',
  'pytest', 'cargo test', 'go test', 'make test',
]

function validateTestCommand(cmd: string): void {
  const normalized = cmd.trim()
  const isAllowed = ALLOWED_PREFIXES.some(prefix => normalized.startsWith(prefix))
  if (!isAllowed) {
    throw new Error(`testCommand not allowed: ${normalized}`)
  }
  if (/[;&|`$><]/.test(normalized)) {
    throw new Error(`Shell metacharacters are not permitted in testCommand`)
  }
}

export class Tester {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
    private readonly config: Config,
  ) {}

  async handle(message: ManagerToTesterMessage): Promise<void> {
    const { sessionId, payload } = message

    if (message.type === 'abort') return

    const base = {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    try {
      const validatedPath = await validatePath(payload.projectPath, this.config.workspaceRoot)

      const validatedFiles: string[] = []
      if (payload.testFiles && payload.testFiles.length > 0) {
        for (const f of payload.testFiles) {
          const absFile = path.isAbsolute(f) ? f : path.resolve(validatedPath, f)
          const validFile = await validatePath(absFile, this.config.workspaceRoot)
          validatedFiles.push(validFile)
        }
      }

      if (payload.testCommand) {
        validateTestCommand(payload.testCommand)
      }
      const baseCmd = payload.testCommand ?? await detectTestCommand(validatedPath)
      const finalCmd = buildCommandWithFiles(baseCmd, validatedFiles)

      const startTime = Date.now()
      const result = await exec(finalCmd, validatedPath, () => {}, this.config.testTimeoutMs)
      const duration = Date.now() - startTime

      const { passed, failed } = parseTestCounts(result.output)
      const failures = result.success ? [] : await this.runner.analyzeFailures(result.output)

      await this.producer.publish(sessionId, {
        ...base,
        type: 'test_complete',
        payload: {
          success: result.success,
          passed,
          failed,
          failures,
          duration,
          content: result.output.slice(0, 2000),
        },
      })
    } catch (err: unknown) {
      await this.producer.publish(sessionId, {
        ...base,
        type: 'error',
        payload: {
          content: err instanceof Error ? err.message : 'Unknown error',
        },
      })
    }
  }
}
