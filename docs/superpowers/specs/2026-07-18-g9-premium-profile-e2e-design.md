# G9 — 프리미엄(autonomous) 프로필 CI E2E 설계

- 상태: 설계 승인 대기(사용자 리뷰)
- 날짜: 2026-07-18
- 관련: Tier-1 G9(joint verification 로드맵, [docs/analysis/claude-grok-premium-verification.md](../../analysis/claude-grok-premium-verification.md) §3 G9)
- 선행: G1 PAIS_PROFILE(#444~#448)·G8 lease auto-tune(#452)

## 목적

`PAIS_PROFILE=autonomous`(프리미엄) 프로필이 **build → WP 디스패치 → 검증(verify) → 완료** 아크를 실제로 폐합한다는 **내구성 있는 품질 주장 근거**를 CI에 남긴다.

이 코드베이스의 역사적·구조적 리스크는 정확히 **"미배선"**이다 — 플래그는 존재하나 런타임 소비자가 휴면(`MANAGER_TASK_WORKER` 미설정 시 DISPATCHED에서 무음 stall, server.ts:305-308). 따라서 G9는 소비자 배선이 실제로 아크를 닫는지를 증명해야 한다.

## 확정된 사실 (조사 근거)

- **전체 아크를 켜는 플래그**: `PROFILES.autonomous`(config.ts:293-303)가 `TASK_MANAGER_ENABLED·MANAGER_DECOMPOSE_ENABLED·MANAGER_TASK_WORKER·MANAGER_WP_VERIFY`를 켬. **`MANAGER_RELEASE_GATE`는 프리셋에 없음** → 순수 프로필 아크 종단 신호는 **"모든 WP DONE"**.
- **"완료"의 관측 신호**: `wp_state_log.to_state='DONE'`(reason='completed') + `wp_leases.status='released'`. 기존 execution-worker.integration.test.ts:78-79,189-190이 `repo.latestStates(wf).get(id).toState==='DONE'`로 단언.
- **LLM 무호출 경로**: 순수 `MANAGER_WP_VERIFY` 경로는 LLM을 호출하지 않는다 — `judgePrimaryResult` 계약(verify.ts:56-77)만: `run_tests {success:true,failed:0,passed>0}`·`build_project {success:true}`.
- **주입 seam**: `handleWpDispatchSignal`(worker.ts)은 `WorkerDeps{repo,handlers,publish,verifyEnabled}`를 파라미터로 받음 — fake `AgentExecutor{execute}`(worker.ts:28-30) 주입 가능. `createSupervisor`(supervisor.ts:395)는 handlers·publish를 파라미터로 받고 **clean `stop()`**(supervisor.ts:135-146, 전 소비자 stop 위임)을 노출 → buildServer의 하드코딩 `new Anthropic()`(server.ts:88) 우회 가능.
- **runMigrations**(pool.ts) 001~016 전부 `IF NOT EXISTS`+advisory lock → 반복 적용 안전.

## 종단 단언 (확정)

**모든 WP DONE**(`wp_state_log` 전부 `DONE` + lease `released`). `MANAGER_RELEASE_GATE`는 프로필에 없으므로 아크 종단에 섞지 않는다(프로필 정직성 보존). release gate 검증은 별도 테스트 소관.

## 결정론 사각 (fail-closed 주의)

- fake 핸들러는 **반드시** `judgePrimaryResult` 계약을 만족해야 게이트가 열린다. 불만족 시 게이트가 **조용히 fail-closed** → DONE에 영원히 미도달. 테스트에서 이 계약을 명시 상수로 고정한다.
- `wp.risk`는 기본 **MEDIUM** 유지 → mutation θ-게이트(HIGH-only)가 발화하지 않아 결정론 유지. risk 승격 체인(classify→approve→routing)은 이 E2E 범위 밖.

## 접근 — 2 슬라이스, 2 PR (클린-CI mandate 보존)

### Slice A — In-process 아크 E2E (PR #1, 필수 green 베이스라인)

- **범위**: 실 PG(TEST_DATABASE_URL 게이트) + Redis publish는 capture. Redis 소비자·Supervisor 조립 없음.
- **구동**: 다중 WP 그래프(develop_code WP `a` → 의존 WP `b`)를 `repo.upsertGraph`로 시드 → `store.recordDispatch(a)` → `handleWpDispatchSignal(a, {verifyEnabled:true, handlers:{develop_code, run_tests, build_project}})` → verifyWp가 fake build/test 핸들러로 통과 → wp.completion capture → `handleCompletion(a)` → DONE + `b` unblock → dispatch/complete `b` → 반복 → **모든 WP DONE 단언**.
- **결정론**: 최상 — LLM 0·네트워크 0·비동기 소비자 루프 0. **제로 flake.**
- **CI**: 기존 turborepo pg 잡에서 그대로 실행(신규 잡 0). `*.integration.test.ts` 네이밍 → TEST_DATABASE_URL 게이트로 CI에서만 활성.
- **증명하는 것**: 프로필 verify 게이트 하에서 아크 **로직**이 end-to-end로 닫힘. **증명 못 하는 것**: 실 소비자 배선(그래서 Slice C 필요).
- **노력**: S(execution-worker.integration.test.ts가 거의 그대로 토대).

### Slice C — 실 Redis 소비자 배선 증명 (PR #2, 배선 주장 근거)

- **범위**: 실 PG + 실 Redis. `createSupervisor`를 테스트에서 직접 호출(buildServer 우회)해 DecompositionConsumer+WorkerConsumer+CompletionConsumer+LeaseSweeper를 실 소비자 루프로 조립.
- **구동**: decompose LLM 완전 생략 — `decomposition.emitted`를 소비자 구독 스트림에 직접 발행해 시드. fake AgentExecutor 핸들러. 완료까지 `repo.latestStates` **바운드 폴링**(예 30s·fake 핸들러 즉시 반환이라 빠르게 수렴) → 모든 DONE 단언.
- **teardown**: `supervisor.stop()`(전 소비자 stop) → `closePool()`. stop() 표면이 이미 존재해 리스크 완화됨.
- **CI**: 신규 `manager-redis-integration` 잡(기존 redis-integration ci.yml services/env 블록 본뜸·Manager 스코프·xzawedShared 선빌드). 실 LLM 무호출 → `ANTHROPIC_API_KEY`·`SERVICE_JWT_SECRET`(≥32)는 **더미 값** 주입(config 로드 통과 목적).
- **필수화**: 초기에 teardown 클린 여부를 스파이크로 확인. 클린이면 `all-checks-pass` 게이트에 추가(**needs 배열 ci.yml:780 + OR 체인 785 두 곳 모두** — 한쪽만 넣으면 사각). teardown flake가 통제 불가면 non-required/nightly로 강등(Slice A가 이미 green 가드).
- **노력**: M.

## 시퀀싱

1. **PR #1 (Slice A)** — 항상 green·즉시 머지 가능. 아크 로직 회귀 가드 확보.
2. **PR #2 (Slice C)** — A 머지 후 분기. teardown 스파이크 → 필수화 or 강등 판정.

각 PR은 독립적으로 CI green(브랜치 미엉킴 mandate).

## 범위 밖 (YAGNI)

- buildServer LLM-DI 리팩터(server.ts:88 하드코딩 개방) — Slice C가 createSupervisor 우회로 불필요.
- decompose 4-스테이지 LLM 커버리지 — 유닛(epics.test.ts 등)이 이미 커버. E2E는 `decomposition.emitted` 시드로 배선만 증명.
- release_gates/gate.passed 단언 — 프로필에 플래그 없음(별도 테스트).
- risk 승격(mutation 발화) — 결정론 위해 MEDIUM 고정.
