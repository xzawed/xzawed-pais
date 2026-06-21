import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { ProviderCircuitBreaker, ProviderCircuitOpenError, BudgetCircuitBreaker } from '@xzawed/agent-streams'
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

// ── circuit 경로 테스트 ──────────────────────────────────────────────────

const circuitSpec = {
  system: 's', user: 'u', maxTokens: 16,
  schema: z.object({ ok: z.number() }),
  fallback: () => ({ ok: -1 }),
}

describe('runStage circuit', () => {
  it('circuit open이면 호출 없이 fallback', async () => {
    const provider = new ProviderCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000, now: () => 0 })
    provider.onFailure() // open
    const create = vi.fn()
    const mockDeps = { claude: { messages: { create } }, model: 'm', timeoutMs: 100 }
    const r = await runStage(mockDeps as never, circuitSpec as never, { workflowId: 'wf', provider })
    expect(r).toEqual({ ok: -1 })
    expect(create).not.toHaveBeenCalled()
  })

  it('성공 시 budget.record와 provider.onSuccess가 호출된다', async () => {
    const budget = new BudgetCircuitBreaker({ perWorkflowUsd: 100, now: () => 0 })
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"ok":1}' }], usage: { input_tokens: 1000, output_tokens: 1000 } })
    const mockDeps = { claude: { messages: { create } }, model: 'claude-opus-4-8', timeoutMs: 100 }
    const r = await runStage(mockDeps as never, circuitSpec as never, { workflowId: 'wf', budget })
    expect(r).toEqual({ ok: 1 })
    expect(budget.snapshot('wf').workflowUsd).toBeGreaterThan(0)
  })

  it('budget 초과면 fallback(다음 호출 차단)', async () => {
    const budget = new BudgetCircuitBreaker({ perWorkflowUsd: 0.0001, now: () => 0 })
    budget.record('wf', 'claude-opus-4-8', { input_tokens: 100000, output_tokens: 100000 }) // 트립
    const create = vi.fn()
    const mockDeps = { claude: { messages: { create } }, model: 'claude-opus-4-8', timeoutMs: 100 }
    const r = await runStage(mockDeps as never, circuitSpec as never, { workflowId: 'wf', budget })
    expect(r).toEqual({ ok: -1 })
    expect(create).not.toHaveBeenCalled()
  })

  it('LLM throw + isProviderFailure면 provider.onFailure 호출', async () => {
    const provider = new ProviderCircuitBreaker({ failureThreshold: 1, now: () => 0 })
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('rate'), { status: 429 }))
    const mockDeps = { claude: { messages: { create } }, model: 'm', timeoutMs: 100 }
    const r = await runStage(mockDeps as never, circuitSpec as never, { workflowId: 'wf', provider, isProviderFailure: () => true })
    expect(r).toEqual({ ok: -1 })
    // 임계 1이라 onFailure 1회로 open → 다음 before throw
    expect(() => provider.before()).toThrow(ProviderCircuitOpenError)
  })

  it('circuit 미전달 시 기존 경로 불변(callClaudeText 텍스트 파싱)', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"ok":7}' }] })
    const mockDeps = { claude: { messages: { create } }, model: 'm', timeoutMs: 100 }
    const r = await runStage(mockDeps as never, circuitSpec as never)
    expect(r).toEqual({ ok: 7 })
  })
})
