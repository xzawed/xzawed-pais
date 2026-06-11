# P2-잔여 Wiki Agent 리스크 분류기 — 슬라이스 분해 설계

**날짜**: 2026-06-11
**상태**: 분해 승인됨(첫 슬라이스 P2r-1 = 결정론 코어로 확정)
**원천 스펙**: `docs/senario/WIKI_AGENT_RISK_CLASSIFICATION.md`(§20.2 파생)·`xzawedPAIS_handoff_spec.md` §5(라우팅)·§19(캘리브레이션 확정 대상)

## 배경

P2(분해) 잔여의 핵심 — Wiki Agent 리스크 분류기. 프로젝트를 4개 차원(domain/complexity/external_deps/compliance)으로 채점해 risk(LOW/MED/HIGH)와 5개 에이전트 모델 라우팅을 산출한다(N6: 투표는 신뢰도 신호일 뿐 사람 검토 대체 아님). **P4의 θ_risk 게이트·모델 라우팅의 입력**이라 감사가 "P4 본격화 전 선결"로 지목.

5단계: P1 분해(순수) → P2 조사(LLM·병렬·인용) → P3 claim 추출(LLM) → P4 투표(순수) → P5 채점/라우팅/게이트(순수). 결정론 경계가 명확해 기존 패턴(P2-1 분해 코어·oracleSatisfiedSet)대로 슬라이스로 나눈다.

## 슬라이스 분해

| 슬라이스 | 범위 | 패턴 | 상태 |
|---|---|---|---|
| **P2r-1** | **결정론 코어**(xzawedShared `risk/`): P4 투표 집계·confidence + P5 차원 점수·종합·라우팅·사람 게이트 순수 함수 + RiskClassification 스키마 | P2-1·oracleSatisfiedSet | **이 슬라이스** |
| P2r-2 | 영속(RiskClassification 테이블·repo·migration 011·사람 승인 전이) | task-graph/oracle repo | 후속 |
| P2r-3 | 분류 파이프라인 생산자(P2 조사·P3 추출 LLM 스테이지 + 코어 호출, flag·**§13 벌크헤드/budget 서킷 아래**·인용 해소 검증) | decompose 생산자 | 후속 |
| P2r-4 | 사람 게이트 + routing 소비(INTAKE→DECOMPOSING 전이·승인 API·강등 시 N2 사인오프) | oracle DoR 게이트 | 후속 |
| P7 | WP별 risk 재채점(PM 분해 P7에서 Wiki Agent가 부여) | — | 후속 |

## P2r-1 결정론 코어 (이 슬라이스)

`xzawedShared/src/risk/risk-classification.ts` — LLM/IO·부수효과 0. 생산자(P2r-3)가 추출·인용 검증한 claim을 넘기면 아티팩트를 조립.

- **`confidenceFromSupport(support)`**: 독립 소스 수→confidence(`min(1, support/FULL_CONFIDENCE_SUPPORT)`·FULL=3·음수 0).
- **`aggregateDimension(claims, dim)`**: noisy-OR(`1-∏(1-c)`)로 점수·평균으로 confidence. claim 없으면 {0,0}.
- **`combineRisk(scores, {complianceFrameworks})`**: 최대 차원 점수 기준 HIGH(≥0.67)/MED(≥0.34)/LOW·컴플라이언스 감지 시 바닥 MEDIUM.
- **`routeModels(risk, {complianceDetected})`**(§5): PM 항상 opus·LOW=나머지 sonnet·HIGH=전부 opus·MEDIUM=sonnet+Security 에스컬레이션.
- **`evaluateHumanGate(risk, scores, frameworks)`**(§4): HIGH·고stakes(점수≥0.34) 저confidence(<0.7)·컴플라이언스 불확실 시 required.
- **`scoreClassification(input)`**: 위를 조립 → `RiskClassification`(claim별 confidence 산정·사람 미승인 audit v1·`classifierModel:'opus'`).
- 스키마: `RiskClassificationSchema`·`ClaimSchema`·`DimensionScoreSchema`. risk 레벨은 `WpRisk`(work-package §7) 재사용.

### 캘리브레이션(§19 확정 대상·기본값)
`FULL_CONFIDENCE_SUPPORT=3`·`MEDIUM_SCORE_THRESHOLD=0.34`·`HIGH_SCORE_THRESHOLD=0.67`·`STAKES_SCORE_THRESHOLD=0.34`·`LOW_CONFIDENCE_THRESHOLD=0.7`. MEDIUM 에스컬레이션 트리거=컴플라이언스 감지(휴리스틱). 컴플라이언스 충돌 검출은 confidence proxy(후속 명시 검출).

## 검증
TDD: confidence 단조·포화·차원 noisy-OR 집계·combineRisk 임계·컴플라이언스 바닥·routeModels §5·humanGate §4·scoreClassification 조립(스키마 통과). shared 263.

## 비범위(후속 슬라이스)
조사/추출 LLM 스테이지·인용 해소(P2r-3)·영속(P2r-2)·routing 소비/사람 승인(P2r-4)·WP 재채점(P7)·구체 model id 핀(배선 시).
