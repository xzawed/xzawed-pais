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
  const repo = { upsert: vi.fn().mockResolvedValue(undefined) }
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
