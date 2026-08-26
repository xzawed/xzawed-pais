import { z } from 'zod'
import { EventEnvelopeSchema, WpRiskSchema } from '@xzawed/agent-streams'
import type { WpRisk } from '@xzawed/agent-streams'
import { RISK_APPROVED_EVENT } from '../db/risk-classification.types.js'

/**
 * risk.approved 이벤트 스키마(RiskClassificationRepo.approve 발행). workflowId는 봉투·payload 양쪽.
 *
 * `risk` 는 **프로젝트 종합**(모델 라우팅·사람 게이트의 입력)이고, `wpRisks` 가 **WP 판정**이다
 * (결함 F2 · `S5.3b`). 둘을 합치지 않는 이유는 서로 다른 것을 말하기 때문이다 —
 * 종합 등급을 WP 판정으로 재사용한 것이 F2 였다.
 */
export const RiskApprovedSchema = z.object({
  envelope: EventEnvelopeSchema,
  type: z.literal(RISK_APPROVED_EVENT),
  payload: z.object({
    workflowId: z.string().min(1),
    projectId: z.string(),
    risk: WpRiskSchema,
    /** WP id → 등급. 없거나 비면 **WP 판정이 없다**는 뜻이고 write-back 은 아무것도 쓰지 않는다. */
    wpRisks: z.record(z.string(), WpRiskSchema).default({}),
    version: z.number().int().positive(),
    modelRouting: z.record(z.string(), z.string()),
  }),
})
export type RiskApprovedMessage = z.infer<typeof RiskApprovedSchema>

/** write-back 대상의 좁은 포트(TaskGraphRepo 구조적 충족). */
export interface RiskWriteBackStore {
  updateWpRisks(
    workflowId: string, risks: Readonly<Record<string, WpRisk>>, fallbackRisk: WpRisk,
  ): Promise<{ updated: number; judged: number }>
}

/**
 * 승인 이벤트 소비: 승인된 **WP 별** risk 를 graph 에 write-back(D4).
 * 재디스패치 없음(risk 는 readiness 무변).
 *
 * **판정이 있으면 그것을, 없으면 프로젝트 종합 등급을 쓴다.** 처음에는 "판정 없으면 안 쓴다"로
 * 만들었는데 그게 fail-open 이었다(Grok 반증) — 변경 전에 영속된 pending 아티팩트에는 WP 판정이
 * 없어서, 사람이 HIGH 로 승인해도 전 WP 가 MEDIUM 에 머물고 mutation 게이트가 **조용히 꺼진다.**
 * F2 는 "보수적이지만 무의미"였지 위험한 결함이 아니었다. 그것을 고치면서 "조용하지만 위험"으로
 * 바꾸면 안 된다 — 판정을 **만들어서** 고치는 것이지, 보수적 바닥을 없애서 고치는 게 아니다.
 *
 * 다만 폴백이 전부를 덮는 상태(`judged === 0`)는 **소리 나게** 남긴다. 무음이면 "리스크 체인을
 * 켰는데 등급이 안 갈린다"가 진단 불가가 된다.
 */
export function buildRiskApprovedHandler(deps: {
  graphStore: RiskWriteBackStore
  log?: (msg: string, data?: Record<string, unknown>) => void
}): (msg: RiskApprovedMessage) => Promise<void> {
  return async (msg) => {
    const { workflowId, risk } = msg.payload
    // `?? {}` 는 방어다 — 스키마를 거치면 항상 객체지만, 구 이벤트가 파싱 없이 닿는 경로에서
    // 여기가 throw 하면 그 메시지는 DLQ 로 격리된다. 없는 것과 빈 것은 어차피 같은 판정이다.
    const wpRisks = msg.payload.wpRisks ?? {}
    const { updated, judged } = await deps.graphStore.updateWpRisks(workflowId, wpRisks, risk)
    if (updated > 0 && judged === 0) {
      deps.log?.('[risk] WP 별 판정 없음 — 전 WP 를 프로젝트 등급으로 채웠다(보수적 폴백·구 아티팩트)', {
        workflowId, projectRisk: risk, updated,
      })
    } else if (judged < updated) {
      deps.log?.('[risk] 일부 WP 는 판정이 없어 프로젝트 등급으로 채웠다', {
        workflowId, projectRisk: risk, judged, updated,
      })
    }
  }
}
