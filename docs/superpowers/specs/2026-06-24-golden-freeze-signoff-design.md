# Golden Freeze 사인오프 + N7 impact 게이팅 (Slice 1)

- 날짜: 2026-06-24
- 서비스: xzawedManager
- 플래그: `MANAGER_GOLDEN_SIGNOFF` (기본 false)
- 전제: `MANAGER_WP_IMPACT`(채널) + `MANAGER_DECISION_ROUTING`(사인오프 소비) + `DATABASE_URL` + 워커 스택(`TASK_MANAGER_ENABLED`+`MANAGER_TASK_WORKER`+`MANAGER_WP_VERIFY`)
- migration: 0 (`OracleGolden.frozenBy`·`frozenAt` 기존 필드·`golden_diff` 기존 DecisionRequest type enum)
- 관련: F5 invariant 생성기(#343)·C3 오라클 승인 UI(#341·미러)·P4 impact 채널(#294)·P2r-4 wp.risk write-back(freeze 패턴)

## 1. 문제 — impact 채널 N7 구멍 + golden freeze 경로 부재

P4 impact 채널(`MANAGER_WP_IMPACT`)은 develop_code WP 산출물이 사람 사인오프 golden에서 벗어났는지(behavioral drift) 검증한다. 그러나:

- `OracleRepo.approvedGoldensForStory`는 승인 오라클의 golden_refs를 **frozen 여부 무관하게 전부** 반환한다 → **잠재 N7 구멍**: 사인오프되지 않은(frozenBy=null) golden도 impact 베이스라인으로 소비될 수 있다. golden의 본질은 "사람이 정답이라 확인한 출력"인데, 미사인오프 golden을 쓰면 ground-truth가 아니다.
- golden을 **freeze(사람 사인오프)**할 경로가 없다. `OracleGolden.frozenBy`/`frozenAt` 필드는 있으나 설정하는 코드가 없다. golden 승인은 `PATCH /oracles`(서비스토큰·비부인 없음)로 통째 upsert뿐이고, `golden_diff` DecisionRequest type은 enum에만 있고 **생산자·소비자 0**.

결과: impact 채널이 N7을 강제하지 못하고, golden 사인오프 HITL 표면이 없다.

## 2. 목표·비목표

**목표**: golden을 사람이 C1 결정 대기함에서 freeze(사인오프)하는 경로를 만들고(`golden_diff` DecisionRequest·C3 미러), impact 채널이 **frozen golden만** 소비하도록 N7을 강제한다. 사인오프된 golden으로 impact 채널이 활성화된다.

**비목표 (후속 Slice 2)**:
- **자동 캡처**: develop_code WP 실행 출력을 자동 캡처해 golden 초안 생성. 실 출력을 Manager로 되돌리려면 Developer 에이전트 result 스키마 확장(교차서비스)이 필요해 위험·대규모 → 별도 슬라이스. **draft golden은 사람 `POST /oracles` 시드**(F5 이전 invariants 동형).
- golden 버전 관리·supersede·per-golden 개별 freeze UI.

## 3. 핵심 설계 결정

### 3.1 frozenBy = draft/frozen 상태 (migration 0)
`OracleGolden.frozenBy`(nullable·기존): `null` = draft(미사인오프), 설정 = frozen(사람 사인오프). `frozenAt`도 동반 설정. 별도 status 컬럼 불필요 — 기존 필드 재사용.

### 3.2 N7 게이팅 — `approvedGoldensForStory` frozenBy 필터 (무조건)
`approvedGoldensForStory`가 `frozenBy != null` golden만 반환한다. impact는 flag-gated(`MANAGER_WP_IMPACT` 기본 off)이고 프로덕션에 golden 0이라 **무조건 적용해도 실회귀 0**. N7은 정합성 불변식이라 flag-gate하지 않는다(의도된 동작 변경·기존 golden 통합 테스트는 새 계약으로 갱신).

### 3.3 freeze는 per-workflow (C3 `approvePendingByWorkflow` 미러)
`freezeGoldensByWorkflow(workflowId, frozenBy, now)` — 그 workflow의 approved 오라클 전부에서 unfrozen golden을 frozen 전이. 사인오프 한 번이 workflow golden 전부 freeze(per-story 개별은 후속). DecisionRequest는 per-workflow(`{wf}:golden`).

### 3.4 사인오프 = `golden_diff` DecisionRequest (C3 oracle_approval 미러)
- **생산자**: develop_code WP verdict.ok 후 `maybeRequestGoldenSignoff`(maybeProduceAdvisory hook 선례·best-effort never-throw)가 그 workflow에 unfrozen golden이 있으면 `golden_diff` DecisionRequest 발행(per-workflow 멱등·**에이전트 호출 0**·오라클 조회만).
- **소비자**: decision-consumer approve 분기에 type 분기 추가 — `golden_diff && oracleStore → freezeGoldensByWorkflow(req.workflowId, decidedBy)`. 기존 risk/oracle 분기 보존.
- 사인오프 자체가 비부인 레코드(human_decisions·decidedBy)이므로 freeze는 별도 이벤트 없는 projection UPDATE(P2r-4 updateWpRisks 패턴).

## 4. 데이터 흐름

```
사람 POST /oracles(→pending·골든 frozenBy=null 강제) + PATCH /oracles/:id/approve(→approved)   (golden draft 시드)
  ↓ develop_code WP verdict.ok (worker)
maybeRequestGoldenSignoff: hasUnfrozenGoldensByWorkflow(wf) → true면
  decisionStore.createRequest(buildGoldenBrief({wf, projectId, goldenCount}))   (golden_diff·{wf}:golden 멱등)
  ↓ C1 DecisionsPanel surface (타입-무관·Orchestrator 변경 0)
사람 approve (JWT decidedBy 비부인)
  ↓ decision.recorded
decision-consumer approve 분기: golden_diff → OracleRepo.freezeGoldensByWorkflow(wf, decidedBy)
  → 각 approved 오라클 golden_refs의 frozenBy=decidedBy·frozenAt=now (read-modify-write)
  ↓
approvedGoldensForStory(frozenBy != null) → frozen golden 반환 → impact 채널 활성
```

## 5. 변경 (전부 Manager·shared 무변경·migration 0)

### 5.1 `db/oracle.repo.ts`
- **`approvedGoldensForStory`** — 반환을 `frozenBy != null`로 필터(N7). 빈이면 null(impact skip).
- **`freezeGoldensByWorkflow(workflowId, frozenBy, now=Date.now)`** — `listByWorkflow(wf, ORACLE_APPROVED)` 순회, 각 오라클의 golden_refs에서 `frozenBy==null` golden을 `{...g, frozenBy, frozenAt: ISO(now)}`로 전이 → `UPDATE oracles SET golden_refs=$2 WHERE oracle_id=$1`(read-modify-write·변경 있는 오라클만). 성공 frozen 카운트 반환.
- **`hasUnfrozenGoldensByWorkflow(workflowId): Promise<boolean>`** — approved 오라클에 frozenBy=null golden이 하나라도 있으면 true(생산자 트리거 가드).

### 5.2 `streams/golden-brief.ts` (신규)
`buildGoldenBrief({workflowId, projectId, goldenCount})` → 표준 `DecisionRequestInput`(requestId `{wf}:golden` 멱등·type `golden_diff`·severity `blocking`·options `['approve','reject']`·`impact`/`evidenceRefs` `[]`). oracle-brief(C3) 미러 — C1 카드 그대로 렌더.

### 5.3 `streams/worker.ts`
`maybeRequestGoldenSignoff(tool, workflowId, wp, deps)`(maybeProduceAdvisory 미러·best-effort never-throw) — `goldenSignoffEnabled && tool==='develop_code' && oracleStore && decisionStore`일 때 `hasUnfrozenGoldensByWorkflow(wf)` true면 `decisionStore.createRequest(buildGoldenBrief(...))`. `handleWpDispatchSignal`의 verdict.ok 경로(maybeProduceAdvisory 다음)에서 호출. `WorkerDeps`에 `goldenSignoffEnabled?`·`decisionStore?` additive.

### 5.4 `streams/decision-consumer.ts`
approve 분기에 `else if (req.type==='golden_diff' && oracleStore?.freezeGoldensByWorkflow) → freezeGoldensByWorkflow(req.workflowId, decidedBy)`. `DecisionRoutingDeps.oracleStore` 교집합에 `freezeGoldensByWorkflow` 추가. 기존 risk/oracle 분기 byte-identical.

### 5.5 `config.ts` · `server.ts` · `supervisor.ts`
- `MANAGER_GOLDEN_SIGNOFF` flag.
- `shouldWireGoldenSignoff(goldenSignoff, hasOracleStore, hasDecisionStore)` 순수 게이트.
- worker deps에 `goldenSignoffEnabled`+`decisionStore` 주입(생산자)·decision-consumer deps에 oracleStore freeze 주입(소비자)·OutboxRelay 조건에 추가(golden_diff DecisionRequest 아웃박스).
- 오진 경고: WP_IMPACT off(impact 미소비)·DECISION_ROUTING off(사인오프 미소비).

## 6. ⚠️ 의도적 동작 변경 + 기존 테스트 갱신

`approvedGoldensForStory`가 frozenBy 필터를 추가하면 `test/oracle-golden.integration.test.ts`(존재 시)가 frozenBy=null golden을 시드하고 반환을 기대할 수 있어 **새 계약으로 갱신**(seed 시 frozenBy 설정 또는 freeze 후 조회). PR #295/#343 무음 반전 교훈 — 명시 재작성·근거 문서화.

## 7. 에러 처리·안전

- `maybeRequestGoldenSignoff` best-effort never-throw → 완료/게이트 영향 0(advisory 동형).
- 플래그 off → 생산자·소비자 비배선·`approvedGoldensForStory` N7 필터는 무조건이나 프로덕션 golden 0이라 실회귀 0.
- freeze는 projection UPDATE(이벤트 0) — 비부인은 human_decisions(decidedBy)가 담당.
- `freezeGoldensByWorkflow` 멱등(이미 frozen golden은 무변경·재승인 무해).
- `createRequest` ON CONFLICT 멱등(재실행 시 원 요청 보존).
- **N7 정직성(POST 시드 하드닝)**: `POST /oracles`는 `status=pending` 강제와 동형으로 incoming golden의 `frozenBy→null`·`frozenAt→''`도 강제한다 — frozen은 오직 `golden_diff` 사인오프 경로(`freezeGoldensByWorkflow`+human_decisions 비부인)로만 도달. 이로써 `approvedGoldensForStory`의 `frozenBy!=null` 필터가 "사람 사인오프"를 진정으로 함의한다(서비스토큰 시드로 pre-frozen golden 주입 차단).

## 8. 테스트 (TDD)

| 파일 | 검증 |
|---|---|
| `db/oracle.repo.test.ts` (확장) | approvedGoldensForStory frozenBy 필터·freezeGoldensByWorkflow 전이·hasUnfrozenGoldensByWorkflow |
| `streams/golden-brief.test.ts` (신규) | buildGoldenBrief golden_diff·requestId 멱등·표준 DecisionContext |
| `streams/worker.*.test.ts` (확장 또는 신규) | maybeRequestGoldenSignoff: unfrozen 있으면 발행·없으면 미발행·never-throw·flag off 미발행 |
| `streams/decision-consumer.test.ts` (확장) | golden_diff approve → freezeGoldensByWorkflow·기존 risk/oracle 분기 보존 |
| `test/oracle-golden.integration.test.ts` (갱신·신규) | upsert(draft golden frozenBy=null) → freezeGoldensByWorkflow → approvedGoldensForStory 반환(frozen) 루프 (skip-if-no-DB) |

## 9. 한계·후속 (Slice 2 — 범위 외)

- ⚠️ **단발-사인오프 per-workflow(requestId flat `{wf}:golden`)**: 생산자가 매 develop_code verdict.ok마다 `createRequest({wf}:golden)`를 시도하나 `createRequest` ON CONFLICT DO NOTHING이라, **첫 사인오프로 그 요청이 RESOLVED된 뒤 같은 workflow에 새로 시드된 unfrozen golden은 새 PENDING이 생성되지 않아 영구 freeze 불가**(C1 미노출 → impact 영구 제외·M8 무음 저하). golden 시드가 수동·단발인 Slice 1에선 발현 안 하나, **Slice 2(자동 캡처·반복 시드) 착수 전 requestId를 `{wf}:golden:{unfrozen 집합 해시}`(risk-brief `{wf}:risk:{version}` 선례)로 버전화해 새 unfrozen 집합이 새 요청을 내도록 해야 한다.**
- **golden_diff에 expiresAt 없음(C3 oracle_approval parity)**: B1 만료 sweep 미참여(미승인 blocking 요청의 liveness 경로 없음) — Slice 2에서 `makeGoldenBrief(ttlMs)` 래퍼로 봉합 가능.
- **`freezeGoldensByWorkflow` read-modify-write 비원자(P2r-4 updateWpRisks parity)**: tx/FOR UPDATE 없이 golden_refs 통째 UPDATE — 동시 freeze는 멱등(무해)이나 freeze-vs-`upsert` 경합 시 lost-update 가능(현 단일-writer·human-triggered라 저위험·golden_refs는 재구성 가능 projection). Slice 2 per-golden writer 도입 시 SELECT FOR UPDATE 필요.
- **자동 캡처**: develop_code 실행 출력 캡처 → golden 초안 자동 생성(Developer result 스키마 확장·교차서비스).
- per-story/per-golden 개별 freeze·golden 버전 supersede·E10 재분해 시 golden 보존.
