# 프리미엄 서비스 준비도 — Claude ⊕ Grok 공동 검증 보고서

> **목적:** xzawedPAIS를 **프리미엄 상용 서비스**로 제공하기 위한 장단점 공동 검증. 기준 = 모든 과정이 **쉽고(EASY)·정확하고(ACCURATE)·효율적(EFFICIENT)**.
> **방법:** ① Grok이 자기 기술분석([grok-project-analysis.md](grok-project-analysis.md))의 장단점을 프리미엄 렌즈로 재검증 + 자기비판([grok-premium-review.md]는 스크래치패드 원본) → ② Claude가 고위험 주장을 live 코드로 독립 재검증 → ③ 공동 종합.
> **결과 한 줄:** 코드는 우수하나 **기본값은 신중한 챗 오케스트레이터**이고, "자율 조직"은 스위치보드 뒤에 잠들어 있어 — **easy/accurate/efficient 상용 서비스로는 아직 미달**.

---

## 1. 검증 방법과 신뢰도

| 주장 | Grok(2차) | Claude 독립 재검증 (파일 근거) | 합의 |
|---|---|---|---|
| 멀티테넌시/org 경계 없음·단일 `ANTHROPIC_API_KEY` | 주장 | `tenant_id/org_id/multi-tenant` 코드 **0건**·`config.ts:5` 단일 env | ✅ 일치 |
| 과금/미터링 제품 표면 없음 | 주장 | 프로젝트 코드 stripe/billing/metering/invoice **0건** | ✅ 일치 |
| 고객 비용(USD) UI 없음 (chat token만) | 주장 | `RightPanel.tsx:69-70` tokenCount만·앱 USD UI **0건** | ✅ 일치 |
| rate-limit은 auth-only | 주장 | `auth.route.ts:26-70` auth만(max 5/분)·sessions/messages **0건** | ✅ 일치 |
| renewLease 하트비트가 lease-vs-verify 완화 (**철회**) | Grok 스스로 과장 철회 | `worker.ts:193-207`+`supervisor.ts:344-348` "production 항상 동반" 확인 | ✅ 일치 (Grok 철회가 정확) |
| 무인증 mutation 라우트(knowledge/oracle/risk) | 주장 | 이번 세션 #406에서 직접 처리·`server.ts:644-649` | ✅ 일치 |
| deploy-gate fail-open | 주장 | `deploy-gate.ts:34,57-68`·이번 세션 P5-2b 인지 | ✅ 일치 |

**Claude ↔ Grok 사실 불일치 0건.** 두 엔진이 독립적으로 같은 결론에 도달 → 아래 판정은 **높은 신뢰도**.

---

## 2. 공동 판정 — 프리미엄 3축 점수

| 축 | 점수 | 근거 (합의) |
|---|---|---|
| **쉽고 EASY** | **3 / 10** | Launcher가 *인프라*는 쉽게 함. 그러나 *제품 경로*는 ~30개 플래그 매트릭스 + Chat\|Build 이중 모델 + 프리셋 부재. 비전문가 happy-path 없음. |
| **정확하고 ACCURATE** | **4 / 10** | 챗 승인 게이트는 실재·fail-safe(live 기본 경로). 그러나 자율 정확성은 취약한 플래그 그래프 뒤에만·deploy fail-open·"출하 완료"로 읽히는 휴면 기능 문서가 신뢰 훼손. |
| **효율적 EFFICIENT** | **3 / 10** | 챗 경로는 OK. 전체 verify 스택은 설계상 고비용(에이전트 fan-out)인데 **기본 비용 캡 off·고객 비용 UX 없음·멀티테넌트 소음이웃 대책 없음**. |

**종합 ≈ 3.5 / 10** (호스팅형 자율 소프트웨어 팩토리 기준) · **≈ 5.5 / 10** (챗-우선 로컬 어시스턴트로 좁혀 팔 경우).

---

## 3. 검증된 장점 — 그러나 대부분 "고객이 못 느낀다"

