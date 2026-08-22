import type Anthropic from '@anthropic-ai/sdk'
import type { ToolHandler } from './handler.interface.js'

export class ToolRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, ToolHandler<any, any>>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(handler: ToolHandler<any, any>): void {
    this.handlers.set(handler.name, handler)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(name: string): ToolHandler<any, any> | undefined {
    return this.handlers.get(name)
  }

  toAnthropicTools(): Anthropic.Tool[] {
    return Array.from(this.handlers.values()).map((h) => ({
      name: h.name,
      description: h.description,
      input_schema: h.inputSchema,
    }))
  }

  /**
   * 한 핸들러의 실패가 나머지의 해제를 막지 않는다 — 직렬 for에서 3번째가 reject하면
   * 4~7번째가 통째로 건너뛰어져 부분 정리가 된다. 형제 closeAll과 같은 포스처를 쓴다.
   */
  async releaseAll(sessionId: string): Promise<void> {
    await Promise.allSettled(
      Array.from(this.handlers.values()).map(async (h) => h.releaseSession?.(sessionId)),
    )
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.handlers.values()).map((h) => {
        const closeable = h as unknown as { close?: () => Promise<void> }
        return typeof closeable.close === 'function' ? closeable.close() : Promise.resolve()
      }),
    )
  }
}
