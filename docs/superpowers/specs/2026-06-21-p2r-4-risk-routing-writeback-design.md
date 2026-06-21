# P2r-4 — 리스크 승인 라우팅 + wp.risk write-back (백엔드 키스톤)

**날짜**: 2026-06-21
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/superpowers/specs/2026-06-11-wiki-agent-risk-classifier-design.md`(슬라이스 분해 P2r-4)·`docs/senario/WIKI_AGENT_RISK_CLASSIFICATION.md` §3-4(N6 승인 라우팅)
**선행 슬라이스**: P2r-1 코어(#286)·P2r-2 영속(`RiskClassificationRepo`)·**P2r-3 생산자(#314·pending 분류 영속)**·P4 mutation θ게이트(#296·`meetsMinRisk` HIGH-gate)

## 배경

post-#312 재감사가 지목한 단층: **wp.risk가 영원히 default MEDIUM** → mutation θ게이트(`meetsMinRisk(wp.risk,'HIGH')`)가 기본 설정에서 **절대 미발화**(구조적 사망). P2r-3(#314)이 pending 리스크 분류를 영속하는 첫 생산자를 만들었으나, 그 분류를 소비해 `wp.risk`에 반영하는 경로가 없어 D4(wp.risk populate)·mutation 게이트가 여전히 막혀 있다.

P2r-4은 그 마지막 연결을 잇는다: **사람이 pending 분류를 승인 → `risk.approved` 발행 → 소비자가 그 risk를 graph_dag의 WP들에 write-back → mutation 게이트(이미 `wp.risk` 읽음)가 HIGH 분류 승인 시 발화**.

### 핵심 통찰 (왜 사람 승인이 필수인가)

mutation 게이트는 HIGH-gated(`MANAGER_MUTATION_MIN_RISK` 기본 HIGH)이고, 순수 코어 §4(`evaluateHumanGate`)는 **HIGH risk면 항상 `humanGate.required=true`**를 반환한다. 즉 mutation 게이트를 발화시키는 유일한 경로는 **사람이 HIGH 분류를 승인**하는 것이다(자동승인은 LOW/MED만 처리 — mutation이 어차피 skip). 따라서 승인 라우트가 이 슬라이스의 핵심이며, 자동승인 변형은 mutation 키스톤에 기여하지 않는다.

## 범위 결정 (브레인스토밍 확정)

- **백엔드 키스톤만**: 승인 라우트 + `risk.approved` 소비자 + wp.risk write-back. **C5 UI·디스패치 게이팅·D5 모델 라우팅 소비는 후속**.
- **uniform 적용**: 프로젝트 단일 risk를 모든 WP에 동일하게 write-back(P7 per-WP 재채점은 후속).
- **opportunistic write-back**: risk는 readiness(DoR)를 안 바꾸므로 oracle.approved와 달리 **재디스패치하지 않는다**.

## 아키텍처 (단위·경계)

```
decompose → [P2r-3] classify(pending)
  → [사람] PATCH /workflows/:wf/risk-classification/approve
  → RiskClassificationRepo.approve  (risk.approved 발행·트랜잭셔널 아웃박스 — 이미 존재)
  → OutboxRelay → RiskApprovedConsumer
  → TaskGraphRepo.updateWpRisks(wf, risk)   ★graph_dag WP risk 갱신
  → 이후 그 WP verify 시 meetsMinRisk(wp.risk='HIGH','HIGH')=true → mutation θ게이트 발화
