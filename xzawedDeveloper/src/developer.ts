import type { ManagerToDeveloperMessage } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { applyChange } from './fileio.js'
import type { Config } from './config.js'

export function resolveWorkspaceRoot(
  userContext: { workspaceRoot: string; [key: string]: unknown } | undefined,
  fallback: string | undefined,
): string {
  return (userContext?.workspaceRoot || fallback) ?? process.env.WORKSPACE_ROOT!
}

export class Developer {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
    private readonly config: Config,
    private readonly applyFn: typeof applyChange = applyChange,
  ) {}

  async handle(message: ManagerToDeveloperMessage): Promise<void> {
    const { sessionId, payload } = message

    if (message.type === 'abort') return

    const base = {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    try {
      const { changes, summary } = await this.runner.generateChanges(
        payload.plan,
        payload.projectPath,
        payload.context,
      )

      const workspaceRoot = resolveWorkspaceRoot(payload.userContext, this.config.workspaceRoot)
      const artifacts: string[] = []
      for (const change of changes) {
        await this.applyFn(change, workspaceRoot)
        if (change.operation !== 'delete') {
          artifacts.push(change.path)
        }
      }

      await this.producer.publish(sessionId, {
        ...base,
        type: 'develop_complete',
        payload: {
          artifacts,
          summary,
          content: `Applied ${changes.length} change(s)`,
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
