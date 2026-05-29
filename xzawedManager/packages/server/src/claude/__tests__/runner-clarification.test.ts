import { describe, it, expect, vi } from 'vitest'
import { ClarificationNeededError } from '../../tools/errors.js'

describe('ClarificationNeededError 동작', () => {
  it('ClarificationNeededError는 Error를 상속하며 content 속성을 가진다', () => {
    const err = new ClarificationNeededError('어떤 언어로 작성할까요?')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ClarificationNeededError)
    expect(err.content).toBe('어떤 언어로 작성할까요?')
    expect(err.uiSpec).toBeUndefined()
  })

  it('에이전트 실행 실패 시 재실행 로직 시뮬레이션', async () => {
    let callCount = 0
    const mockExecute = vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
      callCount++
      if (callCount === 1) throw new ClarificationNeededError('어떤 언어로 작성할까요?')
      return { content: `clarification applied: ${String(input['clarificationContext'])}`, steps: [] }
    })

    const mockWaitForInfo = vi.fn().mockResolvedValue('Python')

    // 1차 실행: ClarificationNeededError
    let caught: unknown
    try {
      await mockExecute({ task: 'test' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ClarificationNeededError)

    // waitForInfo로 답변 획득
    const answer = await mockWaitForInfo('session-1')
    expect(answer).toBe('Python')

    // 2차 실행 (명확화 포함)
    const result = await mockExecute({ task: 'test', clarificationContext: answer })
    expect(result.content).toBe('clarification applied: Python')
    expect(callCount).toBe(2)
  })
})
