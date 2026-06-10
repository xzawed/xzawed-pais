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
| 3 | 판정 스키마 = verify 모듈 자체 **minimal Zod, 기본값 없음** | 핸들러 outputSchema의 `.default(false)`에 기대지 않고 필드 부재=파싱 실패=**fail**(fail-closed, 불확실=실패). ⚠️배선 경로 한계: RedisAgentHandler가 outputSchema(.default)로 먼저 파싱하므로 verify가 받는 객체는 이미 default가 채워져 있다 — `success` 부재는 default false라 fail-closed 유지되나, **`failed` 부재 + `success:true`는 0으로 채워져 통과**(리뷰 #3 — 정직 문서화, outputSchema 수정은 대화형 runner 경로 영향이라 보류) |
| 4 | 검증 실패 = **완료 미발행** + `wp.verification.failed` 관측 이벤트(best-effort) → 기존 lease 백스톱(reclaim attempt++ → 상한 초과 ESCALATED) | 새 재시도 메커니즘 불요 — P1d-5 lease가 이미 바운드 재시도+사람 에스컬레이션(N5) 제공. ⚠️정정(리뷰 #7): `manager:events:{wf}` 스트림은 **소비자 미배선**(P1d-7 기존 부채)이라 이 이벤트만으로 M8을 충족하지 못한다 — 소비자/UI 배선 전까지 **사람 도달 신호는 lease 상태머신의 ESCALATED**이고 이벤트는 추적·후속(4c) 소비용 |
| 5 | tester/builder 소유 WP는 파생 체크 **없음**(결과 자체가 실행 ground truth — 이중 실행 회피). designer/security WP는 **pass-through**(4d) | 정직한 한계 문서화. fail-closed는 검증 채널이 적용되는 곳의 불확실에 적용 — 채널 부재는 별개(전략 문서 §8) |
| 6 | 파생 체크 입력 = 기존 `buildWorkerInput(wp, userContext)` 재사용. **userContext(workspaceRoot) 미영속이면 파생 체크를 돌리지 않고 즉시 fail**(리뷰 #9 정정) | 5종 스키마 union 검증 완료된 경로. ~~부재 시 '.' → 체크 실패 = fail-closed~~ 는 환경 의존으로 거짓(에이전트 cwd⊂WORKSPACE_ROOT 배포에선 '.'가 **에이전트 자신**을 빌드·테스트해 false PASS) — 경로 불명은 실행 전 fail-closed 가드로 차단 |
| 7 | flag `MANAGER_WP_VERIFY`(기본 false), 전제 `MANAGER_TASK_WORKER` | off면 워커 동작 바이트 단위 동일 — 회귀 0. 기존 flag 사다리 패턴 유지 |
| 8 | 파생 체크는 **(wpId, attempt) 격리 세션**(`verifySessionId` = `{wf}-verify-{wpId}-{attempt}`)으로 호출(리뷰 #2/#5) | RedisAgentHandler 응답 매칭은 무상관(스트림 위치+type뿐) — 워크플로 공유 세션이면 타임아웃된 이전 체크의 좀비 응답이 다음 attempt 판정으로 오귀속돼 N1 false-pass. 사설 응답 스트림 격리로 구조 차단(게이트웨이 notify는 sessionId를 페이로드로 전달하므로 임의 키 동작) |
| 9 | verifyEnabled 시 실행 전 **스테일 신호 가드**: `latestStates`가 DONE/ESCALATED면 skip(리뷰 #1/#4/#8/#11) | 검증이 WP당 처리 시간을 최대 3×120s=360s로 늘려 기본 가시성 300s를 넘을 수 있음 → false reclaim의 attempt-N 신호가 DONE된 WP를 통째로 재실행·워크스페이스 재변형하는 것을 차단. server.ts가 `MANAGER_LEASE_VISIBILITY_MS < 360s`면 기동 경고. flag off 경로는 조회 0(P4-1 보존) |

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
  - `verifySessionId(wf, wpId, attempt)` = `{wf}-verify-{wpId}-{attempt}` — 파생 체크 전용 격리 세션 키(결정 #8).
  - `verifyWp(tool, wp, result, {handlers, buildInput, userContext, workflowId, attempt})`: ① → ② 순.
    파생 체크 전 **workspaceRoot 미영속이면 즉시 fail**(결정 #6). 체크는 격리 세션으로 호출.
    체크 핸들러 부재·execute throw·판정 실패는 전부 `{ok: false, reason}`(fail-closed·never-throw).
  - `WP_VERIFICATION_FAILED = 'wp.verification.failed'` 상수 + `publishVerificationFailed`
    (envelope: stepId `wp.verification.failed:{wpId}`·attemptId=신호 attempt, payload `{wpId, attempt, reason}` —
    reason 500자 클램프, 스트림은 `defaultInconsistentStream(workflowId)` **단일 출처 재사용**(리뷰 #10 — 인라인 복제 금지)).
- **`streams/worker.ts`**:
  - `WorkerDeps.verifyEnabled?: boolean`(기본 false)·`repo`에 `latestStates` 추가(스테일 가드용).
  - `WorkerOutcome`에 `{ status: 'verification_failed'; wpId; reason }` variant·`skipped` reason에
    `stale_signal` 추가.
  - `handleWpDispatchSignal`: verifyEnabled면 **실행 전** `latestStates`로 DONE/ESCALATED skip(결정 #9).
    execute 성공 후 `verifyWp` → fail이면 `publishVerificationFailed`(try/catch — 발행 실패가 흐름을
    깨지 않음, 부재한 completion이 load-bearing 신호) 후 return. ok면 기존 `publishCompletion`.
- **`streams/supervisor.ts`**: `SupervisorConfig.wpVerify?: boolean` + **`buildWorkerConsumerDeps(deps, config)`
  순수 헬퍼**(D4 — wpVerify→verifyEnabled 스레딩을 행동 단언 가능하게 분리, 리뷰 #12) → `createSupervisor`가 사용.
- **`config.ts`**: `MANAGER_WP_VERIFY`(기본 false) 파싱. 주석에 전제(`MANAGER_TASK_WORKER`)·가시성 하한 명시.
- **`server.ts`**: `wpVerify: config.MANAGER_WP_VERIFY`를 SupervisorConfig에 전달 + 오진 방지 경고 2종
  (전제 미충족·`MANAGER_LEASE_VISIBILITY_MS < 360_000`).
- **migration 없음·신규 테이블 없음** — 이벤트는 Redis 스트림, 재시도·에스컬레이션은 기존 lease 기계 재사용.

## 5. 회귀 0 논거

- `MANAGER_WP_VERIFY` off(기본)면 `verifyWp` 미호출 — 워커 동작 P4a-2와 바이트 단위 동일.
- `MANAGER_TASK_WORKER` off면 워커 자체 미배선(기존 게이트 보존).
- 스키마·이벤트 추가는 전부 additive — 기존 소비자(`completion.ts`·lease)는 무수정.
- `wp.verification.failed`는 신규 타입 — 기존 스트림 소비자는 미지 타입 skip(BaseConsumer 패턴).

## 6. 테스트 전략

- **verify.test.ts**(순수): 도구별 체크 플랜 / tester·builder 판정(통과·실패·필드 부재 fail-closed) /
  파생 체크 fail-fast 순서·throw→fail·핸들러 부재→fail·workspaceRoot 부재→fail / 격리 세션 키 전달 /
  `verifySessionId` 결정론 / 전체 통과→ok.
- **worker.test.ts**: flag off 회귀 0(기존 테스트 무수정 통과) / on+판정 실패 → 완료 미발행+이벤트
  발행+outcome verification_failed / on+통과 → 완료 발행 / userContext 미영속 → 체크 미실행·fail /
  DONE 스테일 신호 → 에이전트 미실행 skip / 이벤트 발행 throw → outcome 유지(best-effort).
- **supervisor.test.ts**: 조립 + `buildWorkerConsumerDeps` 행동 단언(wpVerify true/false/미지정·완료 스트림 단일 출처).
- **통합 테스트**(skip-if-no-DB, 기존 execution-worker.integration.test.ts 확장): tester 실패 결과 →
  완료 미발행 → **`handleLeaseSweep`이 reclaim(attempt 1)·재신호**(백스톱 실증·sweep은 워크플로 스코프 래퍼로
  병렬 형제 테스트 간섭 차단) / 통과 → wp.completion → handleCompletion → DONE·lease released.

## 7. 알려진 한계 (정직 문서화 — 적대적 리뷰 53에이전트 반영 후)

- **빈 스위트 vacuous pass**: 테스트 0개 프로젝트에서 derived run_tests가 `failed:0`으로 통과 —
  N8 mutation 게이트(4b 후속)가 봉합. 슬라이스 1에서 `passed≥1` 강제는 테스트 미생성 단계의 모든
  WP를 에스컬레이션시켜 과도(자율 루프 무력화).
- **게이트 명령이 산출물에서 파생됨(리뷰 #6·N6)**: builder/tester의 자동 감지 명령은 developer가 쓴
  `package.json scripts`·`Makefile`에서 결정된다(예: `scripts.test: "echo 1 passed"`가 exit 0이면 통과) —
  검증 명령 선택권이 검증 대상 작성자에게 있는 독립성 위반. builder/tester 수정은 본 슬라이스
  범위(Manager 단독) 밖 — **4b-2에서 명령 권위를 사람 오라클(step-def)로 이전**해 해소.
- **lease 가시성 상호작용(리뷰 #1/#4/#8/#11)**: 검증은 WP당 처리 시간을 최대 3×120s=360s로 늘려 기본
  가시성 300s를 초과 가능 — 건강한 검증 중 false reclaim 발생. 본 슬라이스 완화: ①server.ts 기동 경고
  (`MANAGER_WP_VERIFY && visibilityMs < 360s`) ②워커 스테일 신호 가드(DONE/ESCALATED skip — 중복
  재실행·DONE 후 워크스페이스 재변형 차단). 근본 해소(lease heartbeat 연장·completion attempt CAS)는
  후속 — stale 완료가 reclaim된 lease를 release하는 경합 자체는 잔존하나, 검증 통과 산출물의 DONE
  전이라 의미상 유효하고 후속 신호는 가드가 흡수.
- **RPC 응답 무상관(리뷰 #2/#5)**: RedisAgentHandler는 응답을 (스트림 위치, type)만으로 매칭 — 본
  슬라이스는 파생 체크를 (wpId, attempt) 격리 세션으로 호출해 attempt 간 좀비 응답 교차 귀속을 구조
  차단. **primary 실행(워크플로 공유 세션)의 기존 노출은 P4-1 그대로**(trivial 판정 시절부터 존재) —
  요청-응답 상관키(messageId 에코)는 에이전트 계약 변경이라 후속.
- **판정 스키마의 default 한계(리뷰 #3)**: §2 결정 #3 참고 — `failed` 부재+`success:true`는 배선
  경로에서 0으로 채워져 통과. tester가 항상 두 필드를 산출하므로 실위험은 낮으나 문서화.
- **비정보 재시도**: reclaim 재실행 입력에 검증 실패 사유 미포함 — 같은 입력 재실행. 4c informed
  rework에서 해소.
- **검증 비용**: develop_code WP당 에이전트 호출 +2회(빌드·테스트). 타임아웃은 RedisAgentHandler
  하드코딩 기본 120s — 핸들러 팩토리가 timeoutMs를 받지 않아 운영 조정 수단이 없다(`CLAUDE_TIMEOUT_MS`는
  분해 LLM 전용·무관, 리뷰 #8 드리프트 정정).
- **오라클 비연동**: 사람 승인 GWT 시나리오는 아직 검증에 미사용(DoR 게이트에만 사용) — step-def
  컴파일(4b-2)에서 conformance 채널의 스펙 유래 케이스로 연결.
- **관측 이벤트 best-effort·무소비(리뷰 #7)**: `wp.verification.failed`는 발행 실패 시 유실 가능하고,
  발행돼도 `manager:events:{wf}`는 소비자 미배선(기존 부채) — 사람 도달 신호는 ESCALATED(lease)뿐.
  사람 접점 UI 슬라이스에서 에스컬레이션·검증 실패를 도달 채널에 연결. completion 부재가 load-bearing이라
  reclaim/escalate는 보장(상태 무결성 유지).
