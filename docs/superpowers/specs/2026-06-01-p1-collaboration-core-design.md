# P1 협업 코어 — 설계

- 작성일: 2026-06-01
- 상태: 승인 대기
- 상위: [플랫폼 비전](2026-06-01-platform-vision.md) 의 **Phase 1**
- 브랜치: `feat/platform-collaboration-vision`

## 1. 목표

에이전트들이 **능동적으로 협업**하고 **서로 교차 검증**하며, 산출물을 **공유 위키에 누적**하도록 한다. 비전의 "유기적 협업"을 떠받치는 기반.

세 가지를 구현한다:
1. **능동 요청** — 에이전트가 작업 중 다른 전문가의 입력이 필요하면 직접 요청한다.
2. **교차 확인** — 에이전트가 받은 입력이 원 작성자의 의도와 맞는지 직접 확인한다(Manager 중계 왜곡 방지).
3. **공유 위키(최소)** — 산출물·결정을 기록하고, 작업 시 관련 지식을 참조한다.

## 2. 핵심 통찰 — 이미 있는 메커니즘의 일반화

조사 결과, 에이전트→사용자 질의(`ClarificationNeeded`) 경로가 완비돼 있다:

```
Planner가 ClarificationNeeded 생성 (xzawedPlanner/src/claude/runner.ts:53-127)
  → info_request 발행 (planner.ts:19-34)
  → Manager가 ClarificationNeededError로 catch (redis-agent-handler.ts:95-99)
  → 사용자에게 info_request 중계 (runner.ts:148-160)
  → waitForInfo 대기 (runner.ts:161)
  → clarificationContext로 에이전트 재실행 (runner.ts:166-170)
```

이 "질의 → 대기 → 응답 → 재실행" 패턴을 **일반화**하면 협업이 된다. 질의 대상이 `사용자`면 지금처럼, `다른 에이전트`면 그 에이전트에게 라우팅하면 된다. → **AgentQuery** 추상화.

## 3. 핵심 설계 — AgentQuery

### 3.1 추상화
```ts
interface AgentQuery {
  from: string          // 질의한 에이전트 (예: 'developer')
  to: 'user' | string   // 대상: 'user' 또는 에이전트명 (예: 'designer')
  question: string
  context?: unknown      // 무엇에 대한 질의인지 (산출물 참조 등)
  kind: 'active_request' | 'cross_check'  // 능동 요청 / 교차 확인
}
```
- `to: 'user'` → 기존 사용자 질의 경로 그대로(하위호환).
- `to: '<agent>'` → Manager가 대상 에이전트를 호출(기존 `RedisAgentHandler` 재사용)하고, 응답을 질의한 에이전트에 `clarificationContext`로 돌려준다(기존 재실행 경로 재사용).

### 3.2 능동 요청 (active_request)
에이전트가 작업 중 다른 전문가 입력이 필요할 때. 예: Designer가 "실시간 재고 표시 가능한가?"를 Developer에게.
- Designer runner가 `AgentQuery{ to:'developer', kind:'active_request', question }` 반환.
- Manager가 Developer를 호출해 답을 받아 Designer에 feed back → Designer가 답을 반영해 작업 계속.

### 3.3 교차 확인 (cross_check)
에이전트가 받은 입력이 원 작성자 의도와 맞는지 확인. 예: Developer가 받은 기획을 "제가 이해한 게 맞나요?"로 Planner에게.
- 조건부로만 발동(항상 하면 비용·지연 과다): 입력이 모호하거나 핵심 결정이 걸릴 때. 판단은 에이전트 runner의 프롬프트가 안내.
- Manager가 원 작성자(Planner)를 호출해 확인받아 feed back.

### 3.4 라우팅 (Manager)
- 위치: `xzawedManager/packages/server/src/claude/runner.ts:85-196`의 `handleAgentTool`.
- 기존 `ClarificationNeededError` catch 옆에 `AgentQueryError` 처리 추가:
  - `to:'user'` → 기존 사용자 경로.
  - `to:'<agent>'` → 해당 `RedisAgentHandler.execute()` 호출 → 응답을 질의 에이전트에 `clarificationContext`로 재주입.
- **무한 루프 방지**: 질의 체인 깊이 상한(예: 4). 초과 시 사용자 게이트로 에스컬레이션.

### 3.5 공유 위키 (최소 형태)
- 저장: 기존 PostgreSQL 인프라 재사용 — `xzawedManager/packages/server/src/db/`에 `knowledge.repo.ts` + `002_knowledge.sql`.
  ```sql
  CREATE TABLE domain_knowledge (
    id UUID PRIMARY KEY,
    session_id TEXT,
    author TEXT,           -- 작성 에이전트
    category TEXT,         -- plan | design | decision | cross_check | ...
    content TEXT,          -- 산출물·결정 원본
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```
- 기록: 각 에이전트 완료 시 Manager가 산출물을 `domain_knowledge`에 기록(원본 그대로).
- 참조: 에이전트 호출 시 관련 지식을 조회해 입력 context에 포함 → **왜곡 방지(원본 참조)** + 지식 누적.
- DATABASE_URL 미설정 시: 위키 비활성(인메모리 폴백 또는 skip) — 기존 `server.ts:48-52` 조건부 패턴 따름.

