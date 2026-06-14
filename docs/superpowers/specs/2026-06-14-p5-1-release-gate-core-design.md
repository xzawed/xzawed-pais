# P5-1 릴리스 게이트 코어 — 설계

> 날짜: 2026-06-14 · Phase 5 첫 슬라이스 · 원천 사양: `docs/senario/xzawedPAIS_handoff_spec.md` §10·`docs/senario/WORKFLOW.md` A절·`docs/senario/OPERATIONS_DECISIONS.md` §1
> 불변식: M1(fail-closed 릴리스 게이트)·N1(실행 ground truth)·N8(빈 껍데기 스위트 금지)·M5/M7(트랜잭셔널 아웃박스·인과)·M8(무음 통과 금지)

## 1. 목표

P4 검증 채널이 산출하는 **per-WP 판정을 promote 직전에 hard-AND로 집계**하는 최소 릴리스 게이트(M1)를 도입한다. 현재 P4 채널(conformance·impact·property·mutation·security·advisory)은 워커 완료 시점의 WP별 검증이지 릴리스/promotion 게이트가 아니다 — 무엇도 "정상 증명된 것만 나간다"를 강제하지 않는다. P5-1이 그 집계점을 만든다.

핵심 설계 원칙: **fail-closed-on-absence.** 게이트는 "증명된 통과"와 "공허한 통과(채널 skip·검증 증거 부재)"를 구별하고, 후자를 **CLOSED**로 처리한다. 이로써 사양 §10의 "누락·불확실·강등이면 닫힘 유지(M1)"를 구조적으로 충족하며, design_ui/security_audit WP의 빈-plan auto-pass가 fail-open을 fail-closed로 위장하는 트랩을 **F5/E2 없이도** 차단한다.

## 2. 비목표 (범위 밖 · 후속 슬라이스)

- **P5-2**: `gate.passed`를 deploy_project 실행의 hard 전제로 연동(A3) · `gate.blocked`를 사람 사인오프 DecisionRequest로 연결(A3/P6).
- **P5-3**: NORMAL/DEGRADED/SAFE 강등 FSM(N2) — 서킷 트립 신호를 모드로 소비, DEGRADED HIGH-risk는 `gate.blocked_degraded`.
- **P5-4**: saga + 보상 · canary→staged 점진 전개 · SLO/에러율 자동 롤백 · M7 promotion 감사 확장.
- **전체 워크플로 FSM**: WORKFLOW.md A절의 INTAKE→…→COMPLETED 영속 상태머신·RELEASING/MONITORING 상태는 미구축(최소 게이트 투영만).
- **F5**(오라클 드래프트 생성기)·**E2**(design_ui 검증 채널) — 독립 후속. P5-1은 이들 없이 동작하며, 착륙할수록 provable WP가 늘어 게이트가 덜 닫힌다.

## 3. 배경 — 현재 상태와 트랩

- **현재 검증 흐름**(P4b/P4): 워커가 WP 실행 → `verifyWp`가 채널을 hard-AND → 통과면 `wp.completion` 발행→DONE, 실패면 완료 미발행→lease 백스톱 reclaim→escalate. 채널 판정은 **워커 시점의 per-WP** 검증이며, **채널별 결과는 영속되지 않는다**(verdict는 휘발, 성공 시 wp.completion만, 실패 시 best-effort wp.verification.failed).
- **트랩(검증된 사실)**: `verify.ts`의 채널 함수(`runConformanceCheck`·`runImpactCheck`·`runPropertyCheck`·`runMutationCheck`·`runSecurityCheck`)는 **skip(오라클 부재·flag off 등)도 통과도 모두 `{ok:true}`**를 반환한다. 따라서 오라클이 비어 dormant인 채널은 "skip→ok"로 보이고, design_ui/security_audit WP는 빈 plan으로 auto-pass(`verifyWp('design_ui') === {ok:true}`)한다. 이 상태에서 순진하게 게이트를 hard-AND하면 "전부 ok"가 되어 **fail-open이 fail-closed로 위장**된다.
- **해법**: 채널 함수가 `passed`와 `skipped`를 **구별**하게 하고, 게이트가 `skipped`/증거 부재를 **un-proven → CLOSED**로 본다.

## 4. 아키텍처 (접근 1)

증거 프로젝션 + 순수 게이트 평가기 + 완료-구동 트리거. 기존 패턴(트랜잭셔널 아웃박스 프로젝션·순수 코어·이벤트 구동 핸들러)을 그대로 따른다.

```
워커 verifyWp(ok) → [P5-1a] wp.verified(채널 분해) 영속 → wp.completion → DONE
   → handleCompletion: all-WP-done? → [P5-1b] evaluateReleaseGate(증거 집계·정책)
   → release_gates 영속 + gate.passed | gate.blocked emit (OutboxRelay 경유)
```

