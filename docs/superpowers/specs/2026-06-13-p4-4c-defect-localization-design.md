# P4 4c 결함 국소화 — 귀속 인식 에스컬레이션 — 설계

- 날짜: 2026-06-13
- 상태: 설계 승인됨
- 선행: P6 결함 브리프(#291·`MANAGER_DECISION_BRIEF`)·P1d-5 lease/escalation·P4b 검증 게이트
- 사양 출처: `docs/senario/xzawedPAIS_handoff_spec.md` §11(결함 국소화)·§15(의사결정 브리프)·N5, `docs/senario/HUMAN_DECISION_PERSISTENCE.md` (충돌 시 사양 우선)
- 영향 서비스: **xzawedManager** (decision-brief·decision.types)

## 1. 배경·동기

### 1.1 현재: blind 에스컬레이션
검증 실패(P4b)로 완료가 미발행된 WP는 lease 만료 → `handleLeaseSweep` → `planReclaim`(attempt+1 < maxAttempts면 reclaim, 아니면 escalate) → `recordEscalation`(lease→escalated·`wp.escalated`) → `onEscalated`(`buildDefectBrief`→DecisionRequest, #291)으로 흐른다. 그러나 현재 브리프는 **귀속 라벨이 없다**: `expectedVsActual`은 "WP가 N회 시도 후에도 완료되지 못함" 일반 메시지이고, `attributionCounters{impl,task,plan}`(work-package §7)는 스키마에만 존재하며 항상 `{}`다.

### 1.2 §11 결함 국소화
사양 §11: 검증 실패를 계약 사슬(기획 intent → Task acceptance criteria → 구현 artifact)을 **위로 거슬러** 판정한다. 핵심 휴리스틱(§11 verbatim): "**구현 K회 정직 재시도 후 같은 기준 반복 실패 → 귀속을 한 계층 위(Task)로 승급**(불가능 스펙 향한 무한 재시도 차단)". 계층별 `attribution_counters` 추적, 진동 임계 시 N5 사람 에스컬레이션, 재분해 이벤트가 귀속 라벨 전파.

### 1.3 구조적 제약 (탐색 발견)
- **재진입(task/plan)은 자동화 불가**: Task 재진입=재분해(P2), plan 재진입=기획 수정(사람). 사람 결정 라우팅(§11 되먹임)은 P6.
- **현재 진동은 구조적으로 발생 불가**: 재진입이 없으면 escalate는 "impl 소진" 1회뿐이고 task/plan 카운터는 P6 도착 전엔 영원히 0. → 진동 누적·graph_dag 영속은 P6 없이 무의미(YAGNI).
- `lease.attempt`가 이미 impl 재시도 횟수를 보유.

따라서 이 슬라이스는 §11의 **귀속 판정 + 라벨 전달**까지 — blind escalate를 계약 사슬 인식 에스컬레이션으로 교체하고, 진동 누적·자동 재진입은 P6/P2 후속.

## 2. 불변식 (반드시 충족)

| ID | 불변식 | 적용 |
|---|---|---|
| §11 | 계약 사슬 귀속 | escalate(impl 소진)→`faultTier:'impl_exhausted'`·counters{impl:attempt+1} 라벨. 상위 귀속 확정은 사람 결정(P6). |
| §15 | 의사결정 브리프 완전 형태 | 위치·기대vs실제·영향·증거·선택지를 채움(현재 빈 배열·일반 메시지). |
| N6 | 자기검증은 신호일 뿐 | 귀속 판정은 **결정론 재시도 휴리스틱**(LLM 분류 0). |
| N5 | 무한 루프 차단·사람 에스컬레이션 | impl 재시도 소진 시 사람 결정 요청(기존 lease 상한 메커니즘 유지·라벨만 강화). |
| — | flag-off 회귀 0 | `MANAGER_DECISION_BRIEF` off면 브리프 미생성(기존). on이면 강화된 브리프. |
| — | 멱등 | requestId `(wf,wpId,attempt)` 결정론 유지(createRequest ON CONFLICT DO NOTHING). |

## 3. 설계 결정

### D1. 귀속 판정 = 결정론 재시도 휴리스틱 (LLM 0)
순수 함수 `localizeFault(info: EscalationInfo): FaultAttribution`. escalate 시점은 `lease.attempt+1 ≥ maxAttempts` = **impl 계층 소진**이므로:
```
faultTier = 'impl_exhausted'
counters  = { impl: attempt + 1, task: 0, plan: 0 }
```
의미: "구현 재시도로 안 풀림 → 계약 사슬 상위(Task/plan)를 사람이 검토". 상위 귀속 확정은 사람 결정(spec_fix→task, reject→plan)이 P6에서 수행. LLM 불필요·N6 친화.

### D2. attribution 기록 위치 = 브리프 context (graph_dag 영속은 후속)
`defect_brief.context`에 `attribution`(faultTier·counters)를 채운다. graph_dag WP 노드의 `attributionCounters`는 **건드리지 않는다** — 현재 진동이 없어 영속 무의미(`{impl:N,task:0,plan:0}`만 가능)·재분해 read-modify-write 경합 회피·YAGNI. 진동 누적이 실제 필요해지는 P6 라우팅 슬라이스에서 graph_dag 영속 추가. 즉 "쓰기 경로"는 사람 도달 산출물(브리프)에 생긴다.

### D3. 별도 flag 없음 — `MANAGER_DECISION_BRIEF` 내
4c는 #291 브리프를 더 풍부하게만 하므로 기존 flag 뒤에서 동작. off면 브리프 미생성(회귀 0). 새 env·migration 없음(`decision_requests.context`는 JSONB·additive).

### D4. lease 흐름 무변경
`EscalationInfo`는 이미 `attempt`·`stepN`을 보유 → `buildDefectBrief` 내부만 강화(lease.ts·lease.repo.ts·recordEscalation 무수정). `wp.escalated` 이벤트 tier 기록은 진동 누적 후속.

## 4. 구현 (파일별)

### 4.1 `db/decision.types.ts` — context에 attribution 추가 (additive)
`DecisionContextSchema`에 optional `attribution` 필드 추가(backward-compat·기존 default {} 보존):
```typescript
import { AttributionCountersSchema } from '@xzawed/agent-streams' // shared 재사용(드리프트 0)

export const FaultTierSchema = z.enum(['impl_exhausted']) // 첫 슬라이스 단일 값(P6서 task/plan 승급 추가)
export const FaultAttributionSchema = z.object({
  faultTier: FaultTierSchema,
  counters: AttributionCountersSchema,
})
// DecisionContextSchema에 추가:
  attribution: FaultAttributionSchema.optional(),
```

### 4.2 `streams/decision-brief.ts` — localizeFault + 강화된 buildDefectBrief
```typescript
import type { FaultAttribution } from '../db/decision.types.js'

/** §11 결정론 귀속(LLM 0): escalate = impl 계층 K회 소진. 상위 귀속 확정은 사람 결정(P6). */
export function localizeFault(info: EscalationInfo): FaultAttribution {
  return { faultTier: 'impl_exhausted', counters: { impl: info.attempt + 1, task: 0, plan: 0 } }
}
```
`buildDefectBrief` 강화(context):
- `attribution: localizeFault(info)`
- `expectedVsActual`: "구현 계층에서 {attempt+1}회 정직 재시도 모두 검증 실패 — 구현으로 해소 불가. 계약 사슬상 Task(스펙 모호/불가능) 또는 plan(기획 모순) 검토 필요."
- `impact`: `["이 WP에 의존하는 후행 작업이 차단됨(lease escalated)."]`(빈 배열→의미 채움)
- `evidenceRefs`: `[\`wp.escalated@${workflowId}/${wpId}\`, \`attempt=${attempt+1}\`]`
- `options`: 유지(`fix_reverify`·`spec_fix`·`accept_known`·`reject` — 이미 §11 choice 정렬)
- `requestId`·`type`·`severity`: 무변경(멱등 보존).

### 4.3 wiring
`makeEscalationBrief`·`handleLeaseSweep.onEscalated`·server.ts 배선 **무변경**(buildDefectBrief 내부만 강화). 회귀 0.

## 5. 테스트

### 5.1 단위
- `localizeFault`: attempt→counters 결정론(attempt 0→{impl:1}, attempt 2→{impl:3})·faultTier='impl_exhausted'.
- `buildDefectBrief`: context.attribution 존재·귀속 인식 expectedVsActual·impact/evidenceRefs 비어있지 않음·options §11 정렬·requestId 멱등(동일 입력→동일 id).
- `DecisionContextSchema`: attribution 라운드트립·미지정 시 undefined(backward-compat·기존 brief 테스트 정합).

### 5.2 회귀 0
`MANAGER_DECISION_BRIEF` off면 브리프 미생성(기존 #291 테스트 불변). 기존 decision.integration.test의 brief 단언이 새 context 필드와 충돌하지 않게 보강.

## 6. 한계·비-목표 (정직)

- **진동 누적·task/plan 카운터 증가는 P6 라우팅 후속** — 현재는 impl 소진만(재진입 없음→진동 구조적 부재).
- **graph_dag `attributionCounters` 영속·`wp.escalated` 이벤트 tier 기록**은 진동이 실제 발생하는 후속 슬라이스(P6 되먹임과 함께).
- **"Story 산출물 충돌=기획 결함"(§11)** 탐지(커버리지 매트릭스 분석)는 별도.
- **사람 결정 되먹임**(spec_fix→재분해, reject→saga)은 P6 라우팅(이 슬라이스는 브리프의 귀속 라벨이 그 입력을 제공).
- 비-목표(YAGNI): 새 migration·테이블·flag·LLM 귀속 분류·lease 흐름 변경.
