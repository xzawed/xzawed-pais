# P4b-1 — 실행 워커 검증 게이트 설계 (correctness 채널 골격)

날짜: 2026-06-10
선행: P4a-2 워크스페이스 컨텍스트 주입(#271, [2026-06-10-p4a-2-workspace-context-injection-design.md](2026-06-10-p4a-2-workspace-context-injection-design.md) §6 "검증 trivial 유지")
범위: xzawedManager 단독 (xzawedShared·에이전트 서비스 무수정)
senario 근거: `VERIFICATION_ADVERSARIAL_STRATEGY.md` §5(fail-closed)·§7(conformance 채널), ROADMAP Phase 4(N1·N5), `ORACLE_SCHEMA.md`(step-def 컴파일은 후속)

## 1. 목표 / 비범위

**목표**: P4-1 워커의 trivial 완료 판정(무예외=성공)을 **실행 ground truth 기반 fail-closed 검증**으로
교체한다(N1: "테스트 통과"는 실제 실행 결과로만 성립). tester가 `success:false`를 반환해도 무예외면
wp.completion→DONE이 되는 현재의 false-pass 구멍을 봉합하고, developer WP는 같은 워크스페이스에
빌드·테스트를 실 재실행해 검증한다.

**비범위** (후속 슬라이스):
- 오라클 시나리오 step-def 컴파일(human_approved GWT → 실행 테스트, N1) — 4b-2.
- advisory 큐·impact 회귀 채널·mutation 게이트(N8·θ_risk 캘리브레이션) — 4b-3.
- 검증 실패 사유를 재실행 입력에 주입하는 informed rework·attribution_counters 진동 차단 — 4c.
- designer/security 산출물 검증(실행 가능 ground truth 부재) — 4d.

## 2. 핵심 결정

| # | 결정 | 근거 |
|---|------|------|
| 1 | 검증 위치 = **워커 내장**(완료 발행 전), 별도 소비자 아님 | 골격 단계 과설계 회피. 검증 코어는 순수 함수라 추후 VerifierConsumer 구조(B안) 이전 가능 |
| 2 | 2중 판정: ①**결과-근거**(tester `success && failed===0`·builder `success`) ②**파생 체크**(develop_code WP → build_project→run_tests 순 실 재실행, fail-fast) | ①은 추가 실행 0으로 오늘의 구멍 봉합, ②는 ROADMAP P4 "실행 ground truth 하니스(TC·빌드)"의 최소 구현. 검증은 LLM 선언이 아닌 실 spawn 결과(N1) |
| 3 | 판정 스키마 = verify 모듈 자체 **minimal Zod, 기본값 없음** | 핸들러 outputSchema의 `.default(false)`에 기대지 않고 필드 부재=파싱 실패=**fail**(fail-closed, 불확실=실패) |
| 4 | 검증 실패 = **완료 미발행** + `wp.verification.failed` 관측 이벤트(best-effort) → 기존 lease 백스톱(reclaim attempt++ → 상한 초과 ESCALATED) | 새 재시도 메커니즘 불요 — P1d-5 lease가 이미 바운드 재시도+사람 에스컬레이션(N5) 제공. 이벤트는 `manager:events:{wf}`(decomposition.inconsistent 패턴)로 발행해 무음 아님(M8) |
| 5 | tester/builder 소유 WP는 파생 체크 **없음**(결과 자체가 실행 ground truth — 이중 실행 회피). designer/security WP는 **pass-through**(4d) | 정직한 한계 문서화. fail-closed는 검증 채널이 적용되는 곳의 불확실에 적용 — 채널 부재는 별개(전략 문서 §8) |
| 6 | 파생 체크 입력 = 기존 `buildWorkerInput(wp, userContext)` 재사용 | 5종 스키마 union 검증 완료된 경로. userContext 부재 시 projectPath `'.'` → 체크 실패 → fail-closed(flag는 opt-in — 컨텍스트 흐름 갖춘 운영에서 켬) |
| 7 | flag `MANAGER_WP_VERIFY`(기본 false), 전제 `MANAGER_TASK_WORKER` | off면 워커 동작 바이트 단위 동일 — 회귀 0. 기존 flag 사다리 패턴 유지 |

## 3. 데이터 흐름

```
dispatch_signal → handler.execute(input, wf, uc)        # 기존(P4-1/4a-2)
  → [신규] MANAGER_WP_VERIFY on이면 verifyWp:
      ① judgePrimaryResult(tool, result)                 # run_tests/build_project WP
      ② planVerificationChecks(tool)                     # develop_code → [build, test]
         → 체크별 handlers[checkTool].execute(buildWorkerInput(wp, uc), wf, uc)
         → 각 결과를 minimal 스키마로 판정, 첫 실패에서 중단(fail-fast)
  → verdict ok   → wp.completion 발행(기존) → DONE → 후행 재디스패치
  → verdict fail → 완료 미발행 + wp.verification.failed{wpId, attempt, reason}
                   → lease 만료 → reclaim attempt++ → 상한 → ESCALATED(사람)
```

## 4. 변경 상세

- **신규 `streams/verify.ts`**:
  - `VerificationVerdict = { ok: true } | { ok: false; reason: string }`.
  - `judgePrimaryResult(tool, result)`: run_tests → `{success, failed}` minimal 파싱 후
    `success === true && failed === 0`; build_project → `{success}` 파싱 후 `success === true`;
    그 외 도구 → `{ok: true}`(결과-근거 채널 비적용). 파싱 실패는 `{ok: false}`.
  - `planVerificationChecks(tool)`: `develop_code` → `['build_project', 'run_tests']`(빌드 먼저 — fail-fast),
    그 외 → `[]`.
  - `verifyWp({wp, tool, result, handlers, userContext, buildInput, workflowId})`: ① → ② 순.
    체크 핸들러 부재·execute throw·판정 실패는 전부 `{ok: false, reason}`(fail-closed).
  - `WP_VERIFICATION_FAILED = 'wp.verification.failed'` 상수 + `publishVerificationFailed`
    (envelope: stepId `wp.verification.failed:{wpId}`·attemptId=신호 attempt, payload `{wpId, attempt, reason}`,
    스트림 `manager:events:{workflowId}`).
- **`streams/worker.ts`**:
  - `WorkerDeps.verifyEnabled?: boolean`(기본 false).
  - `WorkerOutcome`에 `{ status: 'verification_failed'; wpId: string; reason: string }` variant 추가.
  - `handleWpDispatchSignal`: execute 성공 후 verifyEnabled면 `verifyWp` → fail이면
    `publishVerificationFailed`(try/catch — 발행 실패가 흐름을 깨지 않음, 부재한 completion이
    load-bearing 신호) 후 return. ok면 기존 `publishCompletion`.
- **`streams/supervisor.ts`**: `SupervisorConfig.wpVerify?: boolean` → `createSupervisor`가
  WorkerDeps.verifyEnabled로 스레딩.
- **`config.ts`**: `MANAGER_WP_VERIFY`(기본 false) 파싱. 주석에 전제(`MANAGER_TASK_WORKER`) 명시.
- **`server.ts`**: `wpVerify: config.MANAGER_WP_VERIFY`를 SupervisorConfig에 전달.
- **migration 없음·신규 테이블 없음** — 이벤트는 Redis 스트림, 재시도·에스컬레이션은 기존 lease 기계 재사용.

## 5. 회귀 0 논거

- `MANAGER_WP_VERIFY` off(기본)면 `verifyWp` 미호출 — 워커 동작 P4a-2와 바이트 단위 동일.
- `MANAGER_TASK_WORKER` off면 워커 자체 미배선(기존 게이트 보존).
- 스키마·이벤트 추가는 전부 additive — 기존 소비자(`completion.ts`·lease)는 무수정.
- `wp.verification.failed`는 신규 타입 — 기존 스트림 소비자는 미지 타입 skip(BaseConsumer 패턴).

## 6. 테스트 전략

- **verify.test.ts**(순수): 도구별 체크 플랜 / tester·builder 판정(통과·실패·필드 부재 fail-closed) /
  파생 체크 fail-fast 순서·throw→fail·핸들러 부재→fail / 전체 통과→ok.
- **worker.test.ts**: flag off 회귀 0(기존 테스트 무수정 통과) / on+판정 실패 → 완료 미발행+이벤트
  발행+outcome verification_failed / on+통과 → 완료 발행 / 이벤트 발행 throw → outcome 유지(best-effort).
- **supervisor.test.ts**: wpVerify 스레딩.
- **통합 테스트**(skip-if-no-DB, 기존 execution-worker.integration.test.ts 확장): tester 실패 결과 →
  DONE 미전이·lease active 유지 / 통과 → DONE 전이.

## 7. 알려진 한계 (정직 문서화)

- **빈 스위트 vacuous pass**: 테스트 0개 프로젝트에서 derived run_tests가 `failed:0`으로 통과 —
  N8 mutation 게이트(4b 후속)가 봉합. 슬라이스 1에서 `passed≥1` 강제는 테스트 미생성 단계의 모든
  WP를 에스컬레이션시켜 과도(자율 루프 무력화).
- **비정보 재시도**: reclaim 재실행 입력에 검증 실패 사유 미포함 — 같은 입력 재실행. 4c informed
  rework에서 해소.
- **검증 비용**: develop_code WP당 에이전트 호출 +2회(빌드·테스트). 타임아웃은 RedisAgentHandler
  120s(`CLAUDE_TIMEOUT_MS`) 재사용.
- **오라클 비연동**: 사람 승인 GWT 시나리오는 아직 검증에 미사용(DoR 게이트에만 사용) — step-def
  컴파일(4b-2)에서 conformance 채널의 스펙 유래 케이스로 연결.
- **관측 이벤트 best-effort**: `wp.verification.failed` 발행 실패 시 사유 유실 가능 — 단 completion
  부재가 load-bearing이라 reclaim/escalate는 보장(상태 무결성 유지).