프리미엄 렌즈에서 장점은 **(a) 고객가시 / (b) 운영자가치 / (c) 내부전용**으로 재분류된다.

| 장점 | 분류 | 프리미엄 의미 |
|---|---|---|
| 승인 게이트 fail-safe (챗 tool-loop) | **(a) 고객가시·상시** | PO 신뢰의 핵심·**유일한 상시 고객-정확성 자산** |
| Launcher 5단계 마법사 | **(a) self-host 온보딩** | 인프라는 쉬움(제품 프로필은 아님) — 1차 보고서가 과소평가 |
| 다채널 검증(conformance/impact/property/mutation/security) | (a) **단, 켜졌을 때만** | 최고의 정확성 스토리지만 **기본 off라 고객이 안 삼**·켜면 효율 급락 |
| 순수 코어·트랜잭셔널 아웃박스·DLQ·서킷·강등 FSM | 대부분 **(c) 내부** | 미래 정확성·운영 신뢰의 토대나 **단독으로 서비스를 팔지 않음** |
| lease + renewLease 하트비트 | (b)/(c) | 자율 경로 정확·효율(철회 반영: false reclaim 완화) |

**핵심**: 엔지니어링 품질은 실재하나, **프리미엄 렌즈에서 상시 고객가치는 "챗 승인 루프 + Launcher"에 집중**돼 있고 나머지는 스위치 뒤 휴면.

---

## 4. 검증된 단점 — 3축별 런치 블로커

●●●=치명 ●●=중대 ●=경미 · **LB**=런치블로커 · **PL**=출시후

| 단점 | EASY | ACC | EFF | 등급 | 축 위반 요지 |
|---|---|---|---|---|---|
| W1 플래그 매트릭스·프리셋 없음 | ●●● | ●● | ● | **LB** | 제품 실행에 5~15개 상호의존 env 수동 조립 |
| W15 비전문가 happy-path 없음 | ●●● | ●● | ● | **LB** | "설명→빌드→완료"가 전문가 전용 |
| W2 Chat/Build 이중 모델 + 이중 decompose 플래그 | ●●● | ●● | | **LB** | "Build 눌렀는데 아무 일도" |
| W3 문서(출하)↔런타임(휴면) 갭 | ● | ●●● | | **LB** | 마케팅 정직성·지원 과약속 위험 |
| W4 무인증 mutation(JWT 없으면 개방) | ● | ●●● | | **LB** | 네트워크 노출 시 고위험 |
| W5 deploy-gate fail-open | | ●●● | | **LB**(배포 주장 시) | "차단"이 차단 아님 — 엔터프라이즈 적대적 |
| W7 risk=MEDIUM이 mutation 게이트 구조적 사망 | ●● | ●●● | ● | **LB**(mutation 마케팅 시) | 플래그만 켜도 커버리지 0 |
| W8 verify fan-out 고비용·고객 비용 UX 0 | ●● | ●(과금) | ●●● | **LB**(사용량 과금 시) | WP당 지연·$ 폭발·견적 없음 |
| **W11 멀티테넌트/org 격리 없음** | ●● | ●●● | ●● | **LB**(SaaS) | *신규 발견* — 단일 워크스페이스·공유 키/Redis/PG |
| **W12 과금/미터링 없음** | ● | ●● | ●●● | **LB**(사용량 SaaS) | *신규 발견* — budget은 운영 kill-switch지 원장 아님 |
| **W14 rate-limit auth-only** | | ●● | ●● | **LB**(공개 API) | *과소평가* — 메시지/빌드 무제한 |
| **W13 SLO/메트릭 스택 없음** | ● | ●● | | **LB**(SLA) | *과소평가* — /health+로그뿐 |
| W6 lease vs verify 비용 | | ● | ●● | **PL** | 하트비트로 완화(철회)·잔여는 비용 thrash |
| W9 "Redis-only" ADR ↔ HTTP 컨트롤플레인 | | ● | ● | **PL** | 문서 addendum |
| W10 golden 자동캡처 Slice 2 미완 | | ●● | | **PL** | impact 채널 마케팅↔실제 |

