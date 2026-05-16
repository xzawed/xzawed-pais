import type Anthropic from '@anthropic-ai/sdk'

export type AnthropicInputSchema = Anthropic.Tool['input_schema']

export interface ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> {
  name: string
  description: string
  inputSchema: AnthropicInputSchema
  execute(input: TInput, sessionId: string): Promise<TOutput>
}
