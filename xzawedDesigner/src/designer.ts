import { AgentQuery, createCollaborativeHandler } from '@xzawed/agent-streams'
import type { ManagerToDesignerMessage, DesignerToManagerMessage } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'

type DesignerPayload = ManagerToDesignerMessage['payload']

export class Designer {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
  ) {}

  async handle(message: ManagerToDesignerMessage): Promise<void> {
    await createCollaborativeHandler<DesignerToManagerMessage, DesignerPayload>({
      publish: (sid, m) => this.producer.publish(sid, m),
      answerQuery: (q, c) => this.runner.answerQuery(q, c),
      completeType: 'design_complete',
      runMain: async (payload, base) => {
        const result = await this.runner.generateDesign(
          payload.intent,
          payload.context,
          payload.targetFramework ?? 'react',
          payload.designSystem ?? 'tailwind',
          payload.clarificationContext,
        )
        if (result instanceof AgentQuery) return result
        return {
          publishResult: () => this.producer.publish(base.sessionId, {
            ...base,
            type: 'design_complete',
            payload: {
              components: result.components,
              uiSpec: result.uiSpec,
              ...(result.knowledge ? { knowledge: result.knowledge } : {}),
              content: `Generated ${result.components.length} component(s) for: ${payload.intent.slice(0, 80)}`,
            },
          }),
        }
      },
      publishAgentQuery: (aq, base, sid) => this.producer.publish(sid, {
        ...base,
        type: 'agent_query',
        payload: { content: aq.question, to: aq.to, question: aq.question, kind: aq.kind },
      }),
    })(message)
  }
}
