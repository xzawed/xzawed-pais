import type { ManagerToDeveloperMessage, DeveloperToManagerMessage } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { applyChange } from './fileio.js'
import type { Config } from './config.js'
import { resolveWorkspaceRoot, createCollaborativeHandler } from '@xzawed/agent-streams'

export { resolveWorkspaceRoot }

type DeveloperPayload = ManagerToDeveloperMessage['payload']

export class Developer {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
    private readonly config: Config,
    private readonly applyFn: typeof applyChange = applyChange,
  ) {}

  async handle(message: ManagerToDeveloperMessage): Promise<void> {
    await createCollaborativeHandler<DeveloperToManagerMessage, DeveloperPayload>({
      publish: (sid, m) => this.producer.publish(sid, m),
      answerQuery: (q, c) => this.runner.answerQuery(q, c),
      completeType: 'develop_complete',
      runMain: async (payload, base) => {
        const { changes, summary, knowledge } = await this.runner.generateChanges(
          payload.plan ?? '',
          payload.projectPath ?? '.',
          payload.context,
          payload.clarificationContext,
          payload.model,
        )
        const workspaceRoot = resolveWorkspaceRoot(payload.userContext, this.config.workspaceRoot)
        const artifacts: string[] = []
        for (const change of changes) {
          await this.applyFn(change, workspaceRoot)
          if (change.operation !== 'delete') artifacts.push(change.path)
        }
        return {
          publishResult: () => this.producer.publish(base.sessionId, {
            ...base,
            type: 'develop_complete',
            payload: {
              artifacts,
              summary,
              ...(knowledge ? { knowledge } : {}),
              content: `Applied ${changes.length} change(s)`,
            },
          }),
        }
      },
    })(message)
  }
}
