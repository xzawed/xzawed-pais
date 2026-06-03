import { describe, it, expect } from 'vitest'
import { validateToolInput } from './validate-tool-input.js'

const schema = {
  type: 'object' as const,
  properties: {
    intent: { type: 'string' },
    context: { type: 'object' },
    priority: { type: 'string', enum: ['normal', 'high'] },
  },
  required: ['intent', 'context', 'priority'],
}

describe('validateToolInput', () => {
  it('유효한 입력은 빈 배열', () => {
    expect(validateToolInput({ intent: 'x', context: {}, priority: 'normal' }, schema as never)).toEqual([])
  })

  it('객체가 아니면 오류', () => {
    expect(validateToolInput('nope', schema as never)).toContain('input must be a JSON object')
    expect(validateToolInput(null, schema as never).length).toBeGreaterThan(0)
    expect(validateToolInput([1, 2], schema as never).length).toBeGreaterThan(0)
  })

  it('필수 필드 누락 시 오류', () => {
    const errs = validateToolInput({ context: {}, priority: 'normal' }, schema as never)
    expect(errs).toContain('missing required field: intent')
  })

  it('기본 타입 불일치 시 오류', () => {
    const errs = validateToolInput({ intent: 123, context: {}, priority: 'normal' }, schema as never)
    expect(errs.some((e) => e.includes('intent') && e.includes('string'))).toBe(true)
  })

  it('enum 위반 시 오류', () => {
    const errs = validateToolInput({ intent: 'x', context: {}, priority: 'urgent' }, schema as never)
    expect(errs.some((e) => e.includes('priority'))).toBe(true)
  })

  it('알 수 없는 타입 속성은 통과(과검증 방지)', () => {
    const s = { type: 'object' as const, properties: { x: { type: 'weird' } }, required: [] }
    expect(validateToolInput({ x: 'anything' }, s as never)).toEqual([])
  })

  it('선택 필드 누락은 통과(required만 강제)', () => {
    const errs = validateToolInput({ intent: 'x', context: {}, priority: 'high' }, schema as never)
    expect(errs).toEqual([])
  })
})
