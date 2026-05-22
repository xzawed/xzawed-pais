import Anthropic from '@anthropic-ai/sdk'
import type { ToolRegistry } from '../tools/registry.js'
import type { StreamProducer } from '../streams/producer.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { UserContext } from '../types/user-context.js'
import type { ManagerToOrchestratorMessage } from '../types/streams.js'

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

  private async publishStatus(
    producer: StreamProducer,
    sessionId: string,
    content: string,
    type: ManagerToOrchestratorMessage['type'] = 'status_update',
  ): Promise<void> {
    await producer.publish({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type,
      payload: { agentId: 'manager', content },
    })
  }

  private async handleRequestInfoTool(
    block: Anthropic.ToolUseBlock,
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const inputObj = block.input as Record<string, unknown>
    if (typeof inputObj['question'] !== 'string') {
      throw new TypeError(`request_info tool call missing required 'question' field`)
    }
    await this.publishStatus(producer, sessionId, inputObj['question'], 'info_request')
    const answer = await sessionStore.waitForInfo(sessionId)
    return { type: 'tool_result', tool_use_id: block.id, content: answer }
  }

  private async handleAgentTool(
    block: Anthropic.ToolUseBlock,
    sessionId: string,
    producer: StreamProducer,
    userContext?: UserContext,
  ): Promise<Anthropic.ToolResultBlockParam> {
    const handler = this.registry.get(block.name)
    if (!handler) throw new Error(`Unknown tool: ${block.name}`)

    await this.publishStatus(producer, sessionId, `Starting ${block.name}...`)
    const result = await handler.execute(block.input, sessionId, userContext)
    await this.publishStatus(producer, sessionId, `Completed ${block.name}: ${JSON.stringify(result)}`)

    const resultStr = JSON.stringify(result)
    return {
      type: 'tool_result',
      tool_use_id: block.id,
      content: resultStr.length > 4000 ? resultStr.slice(0, 4000) + '...[truncated]' : resultStr,
    }
  }

  private async processToolUseBlocks(
    blocks: Anthropic.ContentBlock[],
    sessionId: string,
    producer: StreamProducer,
    sessionStore: SessionStore,
    userContext?: UserContext,
  ): Promise<Anthropic.ToolResultBlockParam[]> {
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue
      if (block.name === 'request_info') {
        toolResults.push(await this.handleRequestInfoTool(block, sessionId, producer, sessionStore))
      } else {
        toolResults.push(await this.handleAgentTool(block, sessionId, producer, userContext))
      }
    }
    return toolResults
  }

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
        max_tokens: 16384,
        system: 'You are xzawedManager, a project orchestration agent. Use the available tools to fulfill the task request. Keep your responses concise — always prefer calling a tool over writing lengthy analysis.',
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
        const toolResults = await this.processToolUseBlocks(
          response.content, sessionId, producer, sessionStore, userContext,
        )
        if (toolResults.length === 0) {
          throw new Error('stop_reason was tool_use but no tool_use blocks found in response')
        }
        messages.push({ role: 'user', content: toolResults })
      } else {
        throw new Error(`Unexpected stop_reason: ${response.stop_reason as string}`)
      }
    }
    throw new Error(`Claude runner exceeded ${MAX_ITERATIONS} iterations without completing`)
  }
}
