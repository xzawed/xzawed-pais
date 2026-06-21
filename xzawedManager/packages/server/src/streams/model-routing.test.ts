import { describe, it, expect } from 'vitest'
import { resolveWpModel } from './model-routing.js'

const ids = { opus: 'opus-id', sonnet: 'sonnet-id' }
const routing = { PM: 'opus', Developer: 'opus', Designer: 'sonnet', Tester: 'sonnet', Security: 'opus' } as const

describe('resolveWpModel', () => {
  it('developer→Developer→opus tier→opus id', () => {
    expect(resolveWpModel(routing, 'developer', ids)).toBe('opus-id')
  })
  it('designer→Designer→sonnet tier→sonnet id', () => {
    expect(resolveWpModel(routing, 'designer', ids)).toBe('sonnet-id')
  })
  it('modelRouting 없음 → undefined(폴백)', () => {
    expect(resolveWpModel(undefined, 'developer', ids)).toBeUndefined()
  })
  it('미지 역할(builder) → undefined', () => {
    expect(resolveWpModel(routing, 'builder', ids)).toBeUndefined()
  })
  it('대소문자 무관(Developer)', () => {
    expect(resolveWpModel(routing, 'Developer', ids)).toBe('opus-id')
  })
})
