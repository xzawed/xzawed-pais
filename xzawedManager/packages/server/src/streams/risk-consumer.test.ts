import { describe, it, expect, vi } from 'vitest'
import { buildRiskApprovedHandler, RiskApprovedSchema } from './risk-consumer.js'

const envelope = {
  eventId: '550e8400-e29b-41d4-a716-446655440000', correlationId: 'wf-1', causationId: null, workflowId: 'wf-1',
  stepId: 'risk.approved:wf-1', attemptId: 1, idempotencyKey: 'k1', occurredAt: 1,
}
const msg = {
  envelope, type: 'risk.approved',
  payload: { workflowId: 'wf-1', projectId: 'p', risk: 'HIGH', version: 1, modelRouting: { PM: 'opus', Developer: 'opus', Designer: 'opus', Tester: 'opus', Security: 'opus' } },
}

describe('RiskApprovedSchema', () => {
  it('유효한 risk.approved를 통과시킨다', () => {
    expect(RiskApprovedSchema.safeParse(msg).success).toBe(true)
  })
  it('잘못된 type을 거부한다', () => {
    expect(RiskApprovedSchema.safeParse({ ...msg, type: 'other' }).success).toBe(false)
  })
})

/**
 * **WP 별 write-back**(결함 F2 · `S5.3b`).
 *
 * 예전에는 프로젝트 종합 등급 하나를 전 WP 에 균일하게 찍었다. 그러면 `wp.risk` 는 WP 판정이
 * 아니라 프로젝트 최댓값의 사본이고, 그것을 읽는 mutation θ_risk 게이트와 DEGRADED 서명
 * 게이트는 판단하는 척만 한다.
 */
describe('buildRiskApprovedHandler', () => {
  const withWpRisks = (wpRisks: Record<string, string>) =>
    ({ ...msg, payload: { ...msg.payload, wpRisks } })

  it('WP 별 등급 맵을 그대로 write-back 한다', async () => {
    const graphStore = { updateWpRisks: vi.fn().mockResolvedValue({ updated: 2, judged: 2 }) }
    const handler = buildRiskApprovedHandler({ graphStore })
    await handler(withWpRisks({ 'wp-a': 'HIGH', 'wp-b': 'LOW' }) as never)
    expect(graphStore.updateWpRisks).toHaveBeenCalledWith('wf-1', { 'wp-a': 'HIGH', 'wp-b': 'LOW' }, 'HIGH')
  })

  /**
   * **판정이 없어도 바닥은 남긴다.** 처음에는 "안 쓴다"로 만들었는데 fail-open 이었다 —
   * 변경 전 영속된 아티팩트를 HIGH 로 승인해도 전 WP 가 MEDIUM 에 머물러 mutation 게이트가
   * 조용히 꺼진다. F2 는 보수적이지만 무의미한 결함이었지 위험한 결함이 아니었다.
   */
  it('wpRisks 가 비면 프로젝트 등급을 폴백으로 넘긴다(fail-closed)', async () => {
    const graphStore = { updateWpRisks: vi.fn().mockResolvedValue({ updated: 3, judged: 0 }) }
    const log = vi.fn()
    await buildRiskApprovedHandler({ graphStore, log })(msg as never)
    expect(graphStore.updateWpRisks, '아무것도 안 쓰면 게이트가 조용히 꺼진다').toHaveBeenCalledWith('wf-1', {}, 'HIGH')
    expect(log, '폴백이 전부를 덮은 사실이 무음이면 진단 불가다').toHaveBeenCalled()
  })

  /** 일부만 판정을 받은 상태도 알린다 — 지목 상한 밖 WP 가 여기로 온다. */
  it('일부만 판정되면 알린다', async () => {
    const graphStore = { updateWpRisks: vi.fn().mockResolvedValue({ updated: 3, judged: 2 }) }
    const log = vi.fn()
    await buildRiskApprovedHandler({ graphStore, log })(withWpRisks({ a: 'HIGH', b: 'LOW' }) as never)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('일부 WP 는 판정이 없어'), expect.objectContaining({ judged: 2, updated: 3 }))
  })

  /** 전부 판정을 받았으면 조용해야 한다 — 상시 경고는 경고를 죽인다. */
  it('전부 판정되면 경고하지 않는다', async () => {
    const graphStore = { updateWpRisks: vi.fn().mockResolvedValue({ updated: 2, judged: 2 }) }
    const log = vi.fn()
    await buildRiskApprovedHandler({ graphStore, log })(withWpRisks({ a: 'HIGH', b: 'LOW' }) as never)
    expect(log).not.toHaveBeenCalled()
  })

  it('log 미주입이어도 던지지 않는다', async () => {
    const graphStore = { updateWpRisks: vi.fn().mockResolvedValue({ updated: 1, judged: 0 }) }
    await expect(buildRiskApprovedHandler({ graphStore })(msg as never)).resolves.toBeUndefined()
  })
})

describe('RiskApprovedSchema — wpRisks', () => {
  /** 과거 아티팩트에는 이 키가 없다. 기본값이 "판정 없음"을 주고, 소비자는 그때 아무것도 안 쓴다. */
  it('wpRisks 가 없으면 빈 맵으로 파싱된다(구 이벤트 호환)', () => {
    const parsed = RiskApprovedSchema.parse(msg)
    expect(parsed.payload.wpRisks).toEqual({})
  })

  it('등급이 아닌 값은 거부한다', () => {
    const bad = { ...msg, payload: { ...msg.payload, wpRisks: { a: 'CRITICAL' } } }
    expect(RiskApprovedSchema.safeParse(bad).success).toBe(false)
  })
})
