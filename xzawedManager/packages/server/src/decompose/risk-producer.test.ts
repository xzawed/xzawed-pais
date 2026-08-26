import { describe, it, expect, vi } from 'vitest'
import { produceRiskClassification } from './risk-producer.js'

const okClient = (json: string) => ({ messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: json }] }) } })
const baseDeps = (repo: { upsert: ReturnType<typeof vi.fn> }, client: unknown) => ({ claude: client as never, model: 'm', timeoutMs: 50, repo })
const uc = { userId: 'u', projectId: 'proj-1', workspaceRoot: '/ws' }

it('projectId 없으면 skip(upsert 미호출·never-throw)', async () => {
  const repo = { upsert: vi.fn() }
  const r = await produceRiskClassification('intent', 'wf', baseDeps(repo, okClient('{}')) as never, undefined)
  expect(r.classified).toBe(false)
  expect(repo.upsert).not.toHaveBeenCalled()
})

it('근거 claim이 0이면 skip(vacuous LOW 영속 금지)', async () => {
  const repo = { upsert: vi.fn() }
  const client = okClient('{"claims":[{"text":"a","dimension":"domain","support":3,"citations":[]}],"complianceFrameworks":[]}')
  const r = await produceRiskClassification('intent', 'wf', baseDeps(repo, client) as never, uc as never)
  expect(r.classified).toBe(false)
  expect(repo.upsert).not.toHaveBeenCalled()
})

it('근거 claim이 있으면 scoreClassification 결과로 upsert(pending)', async () => {
  const repo = { upsert: vi.fn().mockResolvedValue({ version: 1 }) }
  const client = okClient('{"claims":[{"text":"PHI→HIPAA","dimension":"compliance","support":3,"citations":["hipaa.gov","164","privacy"]}],"complianceFrameworks":["HIPAA"]}')
  const r = await produceRiskClassification('intent', 'wf-1', baseDeps(repo, client) as never, uc as never)
  expect(r.classified).toBe(true)
  expect(repo.upsert).toHaveBeenCalledTimes(1)
  const arg = repo.upsert.mock.calls[0]![0]
  expect(arg.workflowId).toBe('wf-1')
  expect(arg.classification.projectId).toBe('proj-1')
  expect(arg.classification.complianceFrameworks).toContain('HIPAA')
})

it('repo.upsert가 throw해도 never-throw(classified false)', async () => {
  const repo = { upsert: vi.fn().mockRejectedValue(new Error('db down')) }
  const client = okClient('{"claims":[{"text":"a","dimension":"domain","support":1,"citations":["s"]}]}')
  const r = await produceRiskClassification('intent', 'wf', baseDeps(repo, client) as never, uc as never)
  expect(r.classified).toBe(false)
})

it('LLM throw면 skip(never-throw·upsert 미호출)', async () => {
  const repo = { upsert: vi.fn() }
  const client = { messages: { create: vi.fn().mockRejectedValue(new Error('boom')) } }
  const r = await produceRiskClassification('intent', 'wf', baseDeps(repo, client) as never, uc as never)
  expect(r.classified).toBe(false)
  expect(repo.upsert).not.toHaveBeenCalled()
})

it('humanGate.required면 DecisionRequest 발행(decisionStore 주입 시)', async () => {
  const repo = { upsert: vi.fn().mockResolvedValue({ version: 1 }) }
  const decisionStore = { createRequest: vi.fn().mockResolvedValue(undefined) }
  // compliance support 3 + 3 citations → HIGH → humanGate.required true
  const client = okClient('{"claims":[{"text":"PHI","dimension":"compliance","support":3,"citations":["a","b","c"]}],"complianceFrameworks":["HIPAA"]}')
  const r = await produceRiskClassification('intent', 'wf-1', { claude: client as never, model: 'm', timeoutMs: 50, repo, decisionStore } as never, uc as never)
  expect(r.classified).toBe(true)
  expect(decisionStore.createRequest).toHaveBeenCalledTimes(1)
  expect(decisionStore.createRequest.mock.calls[0]![0]).toMatchObject({ type: 'risk_classification', workflowId: 'wf-1' })
})

