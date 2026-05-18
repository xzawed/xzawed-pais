import Anthropic from '@anthropic-ai/sdk'
import type { ToolRegistry } from '../tools/registry.js'
import type { StreamProducer } from '../streams/producer.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { UserContext } from '../types/user-context.js'

const REQUEST_INFO_TOOL: Anthropic.Tool = {
  name: 'request_info',
  description: 'Ask the user for additional information needed to complete the task',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to present to the user' },
    },
    required: ['question'],
  },
}

export interface RunnerOptions {
  sessionId: string
  intent: string
  context: Record<string, unknown>
  producer: StreamProducer
  sessionStore: SessionStore
  signal?: AbortSignal
  userContext?: UserContext
}

export class ClaudeRunner {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly registry: ToolRegistry,
  ) {}

  async run(options: RunnerOptions): Promise<string> {
    const { sessionId, intent, context, producer, sessionStore, signal, userContext } = options

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Task: ${intent}\n\nContext: ${JSON.stringify(context)}`,
      },
    ]

    const tools: Anthropic.Tool[] = [
      ...this.registry.toAnthropicTools(),
      REQUEST_INFO_TOOL,
    ]

    const MAX_ITERATIONS = 50
    let iterations = 0
    // 수동 tool-calling 루프: 각 도구 호출 전후에 status_update를 발행하기 위해 수동 루프 사용
    while (iterations++ < MAX_ITERATIONS) {
      if (signal?.aborted) throw new Error('Session aborted')

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: 'You are xzawedManager, a project orchestration agent. Use the available tools to fulfill the task request.',
        messages,
        tools,
      })

      messages.push({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'end_turn') {
        const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
        await producer.publish({
          sessionId,
          messageId: `${sessionId}-final-${Date.now()}`,
          timestamp: Date.now(),
          type: 'status_update',
          payload: { agentId: 'manager', content: text },
        })
        return text
      }

      if (response.stop_reason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue

          if (block.name === 'request_info') {
            const input = block.input as { question: string }
            await producer.publish({
              sessionId,
              messageId: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'info_request',
              payload: { agentId: 'manager', content: input.question },
            })
            const answer = await sessionStore.waitForInfo(sessionId)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: answer })
            continue
          }

          const handler = this.registry.get(block.name)
          if (!handler) throw new Error(`Unknown tool: ${block.name}`)

          await producer.publish({
            sessionId,
            messageId: crypto.randomUUID(),
            timestamp: Date.now(),
            type: 'status_update',
            payload: { agentId: 'manager', content: `Starting ${block.name}...` },
          })

          const result = await handler.execute(block.input, sessionId, userContext)

          await producer.publish({
            sessionId,
            messageId: crypto.randomUUID(),
            timestamp: Date.now(),
            type: 'status_update',
            payload: { agentId: 'manager', content: `Completed ${block.name}: ${JSON.stringify(result)}` },
          })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
        }

        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults })
        }
      } else {
        throw new Error(`Unexpected stop_reason: ${response.stop_reason as string}`)
      }
    }
    throw new Error(`Claude runner exceeded ${MAX_ITERATIONS} iterations without completing`)
  }
}
