import { AgentQuery } from '@xzawed/agent-streams'
import type { ManagerToDesignerMessage } from './types.js'
import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'

export class Designer {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner,
  ) {}

  async handle(message: ManagerToDesignerMessage): Promise<void> {
    const { sessionId, payload } = message

    if (message.type === 'abort') return

    const base = {
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
    }

    // 질의 응답 모드: 다른 에이전트가 던진 query에 답한다
    if (payload.query !== undefined) {
      try {
        const answer = await this.runner.answerQuery(payload.query, payload.context)
        await this.producer.publish(sessionId, {
          ...base,
          type: 'design_complete',
          payload: { content: answer },
        })
      } catch (err: unknown) {
        await this.producer.publish(sessionId, {
          ...base,
          type: 'error',
          payload: { content: err instanceof Error ? err.message : 'Unknown error' },
        })
      }
      return
    }

    try {
      const result = await this.runner.generateDesign(
        payload.intent,
        payload.context,
        payload.targetFramework ?? 'react',
        payload.designSystem ?? 'tailwind',
        payload.clarificationContext,
      )

      // 다른 에이전트에게 질의가 필요하면 agent_query 발행
      if (result instanceof AgentQuery) {
        await this.producer.publish(sessionId, {
          ...base,
          type: 'agent_query',
          payload: {
            content: result.question,
            to: result.to,
            question: result.question,
            kind: result.kind,
          },
        })
        return
      }

      await this.producer.publish(sessionId, {
        ...base,
        type: 'design_complete',
        payload: {
          components: result.components,
          uiSpec: result.uiSpec,
          content: `Generated ${result.components.length} component(s) for: ${payload.intent.slice(0, 80)}`,
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
