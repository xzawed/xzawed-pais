import { describe, it, expect, vi } from 'vitest'
import { ToolRegistry } from '../../src/tools/registry.js'
import type { ToolHandler } from '../../src/tools/handler.interface.js'

const makeHandler = (name: string): ToolHandler => ({
  name,
  description: `Handler for ${name}`,
  inputSchema: {
    type: 'object',
    properties: { input: { type: 'string', description: 'test input' } },
    required: ['input'],
  },
  execute: vi.fn().mockResolvedValue({ result: 'ok' }),
})

describe('ToolRegistry', () => {
  it('registers a handler and retrieves it by name', () => {
    const registry = new ToolRegistry()
    const handler = makeHandler('plan_task')
    registry.register(handler)
    expect(registry.get('plan_task')).toBe(handler)
  })

  it('returns undefined for unknown handler', () => {
    const registry = new ToolRegistry()
    expect(registry.get('unknown_tool')).toBeUndefined()
  })

  it('toAnthropicTools converts handlers to Anthropic SDK format', () => {
    const registry = new ToolRegistry()
    registry.register(makeHandler('plan_task'))
    registry.register(makeHandler('develop_code'))

    const tools = registry.toAnthropicTools()

    expect(tools).toHaveLength(2)
    expect(tools[0]).toEqual({
      name: 'plan_task',
      description: 'Handler for plan_task',
      input_schema: {
        type: 'object',
        properties: { input: { type: 'string', description: 'test input' } },
        required: ['input'],
      },
    })
  })
})
