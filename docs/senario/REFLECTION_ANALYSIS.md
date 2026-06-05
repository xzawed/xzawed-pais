# senario 사양 → xzawedPAIS 반영 분석 & 로드맵

- 작성일: 2026-06-05
- 방법: 다이나믹 워크플로우(18 에이전트) — 8개 개념 영역별 [사양 요구 추출 → 코드베이스 갭 분석(file:line 근거)] 파이프라인 + 통합 합성 + 적대적 완전성 비평
- 원천: [docs/senario/](.) 패키지 (handoff_spec v5 + 8개 파생/확정 문서)
- 비평 반영: 합성 결과를 완전성 비평으로 교차검증해 M8·N7 누락 보강, M3 정정, N1↔M1 순환 해소 명시 등 적용(신뢰도 상향)

> ⚠️ 이 문서는 **분석·계획**이다. 실제 반영(구현)은 §3 로드맵과 §5 WP0 사람 결정 이후 단계별 PR로 진행한다. 확정 결정이 아니라 **권고**다.

---

## 1. 정합성 판단 (Reconciliation)

### 판정: **진화 + 부분 병렬 재설계** (순수 신규 아님, 전면 갈아엎기도 아님)

senario v5는 새 시스템이 아니라 **현 xzawedPAIS의 같은 문제 영역을 더 엄격한 엔터프라이즈 골격으로 다시 설계한 사양**이다.

- **(a) 진화 — 재사용 토대 5종(갈아엎지 않음)**: ① Redis Streams 메시지 패싱 + 서비스 간 no-direct-import(M3 절반), ② Dev/Designer/Tester/Security 에이전트, ③ 승인 게이트(HITL 자리, `gates/approval-gate.ts`), ④ Tester/Builder/Security의 실제 실행(N1 ground-truth 토대), ⑤ 도메인 위키 + `domain_knowledge_audit` append-only(M9 참고 패턴). **→ 확장·승격으로 재사용.**
- **(b) 병렬 재설계 — 현 구조와 정면 충돌(옆에 쌓고 점진 전환)**: 인메모리 LLM tool-calling 루프(`runner.ts` `messages[]`) → event-sourced 워크플로 상태머신; fail-open 승인 게이트 → fail-closed 릴리스 게이트; Redis Streams 1차 전송 → Postgres 아웃박스 진실원천 + 브로커 전송.
- **(c) 순수 신규(전수 grep 0건)**: Oracle/Work Package/DoR·DoD, mutation 게이트, 3렌즈 검증, 적대 케이스 생성, 결함 국소화·attribution_counters, 에스컬레이션 사다리(M8), 강등 모드(NORMAL/DEGRADED/SAFE), 서킷·벌크헤드, canary·롤백·saga, Wiki Agent 리스크 분류·모델 라우팅, HumanDecision/SignOff 부인방지.

### 용어 매핑 표

| senario 용어 | 현 시스템 대응 | 매핑 종류 | 근거 |
|---|---|---|---|
| 5개 에이전트(PM·Dev·Designer·Tester·Security) | 7개 디스패치(+Planner·Builder·Watcher) | 부분(PM≈Planner, Builder/Watcher 잉여) | `planner/src/types.ts` AGENT_TYPES에 'PM' 없음 |
| PM Agent(WBS 분해·커버리지·계약수선) | Planner(intent→평면 Step[]) | 대폭 확장 | `planner runner.ts` |
| Orchestrator(stateless·사람대면) | xzawedOrchestrator(인증·세션·UI) | 진화(stateless화) | `ws/session.ws.ts` 세션 상태 보유 |
| Task Manager(ready 노드만 디스패치·lease) | Manager 명령형 tool-calling 루프 | **재설계**(흡수→분리) | `runner.ts` LLM 동기 호출 |
| Supervisor(이상 시 개입) | 없음 | net-new | grep 0 |
| Event Bus(choreography·봉투) | Redis Streams `{src}:to-{dst}:{sid}` 1:1 | 부분(M3)+봉투 net-new | `streams.ts` sessionId/messageId만 |
| Wiki Agent(리스크 분류기+KB) | 도메인 위키 KnowledgeRepo(저장만) | 부분(저장)·분류기 net-new | `db/knowledge.repo.ts` |
| Oracle / Work Package / DoR·DoD | 없음 | net-new | grep 0 |
| 릴리스 게이트(하드 AND·fail-closed) | 승인 게이트(PO 클릭·fail-open) | **충돌**·재설계 | `approval-gate.ts` parseDecision fail-open |
| HumanDecision/SignOff(부인방지) | info_response(휘발)+saveToWiki(가변) | net-new | `session.store.ts` waitForInfo |
| M/N 불변식(M1~M9·N1~N8) | M3만 PARTIAL, 나머지 ABSENT/CONFLICTS | 토대 net-new | 전수 grep |
| 코어 스택 FastAPI·APScheduler·RabbitMQ | TS/Fastify·ioredis·선택적 pg | **충돌**(STACK-CORE) | 전 서비스 Node |

