import { describe, it, expect } from 'vitest'
import { parseAgentSteps } from './parseAgentSteps.js'

describe('parseAgentSteps', () => {
  it('단일 에이전트 블록을 파싱한다', () => {
    const content = '[PLN] 계획 완료: 3단계'
    const steps = parseAgentSteps(content)
    expect(steps).toHaveLength(1)
    expect(steps[0].agentName).toBe('Planner')
    expect(steps[0].content).toBe('계획 완료: 3단계')
    expect(steps[0].status).toBe('done')
  })

  it('여러 에이전트 블록을 순서대로 파싱한다', () => {
    const content = '[PLN] 3단계 계획\n[DEV] auth.ts 수정 중\n파일 작성...'
    const steps = parseAgentSteps(content)
    expect(steps).toHaveLength(2)
    expect(steps[0].agentName).toBe('Planner')
    expect(steps[1].agentName).toBe('Developer')
    expect(steps[1].content).toBe('auth.ts 수정 중\n파일 작성...')
  })

  it('에이전트 태그 없는 콘텐츠는 단일 Assistant 스텝으로 반환한다', () => {
    const content = '일반 텍스트 응답입니다.'
    const steps = parseAgentSteps(content)
    expect(steps).toHaveLength(1)
    expect(steps[0].agentName).toBe('Assistant')
    expect(steps[0].content).toBe('일반 텍스트 응답입니다.')
  })

  it('빈 콘텐츠는 빈 배열을 반환한다', () => {
    expect(parseAgentSteps('')).toHaveLength(0)
  })

  it('스트리밍 중인 마지막 스텝은 active 상태다', () => {
    const content = '[PLN] 완료\n[DEV] 작업 중'
    const steps = parseAgentSteps(content, true)
    expect(steps[0].status).toBe('done')
    expect(steps[1].status).toBe('active')
  })

  it('[MGR] 태그를 Manager로 매핑한다', () => {
    const steps = parseAgentSteps('[MGR] 디스패치 완료')
    expect(steps[0].agentName).toBe('Manager')
  })
})
