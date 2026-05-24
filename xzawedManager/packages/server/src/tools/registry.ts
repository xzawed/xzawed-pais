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

  async closeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.handlers.values()).map((h) => {
        const closeable = h as unknown as { close?: () => Promise<void> }
        return typeof closeable.close === 'function' ? closeable.close() : Promise.resolve()
      }),
    )
  }
}