`MANAGER_RELEASE_GATE`(기본 false) flag 뒤로 가역. off면 증거 미적재·게이트 미평가 — 워커/완료 경로 바이트 회귀 0.

## 5. P5-1a — 검증 증거 모델

### 5.1 ChannelOutcome
채널 함수 반환을 verdict-only에서 outcome 동반으로 보강한다.

```ts
type ChannelName = 'tc' | 'conformance' | 'impact' | 'property' | 'mutation' | 'security'
type ChannelOutcomeKind = 'passed' | 'skipped'
interface ChannelOutcome { channel: ChannelName; outcome: ChannelOutcomeKind }
```

- `passed`: 채널이 실 실행되어 통과(증거 있음).
- `skipped`: 채널이 활성이나 베이스라인 부재(오라클·golden·invariant 없음)·risk 미달 등으로 실행 못 함.
- (구현 정제) `not_applicable`은 채널 outcome이 아니라 **§6.3 게이트의 WP-수준 판정**(검증불가 도구 유형)으로 처리 — develop_code의 `runChannelChecks`에서만 채널이 돌므로 채널 outcome은 passed/skipped 둘뿐.
- `failed`는 **게이트가 보는 증거에 나타나지 않는다** — verifyWp hard-AND에서 fail이면 완료 미발행→DONE 미도달→게이트 미집계. 즉 DONE WP의 모든 채널 outcome ∈ {passed, skipped}.

### 5.2 verify.ts 보강 (additive·회귀 0) — recon 후 구현 정제
`VerificationVerdict`(`{ok:true}|{ok:false,reason}`)는 verify.ts 내 ~10개 반환 지점에서 쓰여 반환 타입 변경이 침습적(916 테스트 영향). 대신 **`VerifyDeps`에 optional `recordOutcome?: (channel, outcome) => void` 콜백을 추가**(additive)하고 각 채널이 skip/pass 지점에서 호출한다:
- `runAuthoredCheck`(conformance/impact/property 공유): `AuthoredCheckConfig`에 `channel` 추가 → skip 2지점(`!enabled||!oracleStore`, `baseline==null`)은 `'skipped'`, `executeAuthoredTest` 성공은 `'passed'`.
- `runMutationCheck`: skip 2지점(`!enabled`, risk<floor) `'skipped'`, 성공 `'passed'`.
- `runSecurityCheck`: skip(`!enabled`) `'skipped'`, blocking 없음 `'passed'`.
- `verifyWp`: develop_code 파생 체크(build+test) 통과 후 `tc` `'passed'` 기록(P4b-1·`passed>0` floor 계승).
- **verdict 결정·hard-AND·단락·never-throw 불변.** FAIL은 WP가 DONE 미도달이라 evidence 무의미. 게이트 flag off면 워커가 `recordOutcome` 미주입→`?.` no-op→바이트 회귀 0.
- `ChannelOutcomeKind = 'passed' | 'skipped'`만. 채널은 develop_code의 `runChannelChecks`에서만 도므로 `not_applicable`은 채널 outcome이 아니라 §6.3 게이트의 WP-수준 판정(검증불가 도구)에서 처리.

### 5.3 증거 영속
- 워커가 `verifyEnabled` 통과(DONE 발행) 직전, `releaseGateEnabled`이면 `EvidenceStore.recordEvidence(wf, wpId, attempt, channelOutcomes)` 호출.
- **migration 014 `wp_verification_results`**(프로젝션·아래 §6.4 `release_gates`와 동일 마이그레이션 파일에서 함께 생성): `(workflow_id, wp_id, attempt, channel)` PK·`outcome`·`detail`·`event_id`·`occurred_at`. 멱등 ON CONFLICT DO NOTHING(M6).
- `ReleaseGateRepo.recordEvidence`: `wp_verification_results` + `manager_events`(`wp.verified` 진실원천) + `manager_outbox`를 **단일 tx**(OracleRepo/AdvisoryRepo 패턴·`makeEnvelope`·safeRollback). **멱등 모델(구현 정제·advisory/risk/decision과 동일)**: 투영 테이블만 `(wf,wpId,attempt,channel)` ON CONFLICT DO NOTHING으로 dedup(M6). manager_events는 호출당 fresh `event_id`(events엔 unique 없음·idempotency_key는 소비자 dedup용) — `wp.verified` 소비자는 P5-1에 없어 영향 0. 정상 경로는 워커가 attempt당 1회 호출(BaseConsumer dispatch dedup이 재전달 상위 차단).
- best-effort: 증거 적재 실패가 완료를 막지 않는다(never-throw). 단 증거 없는 WP는 게이트에서 자동 un-proven → CLOSED(무음 통과 금지 M8 — 적재 실패가 통과로 둔갑하지 않음).