```

### 신규/수정 파일

| 파일 | 종류 | 책임 |
|---|---|---|
| `db/task-graph.repo.ts` | 수정(+1 메서드) | `updateWpRisks(workflowId, risk): Promise<{updated: number}>` — graph 모든 WP `risk` 치환·**version 불변**·WP id 불변·userContext 보존·그래프 없음 no-op |
| `streams/risk-consumer.ts` | 신규 | `RiskApprovedSchema`·`buildRiskApprovedHandler(deps)`·`RiskApprovedConsumer`(BaseConsumer·dedup ON·group `manager-risk-consumers`·prefix `manager:risk`) — `risk.approved` → `updateWpRisks`. 재디스패치 없음 |
| `api/risk.route.ts` | 신규 | `riskRoute(app, {repo, authHook?})` — `PATCH /workflows/:workflowId/risk-classification/approve`(body `approvedBy`) → `repo.approve` → 200 `{ok,eventId}` / 404(미존재·이미 승인) / 400(approvedBy 누락) / 503(repo 없음). 쓰기는 authHook 보호 |
| `streams/supervisor.ts` | 수정 | `SupervisorConfig.riskRouting`·`SupervisorDeps.graphStore`(write-back 대상)·`riskConsumer` 조건부 배선(`shouldWireRiskConsumer` 순수 게이트) |
| `server.ts` | 수정(배선) | `MANAGER_RISK_ROUTING`+pool 시 `RiskClassificationRepo`(승인+소비 공유)·`riskRoute` 등록(authHook 시)·supervisor에 graphStore 합류·OutboxRelay 기동 조건 추가·오진 경고 |
| `config.ts` | 수정 | `MANAGER_RISK_ROUTING` flag |

각 단위의 계약:
- **`updateWpRisks(wf, risk)`**: read-modify-write — `getGraph`로 `WorkPackage[]` 읽기 → 각 `{...wp, risk}` → `UPDATE task_graphs SET graph_dag=$2 WHERE workflow_id=$1`(userContext 보존 재직렬화). 반환 `{updated}`(WP 수·그래프 없으면 0). version 미변경(재분해 아님). WP id는 content-hash가 risk 제외(N4)라 불변.
- **`RiskApprovedConsumer`**: `risk.approved` payload `{workflowId, projectId, risk, version, modelRouting}`(P2r-2 `RiskClassificationRepo.approve` 발행)에서 `workflowId`·`risk`만 소비. `modelRouting`은 미소비(D5 후속).
- **`risk.route`**: oracle.route 패턴. `approvedBy` 필수(서비스-JWT 경계·사람 신원은 상위). 미존재/이미 approved → `approve`가 null 반환 → 404.

## 데이터 흐름 — write-back의 멱등·안전

- **멱등**: `RiskApprovedConsumer`는 BaseConsumer dedup(M6) — 같은 `risk.approved`(envelope.eventId) 재전달은 skip. `updateWpRisks`는 자연 멱등(같은 risk 재적용=동일 결과).
- **재채점**: P2r-2 `approve`는 승인된 분류만 `risk.approved` 발행. 재채점(upsert version++)은 pending 리셋·재승인 필요(N6) → 새 `risk.approved`(version++) → write-back 재실행(최신 risk 반영).
- **id 안정성**: write-back이 WP `risk`만 바꾸고 id(content-hash)·dependencies·status를 보존 → 진행 중 그래프 정합성 유지(N4).

## 검증 (TDD)

- **`updateWpRisks`(DB 통합)**: 전 WP risk 갱신·version 불변·WP id 불변·userContext 보존·빈/없는 그래프 no-op(`{updated:0}`).
- **`RiskApprovedConsumer`(unit)**: 유효 `risk.approved` → `updateWpRisks(wf, risk)` 1회 호출·잘못된 스키마는 BaseConsumer DLQ(느슨 검증 불필요·정확 스키마).
- **`risk.route`(route test)**: approve 성공 200·미존재/이미 승인 404·approvedBy 누락 400·repo 없음 503·authHook 미설정 시 미등록(쓰기 권한 엔드포인트).
- **배선**: `shouldWireRiskConsumer` 순수 게이트·server 경고(전제 미충족).
- **E2E 통합(skip-if-no-DB·`wf-rr-` prefix)**: scoreClassification→upsert(pending)→upsertGraph(WP risk=MEDIUM)→approve→risk.approved 소비→`getGraph` WP risk=HIGH·`meetsMinRisk('HIGH','HIGH')===true` (mutation 게이트 활성 실증).

## flag · 전제

- **`MANAGER_RISK_ROUTING`**(기본 false·`v === 'true'`). 전제: `TASK_MANAGER_ENABLED`(Supervisor·graph)+`DATABASE_URL`(repo). 실효성엔 `MANAGER_RISK_CLASSIFY`(승인 대상 pending 분류 생성). off → 바이트 회귀 0.
- **OutboxRelay 기동 조건에 `MANAGER_RISK_ROUTING` 추가**(risk.approved 아웃박스→소비자 발행 필수 — 없으면 write-back 불발).
- **새 migration 없음**(`012 risk_classifications`·`007 task_graphs` 재사용).

## 수용 기준

1. `MANAGER_RISK_ROUTING` off → 기존 흐름 바이트 동일(회귀 0).
2. on + pending 분류 PATCH approve → `risk.approved` 발행 → 소비자가 graph_dag WP risk를 승인 risk로 갱신(version 불변·id 불변).
3. HIGH 분류 승인 후 그 WP verify 시 `meetsMinRisk(wp.risk,'HIGH')===true` → mutation θ게이트가 더 이상 무조건 skip하지 않음(D4·#296 dormant 해소).
4. 미존재·이미 승인 분류 approve → 404(idempotent·중복 write-back 없음).
5. write-back은 WP id·dependencies·status·userContext를 보존(N4 정합).

## 비범위 (후속 — 명시)

- **C5 리스크 승인 UI**(Orchestrator·C0/C1 패턴 재사용).
- **디스패치 게이팅**(INTAKE→DECOMPOSING — 리스크 승인 전 디스패치 차단·WP가 항상 populate된 risk로 디스패치 보장).
- **D5 모델 라우팅 소비**(`risk.approved.modelRouting`을 에이전트 디스패치 모델 선택에 반영 — 현재 전 에이전트 단일 `CLAUDE_MODEL`).
- **P7 per-WP 재채점**(프로젝트 단일 risk를 WP별로 세분).
- **재분해 시 risk 보존**(E10 — 재분해가 graph_dag 교체로 risk 리셋·재분해 트리거 부재라 잠복).
