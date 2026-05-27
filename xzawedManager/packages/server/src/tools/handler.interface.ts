import type Anthropic from '@anthropic-ai/sdk'
import type { UserContext } from '../types/user-context.js'

export type AnthropicInputSchema = Anthropic.Tool['input_schema']

export interface ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> {
  name: string
  description: string
  inputSchema: AnthropicInputSchema
  execute(input: TInput, sessionId: string, userContext?: UserContext): Promise<TOutput>
  releaseSession?(sessionId: string): void
}