## 6. P5-1b — 릴리스 게이트

### 6.1 all-WP-done 감지
- `handleCompletion`이 `recordCompletion`+재디스패치 후, `releaseGateEnabled`이면 `latestStates`로 graph_dag 전 노드 상태를 파생해 **모두 DONE**(DRAFTED/DISPATCHED/ESCALATED 잔존 0)인지 확인. 미완이면 noop(게이트 미평가).
- ESCALATED WP가 있으면 all-done 불성립 → 게이트 미발화(사람 결정/재진입 선행). fix_reverify로 재진입→재완료→다시 all-done 시 재평가. **재게이트 정합(구현 정제)**: `evidenceForWorkflow`는 `(wp_id,channel)`별 **최신 attempt만** 조회(`DISTINCT ON ... ORDER BY attempt DESC`)하므로, 재작업(attempt++)으로 채널이 skip→passed가 되면 stale skip이 더는 게이트를 막지 않는다.

### 6.2 순수 게이트 평가기
```ts
function evaluateReleaseGate(
  workPackages: WorkPackage[],
  evidenceByWp: Map<wpId, ChannelOutcome[]>,
  policy: ReleaseGatePolicy,
): ReleaseGateResult
// ReleaseGateResult = { status: 'passed' | 'blocked', perWp: WpGateView[], blockingReasons: string[] }
// WpGateView = { wpId, proven: boolean, unverifiable: boolean, missingChannels: ChannelName[] }
//   unverifiable=true ⇒ 검증 증거 행 0(비-develop_code/미영속·design_ui 등)·categorically un-proven
//   (구현 정제) requiredChannels는 evidence 행이 인코딩하므로 별도 필드 불요(§6.2 하단)
```
- LLM/IO 0·결정론(다른 순수 코어 패턴). 입력 WP를 id 사전순 안정 정렬.
- **evidence가 required 집합을 인코딩**(recon 정제): develop_code WP만 evidence 행을 남기며, 각 행은 enabled 채널의 `passed`/`skipped`(+ 항상 `tc:passed`). 따라서 `evidenceByWp.get(wpId)`이 비어있으면(=비-develop_code 또는 미영속) `unverifiable:true`→un-proven. 비어있지 않으면 `proven = (tc:passed 행 존재) AND (모든 행 outcome === 'passed', 즉 'skipped' 행 0)`. `missingChannels` = outcome이 'skipped'인 채널 + tc 부재면 'tc'. `ReleaseGatePolicy`는 향후 확장 여지(예: 특정 채널 강제)로 두되 P5-1 기본 규칙은 위와 같다.

### 6.3 required-channel 정책 (핵심)
- **검증 가능 도구 유형 + required(wp)**:
  - `develop_code` → TC floor(파생 `run_tests` `passed>0`·`MANAGER_WP_VERIFY` 전제) ∪ 활성화된(flag on) correctness 채널(conformance/security/impact/property/mutation). required 비어있지 않음(최소 TC).
  - `run_tests`/`build_project` → 자기 primary 결과(channel `tc`·P4b-1 judgePrimaryResult). required = {tc}.
  - **그 외(design_ui·security_audit 등 verify.ts 빈-plan WP)** → 검증 계획 없음 → **required 미정의(검증 불가 도구 유형)**.
  - 정책은 `ReleaseGatePolicy`(활성 채널 집합·검증 가능 도구 유형 맵)로 주입 — server.ts가 flag에서 파생.
- **proven(wp) iff** ① wp가 **검증 가능 도구 유형**(required 비어있지 않음)이고 ② **모든 required 채널 outcome === `passed`**. 하나라도 `skipped`/증거 부재면 un-proven.
  - ⚠️ **공허한 true 금지**: required가 비어있는(검증 불가) WP는 "모든 required 통과"가 vacuous하게 참이 되어선 안 된다 — 명시적으로 **categorically un-proven**으로 처리한다(이 규칙이 없으면 design_ui가 빈 required로 proven이 되어 fail-open 트랩이 재발한다).
  - `not_applicable` 채널은 required에도 missing에도 계수하지 않는다(무시). 단 그것이 WP의 required를 비우진 못한다(검증 가능 도구 유형의 floor는 항상 존재).
- **correctness 검증 없는 WP**(design_ui·security_audit): required 미정의 → categorically un-proven → **CLOSED**. E2 착륙 전까지 이런 WP를 포함한 워크플로는 게이트에서 막히고, 사람 사인오프(P5-2/P6)가 유일한 통로. ← 트랩-proof 핵심.
- **gate = 전 WP proven → `passed`; 아니면 `blocked`**(perWp에 막은 WP·missingChannels·`unverifiable:true` 첨부 → M7 감사·후속 사인오프 UI 입력).
- 의미: 초기엔 게이트가 자주 닫힌다(정직한 fail-closed). F5·E2가 착륙할수록 provable WP가 늘어 통과 가능해진다. flag off라 회귀 0.

