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

    try {
      const { components, uiSpec } = await this.runner.generateDesign(
        payload.intent,
        payload.context,
        payload.targetFramework ?? 'react',
        payload.designSystem ?? 'tailwind',
      )

      await this.producer.publish(sessionId, {
        ...base,
        type: 'design_complete',
        payload: {
          components,
          uiSpec,
          content: `Generated ${components.length} component(s) for: ${payload.intent.slice(0, 80)}`,
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
