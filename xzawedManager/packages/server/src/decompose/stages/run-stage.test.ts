import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { runStage, type StageDeps } from './run-stage.js'

const Schema = z.object({ items: z.array(z.string()).default([]) })

function mockClaude(text: string): ClaudeLike {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] }) } }
}
function deps(claude: ClaudeLike): StageDeps {
  return { claude, model: 'test-model', timeoutMs: 1000 }
}
const spec = (fallback = { items: ['fb'] }) => ({
  system: 'sys', user: 'usr', maxTokens: 256, schema: Schema, fallback: () => fallback,
})

describe('runStage', () => {
  it('정상 JSON을 스키마로 파싱해 반환', async () => {
    const out = await runStage(deps(mockClaude('{"items":["a","b"]}')), spec())
    expect(out.items).toEqual(['a', 'b'])
  })

  it('코드펜스로 감싼 JSON도 파싱', async () => {
    const out = await runStage(deps(mockClaude('```json\n{"items":["x"]}\n```')), spec())
    expect(out.items).toEqual(['x'])
  })

  it('JSON 없으면 fallback', async () => {
    const out = await runStage(deps(mockClaude('no json here')), spec())
    expect(out.items).toEqual(['fb'])
  })

  it('스키마 검증 실패 시 fallback', async () => {
    const out = await runStage(deps(mockClaude('{"items":[1,2]}')), spec())
    expect(out.items).toEqual(['fb'])
  })

  it('Claude 호출 throw 시 fallback', async () => {
    const claude: ClaudeLike = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }
    const out = await runStage(deps(claude), spec())
    expect(out.items).toEqual(['fb'])
  })

  it('중괄호는 있으나 깨진 JSON이면 fallback', async () => {
    const out = await runStage(deps(mockClaude('{ broken json }')), spec())
    expect(out.items).toEqual(['fb'])
  })
})