### 6.4 게이트 결과 영속
- `ReleaseGateStore.recordGate(wf, result, doneSetVersion)`: `release_gates` 프로젝션 + `manager_events`(`gate.passed`|`gate.blocked` 진실원천·perWp payload) + `manager_outbox` **단일 tx**.
- **migration 014 `release_gates`**: `(workflow_id, gate_version)` PK·`status`·`per_wp` JSONB·`blocking_reasons` JSONB·`event_id`·`occurred_at`.
- **멱등키 = `{wf}:gate:{doneSetVersion}`**. `doneSetVersion` = 완료 WP 집합의 결정론 해시(wpId+attempt 정렬). fix_reverify 재작업 후 done-set이 바뀌면 새 게이트 결과 산출(재게이트), 동일 done-set 재진입은 ON CONFLICT로 무한 재emit 방지.

## 7. 배선·flag

- `MANAGER_RELEASE_GATE`(기본 false). **전제**: `TASK_MANAGER_ENABLED`+`MANAGER_WP_VERIFY`+`DATABASE_URL`. 오진 방지 경고: flag on인데 전제 미충족이면 server.ts가 `app.log.warn`.
- Supervisor가 `evidenceStore`+`releaseGateStore`+`releaseGatePolicy`를 조건부로 워커/완료 핸들러에 주입(`buildWorkerConsumerDeps` 확장·행동 단언으로 무음 우회 방지).
- OutboxRelay 기동 조건에 `MANAGER_RELEASE_GATE` 추가(`wp.verified`·`gate.*` 아웃박스→Redis 발행).
- off면 증거 미적재·게이트 미평가·새 이벤트 0 — 회귀 0.

## 8. fail-closed 의미·에러 처리

- 게이트 평가·증거 적재 **모두 never-throw**. 불확실(증거 파싱 실패·집계 예외) = `blocked`(CLOSED).
- 증거 적재 실패는 완료를 막지 않되, 증거 없는 WP는 게이트에서 자동 un-proven → CLOSED.
- 무음 통과 금지(M8): `blocked`는 영속+이벤트로 관측 가능(후속 사인오프 입력). 어떤 경로도 증거 없이 `passed`가 되지 않는다.

## 9. 테스트

- **순수 `evaluateReleaseGate` 단위**: ①전 WP proven→passed ②1 채널 skip→blocked ③증거 부재 WP→blocked ④design_ui 포함(채널 0)→blocked ⑤required=활성 채널 파생 정확성 ⑥not_applicable 제외 ⑦mixed.
- **증거 영속 통합(skip-if-no-DB·pg)**: `wp.verified` 단일 tx·멱등 ON CONFLICT·이벤트+프로젝션 정합.
- **게이트 영속/멱등 통합**: 동일 done-set 재평가→ON CONFLICT 무재emit·재작업 done-set 변경→새 gate_version.
- **all-done 트리거**: ESCALATED 잔존→noop·전 DONE→게이트 1회·재진입 후 재게이트.
- **배선 단위**: `buildWorkerConsumerDeps`가 flag/전제에 따라 evidence/gate store 주입·미주입 시 회귀 0(행동 단언).

## 10. 불변식 매핑

| 불변식 | 충족 방식 |
|---|---|
| M1 | 게이트 = 전 WP proven hard-AND·증거 부재/skip → CLOSED |
| N1 | proven은 실행된 채널 결과(passed)만·TC는 파생 run_tests 실행 |
| N8 | TC floor에 `passed>0`(P4b-3) 계승·빈 스위트 un-proven |
| M5/M7 | 증거·게이트 결과를 단일 tx 트랜잭셔널 아웃박스·인과(event_id) |
| M8 | blocked 비-무음 영속·이벤트·증거 없는 통과 불가 |

## 11. 수용 기준

1. `MANAGER_RELEASE_GATE` off → 워커/완료 경로 바이트 동일·새 이벤트 0(회귀 0).
2. on + 전 WP가 활성 채널 전부 passed → `gate.passed` 1회 영속·emit.
3. on + 1 WP의 1 required 채널 skip(오라클 부재) → `gate.blocked`·perWp에 missingChannels.
4. on + design_ui WP 포함 → `gate.blocked`(해당 WP un-proven).
5. ESCALATED WP 잔존 → 게이트 미발화. fix_reverify 재완료 후 all-done → 재게이트(새 gate_version).
6. 증거·게이트 영속은 단일 tx·멱등(중복 처리/재전달에도 이중 emit 0).
7. 게이트 평가 예외 → `blocked`(never-throw fail-closed).
