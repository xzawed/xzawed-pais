import type { ManagerToDeveloperMessage } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { applyChange } from './fileio.js'
import type { Config } from './config.js'
import { resolveWorkspaceRoot, runCollaborativeHandle, makeCollaborationContext } from '@xzawed/agent-streams'
import type { DeveloperToManagerMessage } from './types.js'

export { resolveWorkspaceRoot }

export class Developer {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
    private readonly config: Config,
    private readonly applyFn: typeof applyChange = applyChange,
  ) {}

  async handle(message: ManagerToDeveloperMessage): Promise<void> {
    const { sessionId, payload } = message
    const { base, publishQueryAnswer, publishError } = makeCollaborationContext<DeveloperToManagerMessage>(
      (m) => this.producer.publish(sessionId, m), sessionId, 'develop_complete',
    )

    await runCollaborativeHandle({
      isAbort: message.type === 'abort',
      query: payload.query,
      context: payload.context,
      answerQuery: (q, c) => this.runner.answerQuery(q, c),
      publishQueryAnswer,
      runMain: async () => {
        const { changes, summary } = await this.runner.generateChanges(
          payload.plan ?? '',
          payload.projectPath ?? '.',
          payload.context,
          payload.clarificationContext,
        )
        const workspaceRoot = resolveWorkspaceRoot(payload.userContext, this.config.workspaceRoot)
        const artifacts: string[] = []
        for (const change of changes) {
          await this.applyFn(change, workspaceRoot)
          if (change.operation !== 'delete') artifacts.push(change.path)
        }
        return {
          publishResult: () => this.producer.publish(sessionId, {
            ...base,
            type: 'develop_complete',
            payload: { artifacts, summary, content: `Applied ${changes.length} change(s)` },
          }),
        }
      },
      publishError,
    })
  }
}