## 4. 컴포넌트별 변경

| 컴포넌트 | 변경 |
|---|---|
| **xzawedShared** | 공통 `AgentQuery` 타입·스키마 추가(현재 각 에이전트가 메시지 타입을 따로 정의 → 질의 타입은 공통화) |
| **Manager `runner.ts`** | `handleAgentTool`에 `AgentQueryError` 라우팅(사용자/에이전트), 질의 체인 깊이 상한 |
| **Manager `redis-agent-handler.ts`** | `handleMessage:91-105`에 `agent_query` 응답 타입 분기 → `AgentQueryError` throw |
| **Manager `db/`** | `knowledge.repo.ts`, `002_knowledge.sql` 신규. 완료 시 기록·호출 시 조회 |
| **7개 에이전트 `types.ts`** | 응답 타입에 `agent_query` 추가, `clarificationContext` 입력 필드 처리 |
| **7개 에이전트 runner** | 프롬프트에 "다른 에이전트에게 질의 가능 / 모호하면 교차 확인" 안내, 질의 응답(`clarificationContext`) 반영 |

## 5. 데이터 흐름 (예: 디자인 중 능동 요청)

```
사용자 입력 → Manager Claude 루프 → design_ui 호출
  → Designer 실행 중 "실시간 재고 표시 가능?" 판단
  → AgentQuery{from:designer, to:developer, kind:active_request, question}
  → Manager: Developer 호출 → "가능, 단 폴링 주기 5s" 응답
  → 응답을 Designer에 clarificationContext로 재주입 → Designer 디자인 반영·완료
  → 산출물을 domain_knowledge에 기록
  → (다음 단계로)
```

## 6. 범위 경계 (YAGNI)

| 포함 (P1) | 제외 (후속) |
|---|---|
| AgentQuery(능동 요청·교차 확인) + Manager 라우팅 | 사용자 승인 게이트 (P3) |
| 위키 최소: 산출물 기록 + 원본 참조 | 위키 검색·정제·벡터화·도메인 강화 고도화 (P2) |
| 질의 체인 깊이 상한 | 데모 렌더링(P4)·배포(P5)·VSCode(P6) |
| DATABASE_URL 조건부 위키 | 에이전트 간 직접 스트림(mesh) — 라우팅은 Manager 경유 유지 |

## 7. 성공 기준

1. 에이전트가 다른 에이전트에게 질의하고 답을 받아 작업에 반영한다(능동 요청 동작).
2. 에이전트가 받은 입력을 원 작성자에게 교차 확인할 수 있다.
3. `to:'user'` 질의(기존 clarification)가 회귀 없이 동작한다.
4. 질의 체인이 상한을 넘으면 무한 루프 없이 사용자로 에스컬레이션한다.
5. 산출물이 `domain_knowledge`에 기록되고, 후속 에이전트 호출 시 참조된다(DATABASE_URL 설정 시).
6. DATABASE_URL 미설정 환경에서도 협업(AgentQuery)은 동작한다(위키만 skip).
7. 단위 테스트로 라우팅(사용자/에이전트), 깊이 상한, 위키 기록·조회를 검증한다.

## 8. 위험 및 대응

- **무한 질의 루프**: 깊이 상한 + 사용자 에스컬레이션. 테스트로 강제.
- **교차 확인 남발로 지연**: 조건부 발동(모호·핵심 결정 시). 프롬프트로 안내, 기본은 절제.
- **메시지 스키마 분산**: AgentQuery만 공통화(xzawedShared), 나머지는 기존 유지 — 변경 최소.
- **위키 일관성**: P1은 append-only 기록. 정제·중복제거는 P2.
- **DB 의존**: 조건부(DATABASE_URL) — 미설정 시 협업은 유지, 위키만 비활성.

## 9. 구현 단계 제안 (writing-plans에서 상세화)

- **P1a — AgentQuery 메커니즘**: 공통 타입(xzawedShared) → Manager 라우팅 → 에이전트 질의 능력. 위키 없이 협업부터.
- **P1b — 공유 위키(최소)**: `knowledge.repo` + 마이그레이션 + 기록·조회.

각 단계는 기존 테스트 패턴(BaseConsumer mock, setImmediate, safeParse)을 따르고, `pr-ready` 통과 후 PR.

## 10. 재사용 자산 (신규 작성 최소화)

- `ClarificationNeeded`/`ClarificationNeededError` — AgentQuery로 일반화
- `waitForInfo`/`resolveInfo` — 질의 대기/응답
- `clarificationContext` 재실행 경로 — 질의 응답 feed back
- `RedisAgentHandler` — 대상 에이전트 호출
- PostgreSQL `pool.ts`/`session.repo.ts` 패턴 — 위키 저장소