---

## 2. 영역별 갭 요약 (8개)

| 영역 | 현재 상태 | 핵심 갭 | 충돌/사람결정 |
|---|---|---|---|
| handoff-spec(전체) | 9서비스 + Redis Streams + 명령형 Manager 루프 | 엔터프라이즈 골격 통째 부재 | 언어·토폴로지·게이트 권위(3대) |
| roadmap(P0~P6) | 어느 Phase도 코드 산출물 없음 | 토대(P0 상태/아웃박스)부터 미시작 | 비전문서 vs senario ROADMAP 권위 |
| workflow-statemachine | 3값 플랫 세션 상태 + in-place UPDATE | 2계층 상태머신·이벤트 전이·24종 이벤트 카탈로그 부재 | event-sourcing 도입, 결정적 vs LLM 자율 |
| human-decision | info_request/승인카드(휘발) | DecisionRequest/HumanDecision/SignOff·RBAC·부인방지 부재 | fail-open→fail-safe, 불변저장소, RBAC |
| operations | 단일 모델·동시성 캡 없음·Redis 직결 | 강등모드·서킷·벌크헤드·백프레셔·아웃박스 부재 | 진실원천 Redis→Postgres |
| oracle-schema | sessions·domain_knowledge 2테이블 | Oracle/Scenario/Invariant/Golden·DoR·버전관리 부재 | mutable vs immutable, Story/WP 선행 |
| verification-adversarial | Tester 실행 + Security 정규식/LLM | 3렌즈·mutation·θ_risk·적대생성·canary 부재 | **fail-closed vs fail-open(최대)** |
| wiki-risk-routing | 단일 정적 env CLAUDE_MODEL | 리스크 분류기·모델 라우팅·human_gate 부재 | 정적 env→동적 모델 전달 |

### 상태 분포 (요구 ≈ 196건)

| 영역 | IMPL | PARTIAL | ABSENT | CONFLICTS |
|---|---|---|---|---|
| handoff-spec | 1 | 16 | 24 | 2 |
| roadmap | 0 | 15 | 19 | (+7 결정) |
| workflow-statemachine | 0 | 6 | 25 | — |
| human-decision | 1 | 3 | 15 | 1 |
| operations | 0 | 2 | 15 | 2 |
| oracle-schema | 0 | 4 | 29 | — |
| verification-adversarial | 0 | 4 | 26 | 1 |
| wiki-risk-routing | 0 | 0 | 27 | — |
| **합계** | **2** | **50** | **180** | **6** |

**결론**: **신규 구현 0%** (IMPLEMENTED 2건은 문서 메타뿐). 그러나 PARTIAL 50건은 "자리만 있고 의미가 다른" 재사용 후보이며 그중 **재사용 토대 5종(§1-a)은 실코드 자산**이다 — "0%"가 이 자산 가치를 깎지 않도록 주의. CONFLICTS 6건이 사람 결정의 핵심.

---

## 3. 반영 로드맵 (우선순위·의존)

