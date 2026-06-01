import { describe, it, expect } from 'vitest'
import { AgentQueryError } from './errors.js'

describe('AgentQueryError', () => {
  it('대상·질문·kind를 보관한다', () => {
    const e = new AgentQueryError('developer', '재고 표시 가능?', 'active_request')
    expect(e.to).toBe('developer')
    expect(e.question).toBe('재고 표시 가능?')
    expect(e.kind).toBe('active_request')
    expect(e.name).toBe('AgentQueryError')
    expect(e).toBeInstanceOf(Error)
  })

  it('kind 기본값은 active_request', () => {
    const e = new AgentQueryError('planner', '이 요구가 맞나요?')
    expect(e.kind).toBe('active_request')
  })
})
