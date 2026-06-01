import { describe, it, expect } from 'vitest'
import { formatDomainKnowledge } from '../prompt/domain-knowledge.js'

describe('formatDomainKnowledge', () => {
  it('domainKnowledge가 없으면 빈 문자열', () => {
    expect(formatDomainKnowledge({})).toBe('')
  })

  it('빈 배열이면 빈 문자열', () => {
    expect(formatDomainKnowledge({ domainKnowledge: [] })).toBe('')
  })

  it('content + sourceAgent를 라벨 블록으로 렌더한다', () => {
    const out = formatDomainKnowledge({
      domainKnowledge: [
        { content: '결제는 Stripe 사용', sourceAgent: 'plan_task' },
        { content: '폼은 모바일 우선', sourceAgent: 'design_ui' },
      ],
    })
    expect(out).toContain('## 이전 프로젝트 도메인 지식')
    expect(out).toContain('- 결제는 Stripe 사용 (plan_task)')
    expect(out).toContain('- 폼은 모바일 우선 (design_ui)')
  })

  it('sourceAgent가 없으면 content만 렌더한다(괄호 출처 없음)', () => {
    const out = formatDomainKnowledge({ domainKnowledge: [{ content: 'X' }] })
    const itemLine = out.split('\n').find((l) => l.startsWith('- '))
    expect(itemLine).toBe('- X')
  })

  it('잘못된 항목(문자열·content 없음)은 걸러낸다', () => {
    const out = formatDomainKnowledge({ domainKnowledge: ['nope', { foo: 1 }, { content: '유효' }] })
    expect(out).toContain('- 유효')
    expect(out).not.toContain('nope')
  })

  it('유효 항목이 하나도 없으면 빈 문자열', () => {
    expect(formatDomainKnowledge({ domainKnowledge: ['x', { foo: 1 }] })).toBe('')
  })
})
