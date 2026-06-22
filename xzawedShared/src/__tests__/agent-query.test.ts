import { describe, it, expect } from 'vitest'
import { AgentQuery, AgentQuerySchema, parseAgentQuery, collaborationPayloadFields } from '../types/agent-query.js'
import { z } from 'zod'

describe('AgentQuery', () => {
  it('대상·질문·kind를 보관한다', () => {
    const q = new AgentQuery('developer', '재고 표시 가능?', 'active_request')
    expect(q.to).toBe('developer')
    expect(q.question).toBe('재고 표시 가능?')
    expect(q.kind).toBe('active_request')
  })

  it('kind 기본값은 active_request', () => {
    expect(new AgentQuery('planner', '맞나요?').kind).toBe('active_request')
  })
})

describe('AgentQuerySchema', () => {
  it('kind 미지정 시 active_request로 기본값을 채운다', () => {
    const r = AgentQuerySchema.parse({ to: 'developer', question: 'q' })
    expect(r.kind).toBe('active_request')
  })

  it('to/question이 비면 거부한다', () => {
    expect(AgentQuerySchema.safeParse({ to: '', question: 'q' }).success).toBe(false)
    expect(AgentQuerySchema.safeParse({ to: 'developer', question: '' }).success).toBe(false)
  })
})

describe('parseAgentQuery', () => {
  it('agent_query 형태를 AgentQuery로 변환한다', () => {
    const q = parseAgentQuery({ agent_query: true, to: 'developer', question: '가능?', kind: 'cross_check' })
    expect(q).toBeInstanceOf(AgentQuery)
    expect(q?.to).toBe('developer')
    expect(q?.kind).toBe('cross_check')
  })

  it('agent_query가 아니면 null', () => {
    expect(parseAgentQuery({ components: [] })).toBeNull()
  })

  it('to/question 누락 시 null', () => {
    expect(parseAgentQuery({ agent_query: true, to: 'developer' })).toBeNull()
    expect(parseAgentQuery({ agent_query: true, question: 'q' })).toBeNull()
  })
})

describe('collaborationPayloadFields', () => {
  it('model? 을 수용하고 보존한다', () => {
    const schema = z.object({ ...collaborationPayloadFields })
    expect(schema.parse({ model: 'm' })).toEqual({ model: 'm' })
  })

  it('model 미지정 시 optional', () => {
    const schema = z.object({ ...collaborationPayloadFields })
    expect(schema.safeParse({}).success).toBe(true)
  })
})
