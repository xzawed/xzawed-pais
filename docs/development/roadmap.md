[홈](../README.md) > [개발](contributing.md) > 로드맵

# 로드맵

**지금 어디까지 왔고 다음에 무엇을 하는가.** 완료된 것의 연대기는 여기 두지 않는다 — 무엇이 언제 어느 PR로 들어왔는지는 `git log`가 정본이고, 손으로 옮겨 적은 목록은 반드시 어긋난다.

무엇이 **기본 실행**되고 무엇이 플래그 뒤에 있는지는 [LIVE_VS_FLAGGED.md](../LIVE_VS_FLAGGED.md)가 판단 기준이다. 아래 "완료"는 **머지·테스트 완료**를 뜻하지 기본 활성을 뜻하지 않는다.

---

## 자율 워크플로 Phase 현황

슬라이스 단위 PR로 진행하며, 구축된 파이프라인은 피처 플래그(기본 off) 뒤에 가역적으로 배선된다. 각 슬라이스의 설계 스펙은 `docs/superpowers/specs/`에 있다.

| Phase | 내용 | 상태 | 남은 것 |
|---|---|---|---|
| P0 | 세션 이벤트소싱 + 트랜잭셔널 아웃박스 (`EVENT_SOURCED_SESSION`) | 완료 | — |
| P1a~c | BaseConsumer 바운드 재시도 + DLQ · 멱등 소비 · EventBus 전송 추상화 | 완료 | — |
| P1d | Task Manager — 그래프 코어·영속·소비·디스패치·lease/escalation·완료 흐름·Supervisor 배선 (`TASK_MANAGER_ENABLED`) | 완료 | — |
| P2 | PM 다단계 분해 파이프라인 + 자가수선 (`MANAGER_DECOMPOSE_ENABLED`) | 부분 | WP `inputs`/`outputs` 채움 · 재진입 머지(`merge_keep_inflight`) · `near_term` 필터 |
| P2r | 리스크 분류 — 결정론 코어·영속·LLM 생산자·라우팅·승인 UI·모델 라우팅 소비 (`MANAGER_RISK_*`·`MANAGER_MODEL_ROUTING`) | 완료 | per-WP 재채점 · designer/tester/security 모델 소비 |
| 횡단 | WP 계약 스키마 정합 + 회복탄력성(budget·provider 서킷·벌크헤드) | 완료 | — |
| P3 | Oracle DoR 게이트 + 초안 생성 (`MANAGER_ORACLE_DOR`·`MANAGER_ORACLE_DRAFT`) | 부분 | step branch git 워크플로 · WP 상태머신 |
| P4 | 실행 워커 + 검증 채널 5종(conformance·impact·property·mutation·security) + advisory 비차단 큐 (`MANAGER_TASK_WORKER`·`MANAGER_WP_*`) | 부분 | fuzz(fast-check) · per-tier θ 캘리브레이션 · 결함 국소화 잔여(진동 누적·graph_dag 영속·재진입·계층 승급) · Tester 적대 측면 · `design_ui`/`security_audit` WP 자기검증 |
| P5 | fail-closed 릴리스 게이트 · 사인오프 · 배포 게이팅 · 강등 모드 FSM (`MANAGER_RELEASE_GATE`·`MANAGER_RELEASE_SIGNOFF`·`MANAGER_DEPLOY_GATE`·`MANAGER_DEGRADED_MODE`) | 부분 | 강등 enforcement · saga 보상 · canary/롤백 |
| P6 | 의사결정 영속 · 결함 브리프 · 결정 라우팅 · 대기함 UI · 만료 재에스컬레이션 (`MANAGER_DECISION_*`) | 부분 | `spec_fix`/`reject`/`accept_known` 실동작 · `verification.failed`/`decomposition.inconsistent` 브리프 · 관측성/SLO |

> **강등 모드는 코드가 아니라 스위치가 남았다.** `MANAGER_DEGRADED_MODE`가 NORMAL/DEGRADED/SAFE를 신호 구동 FSM으로 관측하고, 게이팅도 이미 `dispatch.ts`에 있다 — SAFE면 신규 디스패치 보류, DEGRADED + HIGH-risk면 사인오프 요구. 다만 `MANAGER_DEGRADED_ENFORCE`·`MANAGER_DEGRADED_SIGNOFF`가 **둘 다 기본 false**이고 off면 `getMode`가 주입되지 않아 스킵된다(회귀 0). 남은 것은 아래 1번이다.

---

## 다음 슬라이스

전부 착수 가능(선행조건 없음 또는 이미 충족).

1. **강등 enforcement 활성화** — 게이팅 코드는 있으니 신호원과 운영성을 채운다. 추가 신호원(브로커·하트비트·이벤트스토어·보안사고), stuck-DEGRADED idle-probe, SAFE 재개 사인오프. 그다음 플래그를 켤 조건을 정한다.
2. **모델 라우팅 확장 + 분해 정밀화** — designer·tester·security 에이전트의 모델 소비(각 ~2줄, `payload.model ?? config` 동일 패턴). WP `inputs`/`outputs` 채움(계약 체인·impact-DAG 입력), 재진입 머지, `near_term` 필터.
3. **결정 라우팅 실동작** — `spec_fix`(재분해)·`reject`(saga 보상)·`accept_known`(게이트 override)을 실제로 동작시키고, `verification.failed`·`decomposition.inconsistent` 브리프로 확장한다.
4. **saga 보상 · canary/롤백** — 강등/실패 시 보상 트랜잭션과 점진 배포. 1번에 의존한다.

> ⚠️ **시퀀싱 함정.** P5 fail-closed 릴리스 게이트(hard-AND)는 P4 security 채널이 **먼저** 착륙해야 한다. security 채널이 `develop_code` WP에는 착륙했으므로 거기까지는 실 `security_pass`를 AND할 수 있다. 그러나 `design_ui`·`security_audit` WP는 여전히 자기검증이 없어 빈 plan으로 auto-pass한다 — 이 WP들의 게이트를 먼저 닫으면 **채널 skip이 fail-open을 fail-closed로 위장한다.** P4 잔여가 그 갭을 메운 뒤에 닫는다.

---

## 잠복 하드닝

기능이 아니라 이미 있는 경로의 결함이다. 급하지 않지만 잊으면 안 되는 것들.

- **멱등 dedup-then-crash 윈도** — 처리 전 마커를 세우므로, 클레임과 완료 사이에 크래시하면 재전달이 skip돼 무음 유실된다.
- **Manager 인바운드 소비자에 바운드 재시도가 없다** — DLQ 격리는 있다(`StreamConsumer`·`SessionGatewayConsumer` 둘 다 `routeToDlq` 호출). 없는 것은 shared `BaseConsumer`의 `maxDeliveries` 재시도 루프라, **일시적 실패도 1회 만에 DLQ로 간다.**
- **`OutboxRelay` max-attempts cap·DLQ 부재** — 영구 실패 행을 무한 재시도한다.
- **causation leaf null 5곳 + 메트릭/SLO 0**.
- **oracle-tier 쓰기 라우트의 소유권 공백** — 근거와 범위는 [LIVE_VS_FLAGGED.md](../LIVE_VS_FLAGGED.md)에 있다. 호출자 신원이 Manager에 도달하는 슬라이스에 묶여 있다.

---

## 관련 문서

- [기여 가이드](contributing.md)
- [ADR 목록](adr/README.md)
- [Live vs Flagged](../LIVE_VS_FLAGGED.md)
- [문서 인덱스](../README.md)
