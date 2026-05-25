import type { Producer } from './streams/producer.js'
import type { ClaudeRunner } from './claude/runner.js'
import { ClarificationNeeded } from './claude/runner.js'
import type { ManagerToPlannerMessage } from './types.js'

export class Planner {
  constructor(
    private readonly producer: Producer,
    private readonly runner: ClaudeRunner
  ) {}

  async handle(message: ManagerToPlannerMessage): Promise<void> {
    if (message.type === 'abort') return

    const { sessionId, payload } = message
    const { intent, context, priority } = payload

    try {
      const result = await this.runner.generatePlan(intent, context, priority)

      if (result instanceof ClarificationNeeded) {
        await this.producer.publish(sessionId, {
          sessionId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'info_request',
          payload: {
            content: result.question,
            uiSpec: {
              type: 'form',
              fields: result.fields,
            },
          },
        })
        return
      }

      await this.producer.publish(sessionId, {
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'plan_complete',
        payload: {
          steps: result.steps,
          estimatedTime: result.estimatedTime,
          content: `계획 완료: ${result.steps.length}단계, 예상 소요 ${result.estimatedTime}`,
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
}
