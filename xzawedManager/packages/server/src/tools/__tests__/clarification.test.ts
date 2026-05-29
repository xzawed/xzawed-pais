import { describe, it, expect } from 'vitest'
import { ClarificationNeededError } from '../errors.js'

describe('ClarificationNeededError', () => {
  it('info_request 타입 메시지에서 생성', () => {
    const err = new ClarificationNeededError('더 자세히 설명해주세요', { type: 'form', fields: [] })
    expect(err.name).toBe('ClarificationNeededError')
    expect(err.content).toBe('더 자세히 설명해주세요')
    expect(err.uiSpec).toEqual({ type: 'form', fields: [] })
    expect(err instanceof Error).toBe(true)
  })

  it('uiSpec 없이도 생성 가능', () => {
    const err = new ClarificationNeededError('details needed')
    expect(err.uiSpec).toBeUndefined()
  })
})
