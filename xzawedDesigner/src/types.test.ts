import { describe, it, expect } from 'vitest'
import { ManagerToDesignerMessageSchema } from './types.js'

const base = {
  sessionId: 'sess-1',
  messageId: 'msg-1',
  timestamp: Date.now(),
  type: 'design_request',
  payload: { intent: 'login form', context: {} },
}

describe('ManagerToDesignerMessageSchema', () => {
  it('parses valid design_request', () => {
    const result = ManagerToDesignerMessageSchema.parse(base)
    expect(result.type).toBe('design_request')
    expect(result.payload.intent).toBe('login form')
  })

  it('parses abort type', () => {
    const result = ManagerToDesignerMessageSchema.parse({ ...base, type: 'abort' })
    expect(result.type).toBe('abort')
  })

  it('rejects unknown type', () => {
    expect(() => ManagerToDesignerMessageSchema.parse({ ...base, type: 'unknown' })).toThrow()
  })

  it('rejects missing intent', () => {
    const bad = { ...base, payload: { context: {} } }
    expect(() => ManagerToDesignerMessageSchema.parse(bad)).toThrow()
  })

  it('allows targetFramework to be absent', () => {
    const result = ManagerToDesignerMessageSchema.parse(base)
    expect(result.payload.targetFramework).toBeUndefined()
  })

  it('allows designSystem to be absent', () => {
    const result = ManagerToDesignerMessageSchema.parse(base)
    expect(result.payload.designSystem).toBeUndefined()
  })

  it('parses targetFramework and designSystem when present', () => {
    const msg = {
      ...base,
      payload: { ...base.payload, targetFramework: 'vue', designSystem: 'material' },
    }
    const result = ManagerToDesignerMessageSchema.parse(msg)
    expect(result.payload.targetFramework).toBe('vue')
    expect(result.payload.designSystem).toBe('material')
  })
})
