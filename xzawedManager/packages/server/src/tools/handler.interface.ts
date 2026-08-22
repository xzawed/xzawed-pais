import type Anthropic from '@anthropic-ai/sdk'
import type { UserContext } from '../types/user-context.js'

export type AnthropicInputSchema = Anthropic.Tool['input_schema']

export interface ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> {
  name: string
  description: string
  inputSchema: AnthropicInputSchema
  execute(input: TInput, sessionId: string, userContext?: UserContext): Promise<TOutput>
  /** 세션 종료 시 핸들러별 세션 상태를 해제한다. 비동기 정리(게이트웨이 종료 통지 등)를
   *  허용하되 **절대 throw하지 않는다** — registry.releaseAll이 형제 핸들러를 계속 돌려야 한다. */
  releaseSession?(sessionId: string): void | Promise<void>
}
