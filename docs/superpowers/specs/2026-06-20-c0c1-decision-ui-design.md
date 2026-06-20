# C0/C1 결정 UI — 설계

> 날짜: 2026-06-20 · 사람 루프 첫 UI 표면 · 원천 사양: `docs/senario/HUMAN_DECISION_PERSISTENCE.md` §2-6 · `docs/superpowers/specs/2026-06-13-p6-decision-routing-fix-reverify-design.md`(#299 백엔드)
> 불변식: M8(무음 통과/drop 금지) · M9(비부인 — 사람 결정의 권위·불변 영속) · N6(사람 승인이 라우팅을 확정)
> 전제 머지: #299(P6 결정 라우팅 — `fix_reverify` 폐루프 백엔드) · #302(P5-1 릴리스 게이트 코어)

## 1. 목표

모든 하류 아크(#299 `fix_reverify` 폐루프 · oracle DoR · risk 분류)가 **사람 결정에서 끝나는데 UI 표면이 0**이다. #299 백엔드(`DecisionRecordedConsumer`가 `fix_reverify`를 `reopenLease`+`dispatch_signal`로 구현 재진입)는 완성·테스트됐지만, 사람이 pending 결정을 **보고 choice를 제출할 수단이 없어** 폐루프가 놀고 있다.

C0/C1은 그 인간 surface를 구축한다: 프로젝트별 **결정 대기함(pending decisions)** 패널에서 사람이 `defect_brief`를 검토하고 choice를 제출하면, 제출이 Manager 결정 라우팅을 트리거해 `fix_reverify` 폐루프를 실제로 닫는다.

핵심 설계 원칙: **Pull · 프로젝트 스코프 · 비부인.** 결정은 백그라운드 lease sweep이 세션과 무관하게 비동기 생성하므로 push(WS)가 아니라 **Pull(HTTP 프록시 + 결정 패널)**로 가져온다. 결정은 워크플로가 아니라 **프로젝트**로 스코핑하고(운영자의 자연스러운 단위), 제출자 신원은 **인증된 사용자 JWT subject로 권위 있게 바인드**(M9)한다.

## 2. 비목표 (범위 밖 · 후속 슬라이스)

- **spec_fix / accept_known / reject 실동작**: 이 3종 choice는 제출 시 M9 영속(감사 추적)만 되고 다운스트림(재분해 · 게이트 override+SignOff · saga 롤백)은 미배선이다(#299 `decision-consumer.ts`가 `fix_reverify`만 처리). UI는 4종을 모두 노출하되 정직 라벨(§9)로 구별. 실동작은 P2/P5/후속 P6.
- **defect_brief 외 6개 요청 타입**: `conformance_review`·`gate_override`·`degraded_release`·`oracle_approval`·`golden_diff`·`safe_resume` — 현재 런타임에서 생성되는 것은 `defect_brief`뿐(lease sweep escalation). 목록 조회는 타입 무관이나 카드 상세 렌더는 `defect_brief` 컨텍스트만. 다른 타입 카드는 후속.
- **EXPIRED sweep / TTL**: `buildDefectBrief`가 `expiresAt` 미설정이라 `DECISION_EXPIRED`는 구조적 도달 불가 — TTL 설계는 별도 후속(B1).
- **oracle 승인 UI(C3)·risk 승인 UI(C5)·ESCALATED 재개입(C2)·TaskGraph 모니터(C4)**: 같은 프록시·패널 토대를 재사용하는 후속.
- **결정 이력 뷰**: 패널은 PENDING만. RESOLVED/EXPIRED 이력은 후속.

## 3. 배경 — 현재 상태와 단층

- **결정 생성(백그라운드)**: lease 만료 sweep이 attempt 상한 초과 시 `escalateOne` → `onEscalated` → `makeEscalationBrief(store)` → `buildDefectBrief` → `DecisionRepo.createRequest`로 `defect_brief` DecisionRequest를 영속한다(#291·#298). 단 **Task Manager 경로 전부 flag-off**(`TASK_MANAGER_ENABLED`·`MANAGER_DECISION_BRIEF` 기본 false)라 실 결정 생성은 현재 0(§12 시드 참조).
- **결정 영속**: `decision_requests`(가변 프로젝션 PENDING→RESOLVED|EXPIRED|SUPERSEDED) + `human_decisions`(불변·부인방지) + `sign_offs`(migration 011·M9). 진실원천 `manager_events`(`decision.*`).
- **결정 제출 라우트(#299)**: `POST /workflows/:workflowId/decisions/:requestId/decision`(`decision.route.ts`) — `workflowId↔requestId` IDOR 404 게이트·`authHook`(서비스 JWT) 경계·`shouldWireDecisionRoute(routing, hasPool, hasAuth)` 3중 게이트 뒤 등록. `decidedBy`는 **요청 body에서** 옴.
- **결정 라우팅(#299)**: `DecisionRecordedConsumer`가 `decision.recorded`(`manager:decision:main`) 소비 → `fix_reverify`면 `reopenLease`(escalated→active·attempt advance)+`publishDispatchSignal` → 워커 재실행. **다른 choice는 no-op**(폐루프 미차단·실동작 후속). 라우트와 **디커플**(Redis 이벤트 소비·HTTP 무관).

### 3대 단층 (이 슬라이스가 닫음)

1. **UI 표면 0** — Orchestrator가 Manager decision route를 프록시하지 않고, `ManagerMessageType` WS union은 닫힌 5타입(Pull이라 불변). 사람이 pending 결정에 도달할 경로가 없다.
2. **결정에 projectId 없음** — `decision_requests`는 workflowId/correlationId만(project_id/userId 0). 프로젝트 스코프 조회 불가.
3. **제출 신원 위조 가능** — `decidedBy`가 body에서 와 비부인(M9)이 약하다.

## 4. 확정 결정 (브레인스토밍)

| # | 결정 | 근거 |
|---|---|---|
| 1 | **전달 = Pull** (HTTP 프록시 + 결정 패널) | 결정은 백그라운드 sweep이 비동기 생성 → 세션 WS 이미 닫힘(lifecycle 불일치). `knowledge.route.ts` 프록시 패턴 재사용. WS union 불변 |
| 2 | **스코핑 = 프로젝트 + project_id 영속**(생성 시점 저장) | 운영자 단위 · 인덱스 탄 `pendingByProject` 조회 · query-time JSONB 조인 기각 |
| 3 | **타입 = defect_brief 중심** | 현재 생성되는 유일 타입 · 목록은 타입무관·카드는 defect_brief 렌더 · 4 choice 노출 |
| 4 | **배치 = ActivityBar 신규 Decisions 탭** | 프로젝트 스코프 대기함 · WikiPanel 프록시 패턴 일치 · 세션 lifecycle 무관 · 발견성 |
| 5 | **B5 = JWT 바인드 포함** | `decidedBy`를 인증 사용자 신원으로 권위 주입(M9) · 인증 인프라 기존재 |

## 5. 아키텍처 & 데이터 흐름

```
[생성·백그라운드, 기존 + projectId 스레딩]
lease 만료 sweep → escalateOne
   → graphStore.getGraph(wf).userContext?.projectId   (try/catch → null·N3 never-throw)
   → buildDefectBrief(info + projectId) → DecisionRepo.createRequest
   → decision_requests(project_id) + manager_events + manager_outbox   [단일 tx · M5]

[조회·Pull]
사용자 → Orchestrator GET /projects/:id/decisions/pending  (open·graceful {items:[]})
   → Manager GET /projects/:id/decisions/pending → pendingByProject(id) → {items:[...]}

[제출·Pull + B5]
사용자(카드 버튼) → Orchestrator POST [userAuthHook]  decidedBy = req.authUser.sub  (body 신원 무시)
   → Manager POST /projects/:id/decisions/:requestId/decision  [authHook·service token]
   → projectId IDOR 404 게이트 → recordDecision → decision.recorded
   → #299 DecisionRecordedConsumer: fix_reverify → reopenLease + dispatch_signal / 그 외 no-op
```

`MANAGER_DECISION_BRIEF`+`MANAGER_DECISION_ROUTING`(기존 flag) 재사용 — **신규 flag 없음**. 모든 변경은 additive이며 flag off면 기존 동작과 바이트 동일(회귀 0). `ManagerMessageType`·`useSessionWs`·승인 카드 경로 **전부 불변**.

## 6. PR-A — Manager 백엔드

### 6.1 migration 015 — `015_decision_requests_project_id.sql`
```sql
-- 결정 요청에 프로젝트 스코프 부여(C0/C1 결정 UI). additive·legacy 행은 NULL.
ALTER TABLE decision_requests ADD COLUMN IF NOT EXISTS project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_decision_requests_project_status
  ON decision_requests (project_id, status);
```
- `runMigrations`는 모든 `.sql`을 매 기동 실행(pg advisory lock 직렬화) → **`IF NOT EXISTS` 필수**(rerun-safe).
- **백필 없음**: legacy 행 `project_id NULL`. `pendingByProject(id)`의 `WHERE project_id=$1`이 NULL 행을 안전 제외(행은 workflow로 여전히 조회 가능). NOT NULL 미부여(nullable이 정직).

### 6.2 `db/decision.types.ts` — projectId 필드(additive)
- `DecisionRequestSchema`에 `projectId: z.string().nullable().optional()`. **requestId(`{wf}:{wpId}:{attempt}`) 정체성 불변**(projectId는 식별자 아님·N4 안정).
- `RequestRow`에 `project_id: string | null` · `rowToRequest`가 매핑.

### 6.3 `db/decision.repo.ts`
- `createRequest` 입력에 `projectId?: string | null` 추가 · INSERT 컬럼 목록에 `project_id` 추가(파라미터 1개).
- **신규** `pendingByProject(projectId: string): Promise<DecisionRequest[]>`:
  ```sql
  SELECT * FROM decision_requests WHERE project_id = $1 AND status = 'PENDING' ORDER BY created_at
  ```
- `pendingByWorkflow`(기존·호출자 0) 보존.

### 6.4 `streams/decision-brief.ts` — projectId 스레딩
- `EscalationInfo`에 `projectId?: string | null`(internal contract·기존 호출자 영향 0).
- `DecisionRequestInput`에 `projectId?: string | null`(additive·createRequest 입력 미러).
- `buildDefectBrief`가 `info.projectId`를 `DecisionRequestInput.projectId`로 전파(requestId·options 불변). 컨텍스트에 표기는 선택(주 식별은 컬럼).

### 6.5 `streams/lease.ts` — graphStore 주입 (§0-a 정정)
- ⚠️ **핵심 발견**: `handleLeaseSweep`는 현재 TaskGraphRepo 접근이 0. project_id를 생성 시점에 넣으려면 좁은 포트를 주입해야 한다.
- 좁은 포트 정의(`db/task-graph.repo.ts` 또는 lease.ts 인접): `GraphQueryPort { getGraph(wf: string): Promise<{ userContext: UserContext | null } | null> }`(TaskGraphRepo가 구조적 충족).
- `SweepDeps`에 `graphStore?: GraphQueryPort`(optional·additive).
- `escalateOne`이 `onEscalated` 호출 직전:
  ```ts
  let projectId: string | null = null
  if (deps.graphStore) {
    try { projectId = (await deps.graphStore.getGraph(wf))?.userContext?.projectId ?? null }
    catch (err) { /* N3 never-throw: lease escalation을 막지 않음 */ log.warn(...); projectId = null }
  }
  ```
  → `EscalationInfo`에 projectId 합류. **lease escalation은 lookup 실패에 막히지 않음**(best-effort·projectId는 스코프 메타데이터일 뿐 dispatch/completion 정합성과 무관).

### 6.6 `streams/supervisor.ts` — 단일 주입점
- `createSupervisor`가 LeaseSweeper deps 조립 시 `briefStore`(=decisionBrief 활성)이면 `graphStore: deps.repo`(TaskGraphRepo) 합류. briefStore 없으면 미주입(회귀 0).

### 6.7 `api/decision.route.ts`
- **신규 GET** `/projects/:projectId/decisions/pending` — `opts.decisionRepo.pendingByProject(projectId)` → `{ items: [...] }`(knowledge/oracle 봉투 일치). **open read**(per-route authHook 없음·플러그인 등록 게이트가 이미 보호). repo 없으면 `{ items: [] }`.
- **submit 프로젝트 스코프 리팩터** (§0-b 정정·IDOR [HIGH] 폐쇄): 기존 `POST /workflows/:workflowId/decisions/:requestId/decision`을 `POST /projects/:projectId/decisions/:requestId/decision`로 전환.
  - `getRequest(requestId)` → `!existing || existing.projectId !== projectId` → **404**(존재 오라클 회피·fail-close). workflowId는 요청 행에서 파생(client 미신뢰).
  - `decidedBy`는 body(Orchestrator가 JWT subject로 채움) · `CHOICE_TO_ROUTED` · `recordDecision` 불변.
  - `authHook`(서비스 JWT) preHandler 유지. `shouldWireDecisionRoute` 3중 게이트 불변.
  - #299 `DecisionRecordedConsumer`는 Redis 이벤트 소비라 **라우트 변경 영향 0**(라우트 테스트만 갱신).

## 7. PR-B ① — Orchestrator 프록시 + JWT 바인드

### 7.1 `api/decisions.route.ts`(신규·`knowledge.route.ts` 패턴)
- 공유 헬퍼 재사용: `buildManagerUrl`(SSRF `new URL`)·`relayManagerResponse`(상태 pass-through)·`managerWriteHeaders`(service token).
- `GET /projects/:projectId/decisions/pending` — **open**·Manager GET 프록시·미응답/오류 시 graceful `{ items: [] }` 폴백.
- `POST /projects/:projectId/decisions/:requestId/decision` — **`preHandler=[userAuthHook]`**(쓰기).
  - `decidedBy = req.authUser?.sub ?? 'local-user'` — **body 신원 절대 무시**. AUTH=none(로컬 단일 사용자)은 `'local-user'` 고정 폴백.
  - body `{ choice, justification? }` + `decidedBy` 주입 → Manager POST(service token 헤더).
  - transport 오류 502.

### 7.2 `server.ts` 등록
- `knowledgeRoutes` 옆에 `decisionsRoutes({ managerUrl, userAuthHook, signServiceToken })` 등록(동일 주입 소스). userAuthHook/ signServiceToken 생성 로직 재사용.

### 7.3 `lib/api.ts`
- `getPendingDecisions(baseUrl, projectId, accessToken?): Promise<PendingDecision[]>`.
- `submitDecision(baseUrl, projectId, requestId, { choice, justification? }, accessToken?)`.
- 기존 knowledge 헬퍼 패턴(validateBaseUrl·Authorization Bearer if token).

## 8. PR-B ② — DecisionsPanel UI

- **`store/integrations.store.ts`**: `ActivePanel` union에 `'decisions'` 추가. persist `partialize` 미포함(탭 비-sticky 유지 — 기존 동작 일관).
- **`components/layout/ActivityBar.tsx`**: `NAV_ITEMS`에 `{ panel: 'decisions', icon: '📋' }`(wiki 📚와 구분). `t('activity_bar.decisions')` 자동 조회·`data-testid="nav-decisions"`.
- **`components/ChatLayout.tsx`**: `activePanel === 'decisions' && <DecisionsPanel />` 분기.
- **`components/DecisionsPanel.tsx`**(신규·WikiPanel idiom):
  - `useParams`로 projectId(없으면 — 로컬 `/chat` 라우트 — empty 가드)·`useAuthStore`로 accessToken.
  - **signal abort fetch + refreshKey** 패턴(언마운트 후 setState 경쟁 차단)·열 때 fetch + 새로고침 버튼 + 제출 성공 후 refetch. loading/empty 상태.
  - `data-testid`: `decisions-panel`·`decisions-item`·`decisions-refresh`·`decisions-empty`.
- **DecisionCard**(defect_brief 렌더): `context.location`·`expectedVsActual`·`impact[]`·`evidenceRefs[]`·`attribution{faultTier, counters}` 표시.
  - **4 choice 버튼**(§9 정직 라벨): `fix_reverify` 강조(즉시 재구동) · `spec_fix`/`accept_known`/`reject`는 "기록됨 · 후속 동작 없음" 보조 라벨. 클릭 → `submitDecision` → toast → refetch. `data-testid="decision-submit-<choice>"`.
- **i18n** ko/en/ja: `activity_bar.decisions` + `decisions.*` 네임스페이스(title·empty·refresh·choice 4종·choice_noop_hint·status·submit_failed·context 레이블). `node scripts/check-i18n.js` 게이트.

## 9. 정직 라벨 — 3개 비활성 choice (§0-c 정정)

`decision-consumer.ts`는 `fix_reverify`만 동작하고 나머지 3종은 무음 no-op(영속만)이다. 사용자 결정(4버튼 노출)을 유지하되, **무음 stall 오인을 막기 위해**:
- `fix_reverify`: 주 액션 강조 — "구현 재시도 + 재검증"(즉시 폐루프).
- `spec_fix`·`accept_known`·`reject`: 보조 스타일 + 명시 hint "결정은 기록되나 후속 동작은 준비 중"(M9 감사 가치는 유지·워크플로 즉시 재구동 없음을 정직히 표기).
- 결정은 모두 `recordDecision`로 영속(비부인 감사 추적) — UI는 다운스트림 효과의 차이만 정직하게 드러낸다.

## 10. 보안 · IDOR · 비부인

- **IDOR(submit)** [HIGH·§6.7]: `existing.projectId !== projectId` 404 게이트로 타 프로젝트 결정 제출 차단(DB 행이 진실원천·params 미신뢰). 존재 오라클 회피 위해 403 아닌 404.
- **비부인(M9)** [§7.1]: `decidedBy`는 **인증 사용자 JWT subject**로 권위 바인드(client body 무시). AUTH=jwt에서만 권위 보장 — AUTH=none(로컬)은 `'local-user'` 고정(스펙 명시 한계).
- **무인증 권한 엔드포인트 금지**: Manager submit은 `shouldWireDecisionRoute`(authHook 필수) 게이트 · Orchestrator submit은 `userAuthHook` preHandler.
- **SSRF**: `buildManagerUrl`이 `new URL(managerUrl)` 선파싱.
- **service token vs 사람 신원 분리**: Manager는 service token으로 호출자(Orchestrator) 인증 · `decidedBy`(body)로 사람 신원 — 혼동 없음(knowledge 쓰기 패턴 일치).

## 11. 테스트 전략 (회귀 0 — 모든 flag off면 바이트 동일)

**PR-A (Manager):**
- `decision.repo` unit(mock pool): `pendingByProject` 프로젝트 격리 · `createRequest` project_id INSERT.
- DB 통합(`test/decision-project.integration.test.ts`·skip-if-no-DB·prefix `wf-dp-`·afterAll 스코프 cleanup): project A/B createRequest → `pendingByProject(A)` 격리 · recordDecision 후 목록 감소 · 멱등.
- `decision.route` test: GET `{items}` · project-scoped POST · **IDOR 404**(projectId mismatch는 recordDecision 미호출).
- `lease` graphStore lookup unit: getGraph 성공→projectId 전파 · null/throw→null 강등(escalation 미차단).

**PR-B (Orchestrator):**
- `decisions.route` proxy test: GET graceful `{items:[]}` 폴백 · **decidedBy=JWT subject(body 무시)** · 미인증 401.
- `DecisionsPanel.browser.test.tsx`(mock `lib/api`·MemoryRouter): 렌더·empty/loading·`fix_reverify` vs no-op 라벨 구별·submit→refetch·data-testid.
- E2E(`e2e/specs/panels/decisions-panel.spec.ts`): proxy mock 또는 seed로 카드 렌더·제출 흐름.

## 12. 시드 / 데모 한계 (정직)

Task Manager flag-off라 **현재 실 결정 생성 0**. 따라서:
- DB 통합 테스트·브라우저 테스트는 `decision_requests` seed(project_id 포함) 또는 proxy mock으로 검증.
- 실 결정 생성은 `TASK_MANAGER_ENABLED`+`MANAGER_DECISION_BRIEF`+`DATABASE_URL`+lease escalation 필요.
- legacy 그래프(userContext 부재)의 escalation은 projectId NULL → 프로젝트 패널에 미표시(graceful degradation·스펙 명시).

## 13. 슬라이스 / PR 경계

- **PR-A** `feat/manager/c0-decision-project-scope`: migration 015 · decision.types · decision.repo(pendingByProject) · decision-brief(projectId) · lease(graphStore) · supervisor(주입) · decision.route(GET pending + project-scoped POST) · DB 통합 테스트. **독립 머지 가능**(DB 테스트로 완결).
- **PR-B** `feat/orchestrator/c1-decision-panel`: decisions.route 프록시 + JWT · server.ts 등록 · lib/api · integrations.store · ActivityBar · ChatLayout · DecisionsPanel · DecisionCard · i18n · 브라우저/E2E 테스트. **PR-A 머지 후** 분기(Manager GET/POST 의존).

## 14. 불변식 매핑

| 불변식 | 충족 |
|---|---|
| **M8** 무음 통과/drop 금지 | 3개 비활성 choice를 정직 라벨로 노출(무음 stall 오인 차단) · 프록시 graceful 폴백은 빈 목록(무음 실패 아님) |
| **M9** 비부인 | `decidedBy`를 인증 JWT subject로 권위 바인드 · `human_decisions` 불변 append-only(기존) |
| **N6** 사람 승인이 라우팅 확정 | 사람 choice 제출이 `decision.recorded`→#299 라우팅 트리거(fix_reverify 폐루프) |
| **N4** 식별자 안정 | requestId(`{wf}:{wpId}:{attempt}`) 불변 · project_id는 컬럼(식별자 아님) |
| **N3** best-effort never-throw | graphStore lookup 실패가 lease escalation을 막지 않음(projectId null 강등) |

## 15. 후속 (이 토대가 여는 것)

C2 ESCALATED 재개입 · C3 oracle 승인 UI · C5 risk 승인 UI(N6) · spec_fix/accept_known/reject 실동작(P2/P5) · EXPIRED sweep+TTL(B1) · 결정 이력 뷰 — 전부 이 프록시·패널·project_id 토대를 재사용한다.
