# F5 — Invariant 초안 생성기 (property 채널 활성화)

- 날짜: 2026-06-23
- 서비스: xzawedManager
- 플래그: `MANAGER_ORACLE_INVARIANTS` (기본 false)
- 전제: `MANAGER_ORACLE_DRAFT`(invariants는 OracleDraft에 부착) · 실효성엔 `MANAGER_WP_PROPERTY`
- migration: 0 (migration 010이 `oracles.invariants` JSONB 컬럼 이미 추가)
- 선행/관련: P3-2 오라클 초안 생성(scenarios) · P4 property 채널(`MANAGER_WP_PROPERTY`) · C3 오라클 승인 UI(#341)

## 1. 문제 — property 검증 채널이 구조적으로 휴면

P4 property 채널(`MANAGER_WP_PROPERTY`)은 develop_code WP 산출물이 **사람이 승인한 불변식(invariants)**을 만족하는지 boundary+명시 속성 단언 테스트로 실행 검증한다(위반 시 blocking). 그러나:

- P3-2 분해 초안 생성기(`draft-oracles.ts`)는 GWT **scenarios만** 생성하고 invariants는 생성하지 않는다.
- `OracleRepo.upsertDraft`는 scenarios + coverage만 영속한다(invariants 미영속).
- `OracleRepo.approve`는 scenarios만 `drafted→human_approved` 전이한다(invariants 미전이).
- `OracleRepo.approvedInvariantsForStory`는 `status==='human_approved'` invariants만 반환한다 → 생성·승인 경로가 없어 **항상 null** → property 채널이 **항상 skip**.

결과: invariants를 사람이 `POST /oracles`로 직접 저작·시드하지 않는 한 property 채널은 영구 dead code. 검증 채널 하나가 통째로 죽어 있다.

## 2. 목표·비목표

**목표**: 분해 시 story별 invariant **초안**을 LLM으로 생성→pending 오라클에 영속→사람 승인 한 번으로 `human_approved` 전이→property 채널 활성. P3-2 scenarios 경로를 정확히 미러.

**비목표 (범위 외)**:
- **golden_refs 초안 생성**: golden은 "실제 실행 출력의 사인오프 베이스라인"이라 LLM이 `normalizedOutput`을 추측하면 ground-truth가 아닌 fabricated 베이스라인이 된다(사람이 LLM 추측 출력을 눈으로 검증 불가·N7 위배). impact 채널 활성화는 별도 record-and-freeze 슬라이스로 분리(후속).
- property-based **fuzz**(fast-check)·metamorphic 관계·invariant 재채점(P7).
- 신규 검증 채널 로직 변경(property 채널은 이미 구현됨·읽기만).

## 3. 핵심 설계 결정

### 3.1 별도 스테이지 `draft-invariants.ts`
기존 `draftOracles`를 확장하는 대신 별도 스테이지 파일을 둔다. 근거:
- 코드베이스의 모든 분해 단계(epics·slice·deliverables·repair·roles·infer-edges·draft-oracles)가 단일 책임 파일 — 패턴 일치.
- invariants(도메인 불변식)는 scenarios(GWT)와 다른 산출물 → 프롬프트·스키마 분리가 품질에 유리.
- 독립 단위 테스트 가능.
- 비용: story당 LLM 1회 추가. 플래그·G1 §13 서킷(`runStage` circuit-aware)으로 보호.

### 3.2 신규 플래그 `MANAGER_ORACLE_INVARIANTS`
`MANAGER_ORACLE_DRAFT` 재사용 대신 신규 플래그. 근거:
- 코드베이스의 "off→바이트 동일 회귀 0" 규율 — 기존 `MANAGER_ORACLE_DRAFT` 사용자가 invariants LLM 비용을 떠안지 않는다.
- invariants는 `MANAGER_WP_PROPERTY` 켤 때만 의미 → 별도 플래그가 정렬을 명확히.
- 전제: `MANAGER_ORACLE_DRAFT`(invariants는 draftOracles가 만든 OracleDraft에 부착되므로 draft 파이프라인 필요).

### 3.3 stub 강제 안 함 (정직한 휴면)
scenarios는 AC 커버리지 100% 규칙이 있어 미커버 AC에 stub을 합성한다. invariants는 **커버리지 의무가 없다**(AC↔invariant 매핑 없음). LLM이 한 story에서 의미 있는 불변식을 못 찾으면 빈 배열을 반환하고, 그 story의 property 채널은 우아하게 skip(`approvedInvariantsForStory`→null). fabricated stub 불변식은 저품질이므로 강제하지 않는다. 채널은 LLM이 **진짜** 불변식을 식별할 때만 활성 — 정직한 설계.

## 4. 데이터 흐름

```
draftInvariants(stories, deps) → Map<storyId, OracleInvariant[]>
    per-story LLM 1회 → {statement, domain, property}[] → id={storyId}-inv{n}·status:'drafted'·≤MAX
    never-throw(runStage fallback 빈) → 분해 비차단
  ↓ pipeline.ts runDecomposition: invariantsEnabled면 oracleDrafts에 머지
OracleDraft { storyId, scenarios, coverage, invariants }   ← invariants additive(default [])
  ↓ producer.ts emitWorkPackages (oracleDrafts 그대로 — OracleDraftSchema가 invariants 포함)
decomposition.emitted.payload.oracleDrafts[].invariants
  ↓ decomposition-consumer.ts handleDecompositionEmitted
OracleRepo.upsertDraft({workflowId, storyId, scenarios, coverage, invariants})
    → oracles.invariants JSONB 영속 (migration 010 컬럼·멱등 pending)
  ↓ 사람 승인 (C3 oracle_approval DecisionRequest 또는 PATCH /oracles/:id/approve)
OracleRepo.approve → scenarios drafted→human_approved (기존) + invariants drafted→human_approved (신규)
  ↓
OracleRepo.approvedInvariantsForStory → human_approved invariants 반환
  ↓
property 채널(MANAGER_WP_PROPERTY) buildInvariantAuthorPlan → 활성
```

## 5. 변경 (전부 Manager·shared 무변경·migration 0)

### 5.1 `db/oracle.types.ts`
`OracleDraftSchema`에 `invariants: z.array(OracleInvariantSchema).default([])` 추가(additive). `z.infer` 출력 타입에 `invariants: OracleInvariant[]`가 항상 존재 → 기존 타입드 OracleDraft 픽스처에 `invariants: []` 보강(컴파일 유지·P3-2 `oracleDrafts:[]` 선례).

### 5.2 `decompose/stages/draft-invariants.ts` (신규)
```ts
export const MAX_INVARIANTS_PER_STORY = 6   // payload 방어·유계
const DraftInvariantSchema = z.object({
  statement: z.string().default(''), domain: z.string().default(''), property: z.string().default(''),
})
const DraftInvariantsSchema = z.object({ invariants: z.array(DraftInvariantSchema).default([]) })
export const INVARIANT_SYSTEM_PROMPT = `...도메인 불변식(항상 참인 속성)·boundary-testable·구현 무관...`

export async function draftInvariants(stories: Story[], deps: StageDeps): Promise<Map<string, OracleInvariant[]>>
```
- per-story `runStage`(LLM) 1회 → statement/domain/property 추출.
- 결정론 id `${storyId}-inv{n}`·`status:'drafted'`·`MAX_INVARIANTS_PER_STORY` 절단.
- 빈 statement 항목 드롭(저품질 가드)·story가 0개면 빈 배열(stub 강제 없음).
- runStage fallback `() => ({ invariants: [] })` → LLM 실패 시 빈(never-throw·분해 비차단).

### 5.3 `decompose/pipeline.ts`
```ts
export async function runDecomposition(
  intent, deps, repairMax = DEFAULT_REPAIR_MAX,
  draftEnabled = false, invariantsEnabled = false,   // 5번째 param additive
): Promise<DecomposeResult>
```
ok 경로 말미:
```ts
let oracleDrafts = draftEnabled ? await draftOracles(stories, deps) : []
if (invariantsEnabled && oracleDrafts.length > 0) {
  const invByStory = await draftInvariants(stories, deps)
  oracleDrafts = oracleDrafts.map((d) => ({ ...d, invariants: invByStory.get(d.storyId) ?? [] }))
}
```
`invariantsEnabled`는 `draftEnabled` 전제(oracleDrafts 없으면 머지 대상 없음·skip).

### 5.4 `decompose/producer.ts`
- `ProduceDeps.draftInvariants?: boolean` 추가(server.ts 주입).
- `runDecomposition(..., deps.draftOracles ?? false, deps.draftInvariants ?? false)`.
- `emitWorkPackages`·payload 무변경(OracleDraftSchema가 invariants를 이미 운반).

### 5.5 `streams/decomposition-consumer.ts`
- `DecompositionDeps.oracleStore.upsertDraft` 포트 타입에 `invariants: OracleInvariant[]` 추가.
- `handleDecompositionEmitted`의 upsertDraft 호출에 `invariants: d.invariants` 전달.
- `OracleDraftSchema`(payload)가 invariants 자동 운반 → 스키마 무변경.

### 5.6 `db/oracle.repo.ts`
**`upsertDraft`** — input에 `invariants?: OracleInvariant[]`(optional·기본 []) 추가. INSERT 컬럼에 `invariants` 추가·ON CONFLICT SET에 `invariants = EXCLUDED.invariants`(status='pending' WHERE 가드 유지). 미전달 호출자 회귀 0.
```sql
INSERT INTO oracles (oracle_id, workflow_id, story_id, version, status, scenarios, invariants, coverage)
  VALUES ($1,$2,$3,1,'pending',$4,$5,$6)
ON CONFLICT (oracle_id) DO UPDATE SET
  scenarios = EXCLUDED.scenarios, invariants = EXCLUDED.invariants,
  coverage = EXCLUDED.coverage, status = 'pending'
  WHERE oracles.status = 'pending'
```

**`approve`** — FOR UPDATE SELECT에 `invariants` 추가. scenarios 전이 직후 invariants도 `drafted→human_approved` 전이(`OracleInvariantSchema.array().parse(row.invariants ?? [])`·동형 map). UPDATE에 `invariants = $N` 추가. 빈 배열 no-op(기존 오라클 무영향·P3-1 회귀 0).

### 5.7 `config.ts` · `server.ts`
- `config.ts`: `MANAGER_ORACLE_INVARIANTS: z.string().optional().transform((v) => v === 'true')` + 주석(전제·비용).
- `server.ts`: ProduceDeps에 `draftInvariants: config.MANAGER_ORACLE_INVARIANTS` 주입(두 진입점 — decompose 트리거). 오진 경고 2종:
  - INVARIANTS on인데 `MANAGER_ORACLE_DRAFT` off → no-op(초안 자체 미생성).
  - INVARIANTS on인데 `MANAGER_WP_PROPERTY` off → 생성·승인되나 검증 미소비(휴면).

## 6. ⚠️ 의도적 동작 변경 + 기존 테스트 갱신

`approve`가 invariant를 전이하게 되면 `test/oracle-invariants.integration.test.ts`의 두 테스트가 **구 계약**("approve는 invariant 미전이·사람이 직접 human_approved 시드")을 인코딩하므로 **새 계약으로 갱신 필수**:
- 테스트 1: 현재 `drafted` invariant(i2)를 upsert→approve 후 i2가 **미반환** 기대 → 신규: approve가 i2를 전이하므로 **반환** 기대로 변경.
- 테스트 2: 현재 단일 `drafted` invariant→approve 후 **null** 기대 → 신규: 전이되므로 **non-null** 기대로 변경.

PR #295 "무음 테스트 반전" 교훈 적용: 삭제가 아니라 **명시적 재작성**, 커밋 메시지·이 스펙·리뷰에 근거 문서화. 신규 통합 테스트로 전체 루프(upsertDraft drafted → approve 전이 → approvedInvariantsForStory 반환) 실증.

## 7. 에러 처리·안전

- `draftInvariants` never-throw(runStage fallback 빈) → 리스크 생성 실패가 분해 절대 비차단.
- 플래그 off → `oracleDrafts[].invariants` 항상 `[]` → upsertDraft `invariants:[]`·approve no-op → P3-2/C3 바이트 동일 회귀 0.
- `upsertDraft` invariants는 `status='pending'` WHERE 가드 안에서만 덮어씀(approved/superseded 오라클 보존).
- N7 무관: invariants는 사람 승인 LLM 제안(conformance 렌즈)이지 golden ground-truth가 아니다. property 채널은 invariants를 읽기만(N7 무변).

## 8. 테스트 (TDD)

| 파일 | 검증 |
|---|---|
| `decompose/stages/draft-invariants.test.ts` (신규) | LLM invariants → id/status/cap 매핑·빈 statement 드롭·LLM 빈→빈 맵·상한 절단 |
| `decompose/pipeline.test.ts` (확장) | invariantsEnabled면 oracleDrafts에 invariants 머지·off면 `[]`·draftEnabled off면 머지 skip |
| `decompose/producer.test.ts` (확장) | draftInvariants 플래그가 runDecomposition으로 스레딩 |
| `streams/decomposition-consumer.test.ts` (확장) | upsertDraft 호출이 invariants 운반 |
| `db/oracle.repo.test.ts` (확장·있으면) | upsertDraft INSERT invariants·approve 전이 |
| `test/oracle-invariants.integration.test.ts` (재작성) | 새 계약: upsertDraft(drafted) → approve → approvedInvariantsForStory 반환 (skip-if-no-DB) |

## 9. 후속 (범위 외)

- golden record-and-freeze 슬라이스(impact 채널 활성화).
- invariant property-based fuzz·metamorphic.
- per-story 개별 invariant 승인 UI·invariant 재채점(P7).