---

## 5. 가장 중요한 전략 판단 — SKU를 하나 고르고 정직하라

| SKU | 오늘 실현성 | 전제 |
|---|---|---|
| **A. 챗-우선 프리미엄 어시스턴트**(챗+승인+전문가용 빌드) | **가장 가까움** | 폴리싱 + 프리셋 |
| **B. 자율 검증 소프트웨어 팩토리**(self-host) | **코드 완성·운영 적대적** | G1~G9(프로필·auth·정직 문서) |
| **C. 멀티테넌트 호스팅 SaaS(SLA)** | **미준비** | G11~G14(테넌시·과금·SLO) |

> **CLAUDE.md 벽을 B/C로 오늘 마케팅하는 것은 부정확**하다(양 엔진 합의).

---

## 6. 반영 우선순위 (양 엔진 합의)

**Tier 0 — "프리미엄 자율 서비스"를 팔려면 필수**
- **G1 명명된 제품 프로필** `PAIS_PROFILE=premium-*`: 검증된 플래그 스택 + JWT 강제 + lease/budget 바닥값 자동. Launcher·문서가 이걸 설치. (M·LB) → W1/W15 해소
- **G2 단일 happy-path**: "설명→빌드→결정승인→완료"·고객에게 플래그 노출 0(점진적 공개). (M·LB) → W2
- **G3 프로덕션 auth 하드-페일**: `MODE=remote`/상용 프로필에서 `SERVICE_JWT_SECRET` 없으면 mutation 기동 거부. (S·LB) → W4
- **G4 정직한 Live-vs-Flagged 매트릭스** + CLAUDE.md 마케팅화 축소. (S·LB) → W3
- **G5 고객 비용 가시성 + 프리미엄 프로필 기본 캡 on**(USD 견적·세션 지출·상한 정지). (M·LB) → W8/W12

**Tier 1 — 프리미엄 주장의 신뢰/정확성**
- G6 deploy-gate strict 모드(릴리스 기능 on인데 게이트/DB 오류 시 fail-closed)·(S) W5
- G7 risk→mutation 자동 배선 or mutation 미주장·(M) W7
- G8 lease 채널기반 auto-tune or 부팅 시 최소 가시성 강제·(S·PL) W6
- G9 프리미엄 프로필 CI E2E 1개(빌드→WP→verify→완료)·(M-L) 품질 주장 근거
- G10 sessions/messages/decompose rate-limit·(S-M) W14

**Tier 2 — 멀티테넌트 SaaS에만 필요**
- G11 테넌트 경계(org_id·per-tenant Redis 프리픽스/전용 스택·컨테이너 격리)·(L) W11
- G12 과금 원장/미터링 export·(L) W12
- G13 per-tenant 시크릿(BYO 키/vault)·(M-L)
- G14 메트릭+SLO+알림(성공률·p95·$ burn·DLQ depth)·(M) W13

---

## 7. 세 가지 최고 레버리지 (Claude ⊕ Grok 공동 결론)

1. **`PAIS_PROFILE=premium-*` 하나로 검증된 스택을 켜고, JWT 강제·lease/budget 바닥값 자동 설정** — 고객에게서 플래그 매트릭스를 제거. (EASY + ACCURATE)
2. **SKU 하나를 고르고 진실을 말하라** — A(지금 폴리싱) / B(G1~G9 후) / C(G11~G14 후). 오늘 CLAUDE.md 서사를 자율/SaaS로 파는 건 부정확.
3. **돈과 신뢰를 측정 가능하게** — 기본-on 비용 캡 + 고객 지출 표면 + 릴리스 기능 광고 시 strict deploy. 없으면 마진과 브랜드가 동시에 샌다. (EFFICIENT + ACCURATE)

> 결론적으로 다음 투자처는 **검증 채널을 더 늘리는 것이 아니라, 하나의 상용 프로필 + 정직한 SKU + 기본 비용/신뢰 통제**다.
