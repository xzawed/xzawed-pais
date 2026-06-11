# §13 Budget 서킷브레이커 — 설계 (잔여 감사 횡단 슬라이스)

**날짜**: 2026-06-11
**상태**: 승인됨(설계 분기 확인 완료)
**관련**: senario `xzawedPAIS_handoff_spec.md` §13(서킷브레이커 2종)·`OPERATIONS_DECISIONS.md` §1(강등 모드)/§3(병렬도 한계)

## 배경 / 동기

잔여 작업 감사(post-#279)가 횡단 회복탄력성 갭으로 확정: spec §13의 서킷브레이커 2종(provider·budget) 중 **budget 서킷이 0**. 병렬 subagent·Deep Research(P2 Wiki Agent·P4 적대검증) 도입 시 토큰 비용이 폭발할 수 있어, 그 본격화 **이전에** 비용 상한 보호를 두는 것이 권장 순서(독립·저위험).

이 슬라이스는 **budget 서킷만** 다룬다. provider 서킷·벌크헤드·백프레셔는 별도. 강등 모드(NORMAL/DEGRADED/SAFE) 전체 상태머신은 P6 — 이 슬라이스는 **브레이커 코어 + Manager LLM 경계 통합**까지이고, 트립은 후속 P6 강등 모드가 소비할 신호다.

## 설계 분기 결정 (사용자 확인)

- **측정 단위 = USD 비용**: 모델별 가격표로 usage→USD 환산(spec "비용 상한" 정합·모델 혼용 공정).
- **상태 = 인메모리**: Manager 프로세스 메모리에 워크플로/일 누적 보관, 일 단위 clock 리셋. 재시작 시 일 카운터 소실(per-workflow 캡은 워크플로가 한 프로세스라 정확). Postgres 내구화는 P6 강등 모드와 함께 후속.

## 아키텍처

### xzawedShared `budget/budget-circuit.ts` (재사용 순수 코어)

- **가격표** `MODEL_PRICING`(USD/1M tok, claude-api 레퍼런스 cached 2026-06-04): fable-5 10/50·opus-4-8/4-7/4-6 5/25·sonnet-4-6 3/15·haiku-4-5 1/5. 미지 모델은 `DEFAULT_PRICE`(Opus-tier 5/25 — 보수적 과대추정).
- **`costOf(model, usage)`**: `(input + cache_creation×1.25 + cache_read×0.1)×inputPrice + output×outputPrice) / 1e6`. 캐시 토큰 가중(쓰기 1.25·읽기 0.1) — 캐시 미사용 경로도 안전(필드 0).
- **`BudgetCircuitBreaker`**: 인메모리. `check(workflowId)`(워크플로 또는 일 누적 ≥ 상한이면 `BudgetExceededError` throw·fail-closed 선검사)·`record(workflowId, model, usage)`(비용 누적·트립 판정 반환)·`snapshot(workflowId)`. 주입형 `now`로 일(UTC YYYY-MM-DD) 롤오버. 상한 0/미지정 = 비활성(Infinity).
- **`BudgetExceededError`**(scope·workflowId·spentUsd·capUsd) — never-undefined 메시지.

### Manager 통합 (`claude/runner.ts` tool-loop)

- `ClaudeRunner` 생성자에 optional `budgetBreaker?`·`onBudgetTrip?(info)` 추가. tool-loop의 `messages.create` **전** `breaker.check(sessionId)`(트립이면 throw → 기존 catch가 `type:'error'` 발행 = M8 stop·무음 금지) / **후** `breaker.record(sessionId, model, usage)`. record가 tripped면 `onBudgetTrip` 호출(server.ts가 `app.log.warn`로 배선 = 알림).
- 미주입(flag off)이면 check/record no-op → 동작 바이트 동일·회귀 0.

### 배선 (`config.ts`·`server.ts`)

- `MANAGER_BUDGET_PER_WORKFLOW_USD`·`MANAGER_BUDGET_DAILY_USD`(z.coerce.number().nonnegative().default(0), 0=비활성).
- server.ts: 둘 중 하나라도 >0이면 `new BudgetCircuitBreaker({...})` 생성→`ClaudeRunner`에 주입 + `onBudgetTrip`=`app.log.warn`. 아니면 미주입.

## 동작·경계

- 호출 비용은 사전 미상이므로 **누적 ≥ 상한 시 다음 check가 차단**(임계를 넘긴 그 호출은 완료·이후 차단). 보수적 게이트.
- 일 카운터는 프로세스 전역·근사(재시작 소실). per-workflow는 정확. 임계값은 캘리브레이션(비차단·spec §3).
- 트립은 spec §1 DEGRADED→SAFE 신호의 입력 — 이 슬라이스는 stop(throw)+alert(log)까지, 상태머신 전이는 P6.

## 검증

- TDD: 코어(costOf 모델별·캐시 가중·미지 모델 폴백 / check·record 워크플로·일 트립 / 롤오버 / 비활성) + 러너 통합(check throw→error 발행·record 누적·onBudgetTrip 호출·미주입 회귀 0).
- shared·Manager 전체 테스트·tsc(turbo 캐시 우회 직접 tsc)·jscpd 0·audit 0.

## 비범위(후속)

provider 서킷·벌크헤드·백프레셔·강등 상태머신(P6)·Postgres 내구 일 카운터·decompose 스테이지/에이전트 서비스 통합(코어 재사용 준비됨)·실시간 rate-limit 토큰버킷.