### 시퀀싱 원칙 (사양 ROADMAP 준수)
**토대(상태·아웃박스) 먼저 → 검증·게이트 → 사람 인터페이스 마지막.** 관측성 일부(correlation_id·구조화 로그)는 P0부터 병행.

### 의존 그래프

```
[WP0 결정 게이트] (사람 결정, 비코드) ─────────────────────────┐
                                                              ↓
EVENT-ENVELOPE-SCHEMA ──┬── M4 event-sourcing ──┬── M5 outbox ──┬── M3 Event Bus(인프로세스 호출 디커플 포함)
(의존0, 선착수)          │                        │              ├── M6 멱등 / M7 트레이스
WP-CONTRACT-SCHEMA ─────┘                        │              └── M8 에스컬레이션 사다리(6단)·모델강등·DLQ·서킷·벌크헤드
(의존0, 선착수)                                    └── Task Manager / Supervisor / lease
                                                              ↓
                    Wiki 리스크분류(P2) ──┬── 모델라우팅 ──┐
                    ORACLE-SCHEMA(+N7) ───┴── DoR게이트 ───┤
                    PM 분해 파이프라인 ────────────────────┘
                                                              ↓
            3렌즈검증 ── 적대생성 ── mutation게이트(θ_risk, N8) ── N1 ground-truth ── 골든거버넌스(N7)
                                                              ↓ (P2 리스크티어 → 검증 강도)
            릴리스게이트(하드 AND·fail-closed M1) ── saga ── canary/롤백 ── 강등모드(N2)
                                                              ↓
            HumanDecision/SignOff(append-only M9) ── 의사결정 브리프 ── §11 되먹임
```

> **N1↔M1 순환 의존 해소**: 갭 분석상 N1(ground-truth)과 M1(릴리스 게이트)은 상호 의존이다. 본 로드맵은 **N1을 릴리스 게이트의 *입력*으로 단방향화**해 해소한다(게이트가 ground-truth를 소비). 토대→검증→사람 원칙에 부합.

### 단계별 Work Package 묶음 (PR 단위)

| Phase | WP 묶음 | 포함 | effort | M/N | priority |
|---|---|---|---|---|---|
| **WP0** | 결정 게이트(비코드) | §5 6대 충돌 사람 확정 + 권위 로드맵 선택 | S | — | **must(선행)** |
| **P0** | 이벤트 봉투 + 계약 스키마 | EVENT-ENVELOPE-SCHEMA, WP-CONTRACT-SCHEMA, correlation/causation 유틸, 구조화 로그 | M+M | M7부분 | **must** |
| **P0** | 이벤트소싱 + 아웃박스 | events 테이블, reduce(state,event), 아웃박스+릴레이(Node 폴링), replay 복원, dual-write 제거 | XL+L | M4·M5 | **must** |
| **P0** | M3 정적 검사(quick win) | dependency-cruiser/no-restricted-imports CI 게이트 (※ import 차단은 M3의 *절반*; 인프로세스 `handler.execute` 디커플은 P1) | S | M3 부분 | should |
| **P1** | Event Bus + Task Manager | pub/sub 추상화, Manager 인프로세스 직접호출→이벤트 발행/구독 디커플, ready 디스패치·step-N·위상정렬, lease, Supervisor | XL | M3·M6 | **must** |
| **P1** | 안정성 + **M8 에스컬레이션 사다리(6단)** | 멱등(M6), DLQ, 벌크헤드, provider/budget 서킷, **§12 6단 사다리(감지→재시도→Opus→Sonnet 강등→재배치→격리→사람 핸드오프) 통합** | XL | M6·M8 | **must** |
| **P1** | 워크플로/WP 상태머신 | 워크플로 7+3주상태, WP 8+2주상태, 24종 이벤트 카탈로그 | XL | M4 | **must** |
| **P2** | Wiki 리스크 분류 + 모델 라우팅 | 4차원 채점, route_models(LOW/MED/HIGH), 분류기 Opus 고정, human_gate (※ **P4 θ_risk·리스크티어 게이트의 선행**) | XL | N6 | should→**P4 선행** |
| **P2** | PM 분해 파이프라인 | 하이브리드 분해, coverage matrix, content-hash ID, 사이클검사·위상정렬(결정론), bounded repair | XL | N4 | should |
| **P3** | Oracle + DoR + step branch | Oracle 스키마(GWT/invariant/golden), **N7 골든 사람승인 전용·자동갱신 금지**, DoR 게이트(human_approved≥1), step branch 멱등 커밋(M6), DoD 머지 게이트 | XL | M2·N7 | **must** |
| **P4** | 3렌즈 검증 + 적대 + mutation + **골든 거버넌스** | conformance/advisory/impact 분리, 적대 생성(property/fuzz/metamorphic/STRIDE), mutation 게이트(θ_risk N8), N1 ground-truth 강제, 결함 국소화·attribution_counters, **golden diff 3분류·N7 자동갱신 금지 강제** | XL | N1·N3·N5·N7·N8 | **must** |
| **P5** | 릴리스 게이트 + 배포 안전망 | 하드 AND(실행TC∧adversarial∧보안∧회귀∧mutation≥θ, fail-closed M1), saga+보상, canary→staged, feature flag, 자동 롤백, **강등×HIGH 사인오프(N2, P2 risk + P5 강등모드 교차의존)** | XL | M1·N2 | **must** |
| **P6** | 사람 인터페이스 | HumanDecision/SignOff append-only(M9), 의사결정 브리프 6요소, 동작 우선 브리핑, §11 되먹임(4선택지), RBAC, 강등모드 UI, SLO 대시보드 | XL | M9 | should |

