# G1 — §13 서킷브레이커 decompose/advisory 배선

**날짜**: 2026-06-22
**상태**: 설계 승인됨(브레인스토밍 → 본 스펙)
**원천 스펙**: senario §13(서킷브레이커·횡단 회복탄력성) · OPERATIONS_DECISIONS §1(강등 모드 신호)
**선행 슬라이스**: §13 budget 서킷(#283) · provider 서킷(#284) · 벌크헤드(#285) · P2r-3 `runStage` circuit-aware 확장(#314·risk 스테이지만 배선)

## 배경

§13 budget/provider 서킷브레이커는 현재 **러너 tool-loop(`ClaudeRunner.run`)만** 감싼다(`server.ts`가 `budget`/`providerCircuit`를 `ClaudeRunner`에 주입). 그러나 두 개의 다른 LLM 경로가 **완전 무보호**다:

1. **decompose 다단계 분해**(`runDecomposition`) — epics→slice→deliverables→(repair 루프)→roles→infer-edges→(draft-oracles) 7개 스테이지가 워크플로당 최대 수십 회 LLM 호출. 병렬 워크플로 시 비용 폭발·provider 장애 시 낭비 호출.
2. **advisory 생산자**(`produceAdvisory`) — develop_code WP마다 optimization LLM 1회.

P2r-3(#314)이 `runStage`에 `circuit?: StageCircuit` 인자를 추가하고 **risk 스테이지만** 배선했다(러너와 동일 breaker 인스턴스 공유). G1은 그 메커니즘을 decompose 파이프라인 전체와 advisory에 잇는 후속이다 — 재감사 post-#312가 지목한 ready_now keystone.

## 범위 결정 (브레인스토밍 확정·Approach A)

- **A. `StageDeps.circuit` + `runStage` 3rd-arg 기본값**: `StageDeps`에 `circuit?: StageCircuit` 추가, `runStage(deps, spec, circuit = deps.circuit)`. decompose/advisory 진입부에서 circuit을 StageDeps에 실으면 7개 스테이지·advisory가 **시그니처 변경 0**으로 자동 보호. risk-producer의 명시 3rd-arg 호출은 그대로 우선(회귀 0).
- **신규 flag 없음**: 기존 `MANAGER_BUDGET_PER_WORKFLOW_USD`/`MANAGER_BUDGET_DAILY_USD`/`MANAGER_PROVIDER_CIRCUIT`로 게이트. breaker 미구성(전부 off)이면 circuit undefined → 무보호(오늘과 동일·회귀 0).
- **공유 인스턴스**: 러너·risk·decompose·advisory가 **같은 breaker 인스턴스**를 공유 → 워크플로(sessionId) 단위 비용이 통합 누적(G1의 핵심 가치).
- **graceful degrade**: circuit open/예산 초과 시 `runStage`가 이미 `spec.fallback()` 반환(decompose 스테이지 폴백·advisory 빈 findings). 새 동작 없음 — 기존 circuit 경로 재사용.

## 아키텍처 (데이터 흐름)

```
server.ts (budgetEnabled / MANAGER_PROVIDER_CIRCUIT)
  budget.breaker · providerCircuit.breaker · isProviderFailure   ← 러너·risk와 동일 인스턴스
   ├─→ decompose deps(sessions.route handleDecomposeRequest / producer produceDecomposition)
   │     → StageDeps.circuit = { workflowId: sessionId, budget, provider, isProviderFailure }
   │     → runDecomposition(intent, deps, …) → 각 스테이지 runStage(deps, spec)
   │         → circuit = deps.circuit 픽업: provider.before()+budget.check(wf) pre-gate
   │           → callClaudeTextWithUsage → provider.onSuccess()+budget.record(wf,model,usage)
   │           → open/초과/실패 → spec.fallback() (+ provider.onFailure on provider-classified throw)
   └─→ worker advisory deps(buildWorkerConsumerDeps)
         → AdvisoryProducerDeps.circuit = { workflowId, … }
         → produceAdvisory → runStage(stageDeps{…,circuit}, spec) → 동일 circuit 경로
```

## 각 단위 계약

- **`StageDeps`(`stages/run-stage.ts`)**: `circuit?: StageCircuit` 필드 추가(additive optional). 기존 필드(claude/model/timeoutMs) 불변.
- **`runStage<T>(deps, spec, circuit = deps.circuit)`**: 3rd-arg 기본값을 `deps.circuit`으로. 명시 전달 시 우선(risk-producer 회귀 0). 미설정(undefined)이면 기존 `callClaudeText` 경로(바이트 동일). 내부 로직 무변경.
- **`produceDecomposition`(`producer.ts`) / `handleDecomposeRequest`(`trigger.ts`)**: decompose용 `StageDeps`를 만들 때 `circuit`(workflowId=sessionId + 주입된 breakers)을 합류. breakers 미주입이면 circuit 생략(회귀 0). `runDecomposition` 시그니처는 **무변경**(deps에 circuit이 실려옴).
- **`produceAdvisory`(`advisory.ts`)**: `AdvisoryProducerDeps extends StageDeps` → `deps.circuit`을 그대로 받음. 내부에서 stageDeps 재구성 시 `...(deps.circuit && { circuit: deps.circuit })` 합류(runStage가 기본값으로 픽업).
- **circuit 구성 헬퍼(선택)**: `riskClassify`의 인라인 circuit 구성과 동일 형태를 공유 헬퍼로 추출 가능(`buildStageCircuit(workflowId, { budget, provider, isProviderFailure })` → `StageCircuit | undefined`)하되 CPD만 유발 안 하면 인라인도 허용.

## 배선 (server.ts / sessions.route / supervisor / worker)

- **server.ts**: 이미 `budget`(BudgetRunnerDeps)·`providerCircuit`(ProviderRunnerDeps)·`isProviderFailure` 보유(러너·riskClassify 주입). decompose 경로(handleDecomposeRequest 배선)와 worker advisory 경로(createSupervisor deps)에 동일 인스턴스를 추가 주입. **riskClassify 배선 패턴 복제**(`...(budget && { budget: budget.breaker })` 등).
- **decompose 경로**: `sessions.route.ts`/`server.ts`가 `handleDecomposeRequest`에 budget/provider/isProviderFailure를 전달(이미 riskClassify deps가 같은 진입점을 통하므로 동형 스레딩).
- **advisory 경로**: `supervisor.ts buildWorkerConsumerDeps`가 advisory deps에 circuit 구성요소를 합류 → `produceAdvisory` deps.circuit. workflowId는 WP 디스패치 컨텍스트(`handleWpDispatchSignal`)에서 가용.

## flag · 전제

- **신규 flag 없음**. 보호 활성 조건 = budget breaker(`MANAGER_BUDGET_PER_WORKFLOW_USD>0 || MANAGER_BUDGET_DAILY_USD>0`) 또는 `MANAGER_PROVIDER_CIRCUIT=true`.
- 전제: decompose 보호는 `MANAGER_DECOMPOSE_ENABLED`(경로 도달), advisory 보호는 `MANAGER_WP_ADVISORY`(경로 도달). breaker off면 어느 경로든 무보호(회귀 0).
- **migration 없음·이벤트 없음**(순수 인메모리 서킷).

## 검증 (TDD)

- **`runStage`(unit)**: ① `deps.circuit` 설정 시 circuit 경로 픽업(provider.before/budget.check 호출·callClaudeTextWithUsage·record) ② 명시 3rd-arg가 deps.circuit보다 우선 ③ 둘 다 미설정이면 기존 `callClaudeText` 경로(바이트 동일·회귀 0).
- **decompose 스테이지(unit)**: 한 스테이지(예: epics)에 circuit-bearing deps 주입 시 budget.check가 throw(예산 초과)면 `spec.fallback()` 반환(스테이지 degrade)·circuit 미주입 시 기존 동작.
- **`produceAdvisory`(unit)**: deps.circuit 전달 시 runStage가 circuit 경로·circuit open 시 빈 findings(never-throw 유지·recordFindings 미호출).
- **배선(unit)**: server/supervisor가 breaker 보유 시 decompose/advisory deps에 circuit 구성요소 합류·미보유 시 생략(회귀 0).
- **회귀**: 전체 Manager 스위트 그린(circuit off 경로 바이트 동일).

## 수용 기준

1. budget/provider breaker off → decompose·advisory 동작 오늘과 바이트 동일(회귀 0).
2. budget breaker on + decompose → 스테이지 호출 전 `check`·후 `record`로 워크플로 비용이 러너와 **통합 누적**·상한 초과 시 이후 스테이지 fallback(graceful degrade).
3. provider circuit on + 지속 장애 → decompose/advisory 스테이지가 open 시 fail-fast fallback(낭비 호출 0).
4. risk-producer의 명시 circuit 경로 회귀 0(3rd-arg 우선).
5. advisory never-throw·N3 비차단 불변 유지(circuit 실패도 게이트 무영향).

## 비범위 (후속 — 명시)

- 강등 모드 FSM(N2·트립을 운영 모드 전이로 — P5-3).
- decompose 스테이지별 차등 budget·우선순위(현재 단일 워크플로 상한).
- 벌크헤드의 decompose/advisory 적용(현재 7 에이전트 RPC만).
- ingress 소비자(StreamConsumer/SessionGateway) DLQ·서킷(별도 하드닝 트랙).