it('humanGate.required 아니면 DecisionRequest 미발행', async () => {
  const repo = { upsert: vi.fn().mockResolvedValue({ version: 1 }) }
  const decisionStore = { createRequest: vi.fn() }
  // LOW risk(단일 약한 claim) → humanGate.required false
  const client = okClient('{"claims":[{"text":"x","dimension":"domain","support":1,"citations":["a"]}]}')
  await produceRiskClassification('intent', 'wf-2', { claude: client as never, model: 'm', timeoutMs: 50, repo, decisionStore } as never, uc as never)
  expect(decisionStore.createRequest).not.toHaveBeenCalled()
})

it('decisionStore 미주입이면 발행 skip(never-throw)', async () => {
  const repo = { upsert: vi.fn().mockResolvedValue({ version: 1 }) }
  const client = okClient('{"claims":[{"text":"PHI","dimension":"compliance","support":3,"citations":["a","b","c"]}],"complianceFrameworks":["HIPAA"]}')
  const r = await produceRiskClassification('intent', 'wf-3', { claude: client as never, model: 'm', timeoutMs: 50, repo } as never, uc as never)
  expect(r.classified).toBe(true)
})

/**
 * **WP 를 받아 지목까지 흘리는가**(결함 F2 · `S5.3b`).
 *
 * 예전에는 생산자가 intent 만 받아 WP 를 **볼 수가 없었다**. 그래서 `wpRisks` 가 만들어질 수 없었고
 * write-back 은 프로젝트 등급을 전 WP 에 찍는 것 외에 선택지가 없었다.
 */
describe('produceRiskClassification — WP 지목', () => {
  const WPS = [{ id: 'wp-a', owningRole: 'Developer' }, { id: 'wp-b', owningRole: 'Designer' }]
  /** 조사 응답을 그대로 돌려주는 Claude 목. */
  const claudeReturning = (body: unknown) => okClient(JSON.stringify(body))

  it('WP 를 주면 wpRisks 를 채워 upsert 한다', async () => {
    const repo = { upsert: vi.fn().mockResolvedValue({ version: 1 }) }
    const client = claudeReturning({
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'], wpIds: ['wp-a'] }],
      complianceFrameworks: ['HIPAA'],
    })
    await produceRiskClassification('intent', 'wf', baseDeps(repo, client) as never, uc as never, WPS)
    const artifact = repo.upsert.mock.calls[0]![0].classification
    expect(artifact.wpRisks).toEqual({ 'wp-a': 'HIGH', 'wp-b': 'MEDIUM' })
  })

  /** WP 없이 도는 기존 경로 — 판정이 없다는 사실이 그대로 남아야 한다(회귀 0). */
  it('WP 를 안 주면 wpRisks 는 빈 맵이다', async () => {
    const repo = { upsert: vi.fn().mockResolvedValue({ version: 1 }) }
    const client = claudeReturning({
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'] }],
      complianceFrameworks: [],
    })
    await produceRiskClassification('intent', 'wf', baseDeps(repo, client) as never, uc as never)
    expect(repo.upsert.mock.calls[0]![0].classification.wpRisks).toEqual({})
  })

  /** 없는 id 만 지목되면 위험 신호가 아무 WP 에도 안 걸려 증발한다 — 넓히는 쪽으로 되돌린다. */
  it('환각 지목은 전 WP 공통으로 되돌아간다', async () => {
    const repo = { upsert: vi.fn().mockResolvedValue({ version: 1 }) }
    const client = claudeReturning({
      claims: [{ text: 'PHI', dimension: 'compliance', support: 3, citations: ['a', 'b', 'c'], wpIds: ['없는-WP'] }],
      complianceFrameworks: [],
    })
    await produceRiskClassification('intent', 'wf', baseDeps(repo, client) as never, uc as never, WPS)
    expect(repo.upsert.mock.calls[0]![0].classification.wpRisks).toEqual({ 'wp-a': 'HIGH', 'wp-b': 'HIGH' })
  })
})
