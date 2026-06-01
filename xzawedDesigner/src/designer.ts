import { AgentQuery, runCollaborativeHandle, makeCollaborationContext } from '@xzawed/agent-streams'
import type { ManagerToDesignerMessage, DesignerToManagerMessage } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'

export class Designer {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
  ) {}

  async handle(message: ManagerToDesignerMessage): Promise<void> {
    const { sessionId, payload } = message
    const { base, publishQueryAnswer, publishError } = makeCollaborationContext<DesignerToManagerMessage>(
      (m) => this.producer.publish(sessionId, m), sessionId, 'design_complete',
    )

    await runCollaborativeHandle({
      isAbort: message.type === 'abort',
      query: payload.query,
      context: payload.context,
      answerQuery: (q, c) => this.runner.answerQuery(q, c),
      publishQueryAnswer,
      runMain: async () => {
        const result = await this.runner.generateDesign(
          payload.intent,
          payload.context,
          payload.targetFramework ?? 'react',
          payload.designSystem ?? 'tailwind',
          payload.clarificationContext,
        )
        if (result instanceof AgentQuery) return result
        return {
          publishResult: () => this.producer.publish(sessionId, {
            ...base,
            type: 'design_complete',
            payload: {
              components: result.components,
              uiSpec: result.uiSpec,
              content: `Generated ${result.components.length} component(s) for: ${payload.intent.slice(0, 80)}`,
            },
          }),
        }
      },
      publishAgentQuery: (aq) =>
        this.producer.publish(sessionId, {
          ...base,
          type: 'agent_query',
          payload: { content: aq.question, to: aq.to, question: aq.question, kind: aq.kind },
        }),
      publishError,
    })
  }
}