**effort 합계**: XL ≈ 15, L ≈ 6, M ≈ 8, S ≈ 4 → **사실상 신규 시스템 구축 규모.** 점진 진화로 P0→P6.

**권장 순서**: WP0 → P0(봉투·계약·이벤트소싱·아웃박스·M3) → P1(Event Bus·Task Manager·**M8 사다리**·상태머신) → P2(Wiki/PM, **P4 선행**) → P3(Oracle/DoR/N7) → P4(검증/골든거버넌스) → P5(릴리스/강등) → P6(사람 인터페이스).

---

## 4. 즉시 착수(Quick wins) vs 대형(설계 선행)

### Quick wins (S, 의존 적음)
- **EVENT-ENVELOPE-SCHEMA 정의**(의존0): correlation_id·causation_id·idempotency_key·workflow_id·step_id·attempt_id·occurred_at + Zod. 거의 모든 후속의 dependsOn 루트.
- **WP-CONTRACT-SCHEMA 정의**(의존0): WP JSON 스키마(id·story_id·owning_role·oracle_ref·acceptance_criteria·dependencies·attribution_counters).
- **M3 정적 검사 게이트**: dependency-cruiser로 서비스 간 import 0건 자동 보장(단 인프로세스 호출 디커플은 P1).
- **모델 ID/θ_risk/임계 외부화**: 소비 컴포넌트 미구현이라 값만 config로 골격화(캘리브레이션 자리).

### 대형 (XL, 충돌 해소 후)
- 이벤트소싱 + 트랜잭셔널 아웃박스(M4/M5) — 모든 토대의 뿌리.
- Task Manager + 결정적 디스패치(현 LLM 자율 루프 재설계).
- Oracle 스키마 + 시나리오→실행테스트 컴파일(N1).
- 적대 검증 기계(property/fuzz/metamorphic/mutation/STRIDE) + 골든 거버넌스(N7).
- 릴리스 게이트 하드 AND fail-closed + saga + canary/롤백.
- HumanDecision/SignOff 부인방지 + §11 되먹임.

---

## 5. 위험·미해결 결정 (WP0 — 사람 확인 필요)

