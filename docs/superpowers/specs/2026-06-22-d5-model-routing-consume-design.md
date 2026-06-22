# D5 — 모델 라우팅 소비 (수직 슬라이스: develop_code)

**날짜**: 2026-06-22
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: `docs/superpowers/specs/2026-06-11-wiki-agent-risk-classifier-design.md`(§5 모델 라우팅)·handoff §5
**선행 슬라이스**: P2r-1 코어(#286·`routeModels` §5)·P2r-2 영속(`approvedForWorkflow` N6)·P2r-3 생산자(#314)·P2r-4 라우팅(#316)·C5 승인 UI(#318)

## 배경

P2r 분류기는 승인된 분류마다 `modelRouting`(RoutedAgent→opus/sonnet·§5)을 산출·영속한다(`risk.approved.modelRouting`·`RiskClassificationRepo.approvedForWorkflow`). 그러나 **소비자가 없어** 모든 에이전트가 자기 서비스의 단일 `CLAUDE_MODEL`로 동작한다(재감사 D5). HIGH 리스크 프로젝트가 opus로 격상되지 않고, LOW 리스크가 sonnet으로 절감되지 않는다.

D5는 그 마지막 연결을 잇는다(수직 슬라이스): **워커가 WP를 디스패치할 때 승인된 `modelRouting`을 조회·해석해 디스패치 입력에 concrete model id를 실어보내고, develop_code 에이전트가 그 모델로 동작**한다. 이로써 P2r 가치사슬이 완성된다 — 리스크가 검증 강도(wp.risk·mutation)뿐 아니라 **모델 선택**도 구동.

## 범위 결정 (브레인스토밍 확정·Approach B)

- **수직 슬라이스 — develop_code(developer)만 소비**: 메커니즘을 최소 blast radius로 end-to-end 실증. designer/tester/security 소비는 동일 `payload.model ?? config` 후속(builder는 RoutedAgent 아님 → 항상 폴백).
- **워커 디스패치 경로만**: 자율 WP 실행(P4-1)이 owningRole로 디스패치하는 경로. 러너 tool-loop(대화형)는 per-WP 리스크 라우팅 무관 → 비범위.
- **tier→concrete id 매핑은 Manager 단일 출처**(config opus/sonnet id). 에이전트는 받은 concrete id만 사용(tier 미인지).
- **off/미승인 → CLAUDE_MODEL 폴백**(회귀 0).

## 아키텍처 (데이터 흐름)

```
워커 handleWpDispatchSignal (workflowId·wp.owningRole)
  → riskStore.approvedForWorkflow(workflowId) → RiskClassification|null (modelRouting)
  → resolveWpModel(modelRouting, owningRole, {opus,sonnet}) → concrete model id | undefined
  → buildWorkerInput(wp, userContext, model) → input.model (있을 때만)
  → RedisAgentHandler payload (collaborationPayloadFields.model 수용)
  → developer: payload.model → runner.generateChanges(..., model) → callClaudeText(model ?? this.model)
```

### 변경 (Manager + shared + developer)

| 파일 | 종류 | 책임 |
|---|---|---|
| `xzawedShared collaborationPayloadFields`(`types/agent-query.ts`) | 수정(additive) | `model?: z.string().optional()` 추가 — 전 에이전트 `ManagerTo{Agent}MessageSchema.payload`가 spread하므로 **자동 수용**(developer만 소비·나머지 무시·후속 토대) |
| `xzawedManager config.ts` | 수정 | `MANAGER_MODEL_ROUTING` flag·`MANAGER_MODEL_OPUS`(기본 `claude-opus-4-8`)·`MANAGER_MODEL_SONNET`(기본 `claude-sonnet-4-6`) |
| `xzawedManager streams/model-routing.ts` | 신규 | `resolveWpModel(modelRouting, owningRole, {opus,sonnet})` 순수 — owningRole→RoutedAgent→tier→concrete id |
| `xzawedManager streams/worker.ts` | 수정 | `buildWorkerInput(wp, userContext?, model?)`에 model 주입·`WorkerDeps`에 `riskStore?`+`modelRouting?` 추가·`handleWpDispatchSignal`이 승인 라우팅 조회→resolveWpModel→buildWorkerInput |
| `xzawedManager supervisor.ts`·`server.ts` | 수정(배선) | `MANAGER_MODEL_ROUTING`+riskStore 시 worker deps에 riskStore·modelRouting(config opus/sonnet) 주입 |
| `xzawedDeveloper claude/runner.ts` | 수정 | `generateChanges(plan, projectPath, context, clarificationContext?, model?)` — `callClaudeText(this.client, model ?? this.model, ...)` |
| `xzawedDeveloper developer.ts` | 수정 | handle이 `payload.model`을 `runner.generateChanges`에 전달 |
| `xzawedDeveloper types.ts` | **변경 0** | `ManagerToDeveloperMessageSchema.payload`가 `...collaborationPayloadFields` spread → model 자동 수용 |

## 각 단위 계약

- **`resolveWpModel(modelRouting: Record<RoutedAgent,'opus'|'sonnet'> | undefined, owningRole: string, ids: {opus: string; sonnet: string}): string | undefined`** (순수): owningRole 소문자를 RoutedAgent로 매핑(`developer→Developer`·`designer→Designer`·`tester→Tester`·`security→Security`·`planner|pm→PM`; 그 외→undefined). modelRouting 없음·매핑 없음·tier 없음 → `undefined`. 있으면 tier(`opus|sonnet`)→`ids.opus|ids.sonnet`.
- **`buildWorkerInput(wp, userContext?, model?)`**: 기존 출력에 `...(model !== undefined && { model })`. model 미전달 시 바이트 동일(P4 회귀 0).
- **worker `handleWpDispatchSignal`**: `deps.riskStore && deps.modelRouting`이면 `approvedForWorkflow(workflowId)` 조회(never-throw·실패/null → 폴백)→`resolveWpModel(approved?.modelRouting, wp.owningRole, deps.modelRouting)`→buildWorkerInput에 전달. 미주입(flag off)이면 조회 0·model 미주입(회귀 0).
- **developer `runner.generateChanges`**: 5번째 옵셔널 `model?`. `callClaudeText`에 `model ?? this.model` 전달. 기존 4-인자 호출 회귀 0.
- **developer `developer.ts`**: `msg.payload.model`을 generateChanges로 스레딩(undefined면 기존 동작).

## flag · 전제

- **`MANAGER_MODEL_ROUTING`**(기본 false·`v === 'true'`). 전제: 승인된 분류 존재(실효성엔 `MANAGER_RISK_CLASSIFY`+`MANAGER_RISK_ROUTING`/`MANAGER_RISK_DECISION`로 승인) + `MANAGER_TASK_WORKER`(워커 가동) + `DATABASE_URL`(riskStore). off → 워커 조회 0·회귀 0.
- **`MANAGER_MODEL_OPUS`**(기본 `claude-opus-4-8`)·**`MANAGER_MODEL_SONNET`**(기본 `claude-sonnet-4-6`): tier→concrete id. (claude-api 레퍼런스 최신 id.)
- **새 migration 없음**(`012 risk_classifications` 재사용·`approvedForWorkflow` 읽기만).

## 검증 (TDD)

- **`resolveWpModel`(순수·unit)**: developer→Developer→opus tier→opus id·라우팅 없음→undefined·미지 역할(builder)→undefined·sonnet tier→sonnet id.
- **`buildWorkerInput`(unit)**: model 전달 시 input.model 포함·미전달 시 키 부재(회귀 0).
- **worker `handleWpDispatchSignal`(unit)**: riskStore+modelRouting 주입+승인 분류 mock → buildWorkerInput에 resolved model·approvedForWorkflow null → model 미주입(폴백)·riskStore 미주입(flag off) → 조회 0·model 미주입.
- **developer `runner.generateChanges`(unit)**: model 전달 시 그 모델로 callClaudeText·미전달 시 this.model.
- **developer `developer.ts`(unit)**: payload.model 스레딩.
- **shared `collaborationPayloadFields`(unit)**: model? 수용(전 에이전트 schema safeParse 통과).
- **E2E DB 통합(skip-if-no-DB·`wf-d5-` prefix)**: 승인 HIGH 분류(modelRouting 전부 opus)→워커가 `resolveWpModel`로 opus concrete id 해석→buildWorkerInput.model=opus id.

## 수용 기준

1. `MANAGER_MODEL_ROUTING` off → 워커 동작 P4 바이트 동일(조회 0·model 미주입·회귀 0).
2. on + 승인된 HIGH 분류 → develop_code WP 디스패치 입력에 opus concrete id(developer가 opus로 동작).
3. 승인 분류 없음·미지 역할 → model 미주입 → 에이전트 CLAUDE_MODEL 폴백.
4. developer 4-인자 generateChanges 기존 호출 회귀 0.
5. shared model? 추가가 다른 에이전트 schema 회귀 0(무시).

## 비범위 (후속 — 명시)

- **designer/tester/security 에이전트 소비**(동일 `payload.model ?? config` 패턴·각 ~2줄).
- **러너 tool-loop(대화형) 경로** 모델 라우팅(per-WP 리스크 무관).
- **P7 per-WP risk 재채점** · **tier 세분**(haiku 등 3-tier) · **모델 routing 관측/감사**.