1. **[최대] 언어 런타임 충돌(STACK-CORE)**: 사양 §17 FastAPI/Python vs 현 전 서비스 TS/Node. 그대로면 전면 재작성. **권장: 사양 §0/§18 절차대로 §17을 "Node 등가물(Fastify + 자체 폴링 릴레이)"로 변경 제안** — 자산 보존.
2. **[최대] 게이트 fail-open→fail-closed**: `approval-gate.ts` parseDecision이 파싱 불가 시 approve(fail-open). 사양 N1/M1/M8과 정면 충돌. **권장: 승인 게이트(PO 검토용)는 유지, 별도 fail-closed 릴리스 게이트 신규 모듈 신설.**
3. **토폴로지·통신 모델**: stateless 조정 + Task Manager choreography vs 현 Manager 중앙 명령형 루프. Builder/Watcher 위치, Manager 폐지/재배치, 5 vs 9 매핑. **LLM tool-calling을 상태머신의 한 액터로 종속시킬지** 핵심.
4. **메시징 진실원천**: Redis Streams(현 1차) → Postgres 아웃박스(진실원천)+브로커(전송). 루트 CLAUDE.md "통신은 Redis Streams만" 불변과 충돌. **권장: Event Bus 추상화 뒤 Postgres 아웃박스 도입, Redis는 lease/멱등/rate-limit 보조.**
5. **권위 로드맵 선택**: 비전문서 P1~P6(협업·위키·승인) vs senario ROADMAP P0~P6(이벤트소싱·게이트). 어느 것을 권위로.
6. **RBAC/oracle 권위 모델**: 현 단일 PO(userId, role 없음). 사양은 HIGH-risk override·degraded release에 authority_level 검증 요구.
7. **mutable→immutable 저장**: `knowledge.repo.ts` updateById/deleteById(가변) vs oracle/golden/decision append-only. 기존 위키 확장 vs 별도 event store.
8. **[정합화] WS grace(#225) ↔ P0 이벤트소싱**: 최근 머지된 WS 끊김 grace 세션 정리(인메모리 `pendingCleanups`)와 P0 event-sourced 세션 상태가 충돌하는 구체 지점. 전환 시 정합화 필요.
9. **캘리브레이션 잔여(비차단)**: θ_risk·강등 임계·병렬도(16/1000) 수치는 소비 컴포넌트 구현 후 운영 데이터로 확정.

---

## 6. 추천 다음 단계 Top 5

1. **WP0 결정 게이트 소집** — §5의 #1(언어)·#2(fail-closed)·#3(토폴로지)·#5(권위 로드맵) 4건을 1회 의사결정으로 확정. 코드 착수 전 필수 차단 해소.
2. **EVENT-ENVELOPE-SCHEMA + WP-CONTRACT-SCHEMA 선착수**(Quick win) — 의존0이며 거의 모든 후속의 dependsOn 루트. `streams.ts` 봉투 확장 + Zod PR.
3. **M3 정적 검사 CI 게이트**(Quick win) — dependency-cruiser로 서비스 간 import 0건 자동 보장(저비용 즉시 가치).
4. **P0 이벤트소싱 + 아웃박스 스파이크** — `events` 테이블 + reduce + 아웃박스 릴레이(Node 폴링) + kill/restart replay 복원 테스트. Manager 인메모리 `messages[]` 루프를 event-sourced로 전환하는 첫 수직 슬라이스(M4/M5/M7).
5. **릴리스 게이트 vs 승인 게이트 분리 설계 문서** — fail-open 충돌(#2)을 코드 전에 설계로 해소. 승인 게이트는 conformance/AWAITING_HUMAN 유지, 릴리스 게이트는 별도 fail-closed 하드 AND. P4/P5 진입 전 선행.

---

## 부록: 분석 메타

- 워크플로우: `senario-reflection-analysis`(18 에이전트, 8영역 × [추출→갭] 파이프라인 + 합성 + 비평).
- 비평 신뢰도 평가: 합성 골격은 evidence와 정합(7.5/10), 비평이 지적한 M8·N7 명시 보강·M3 정정·N1↔M1 해소 근거를 본 문서에 반영(→ 상향).
- 핵심 원칙 보존: 재사용 우선(승인 게이트·위키·audit·Tester 실행·AgentQuery), fail-closed·append-only·사람 권위는 신규 설계에 보존, 현 자산을 헛되이 갈아엎지 않음(이벤트소싱은 병렬 트랙 점진 전환).
