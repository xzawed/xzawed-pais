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

### 3.3 교차 확인 (cross_check) — 항상 수행
에이전트가 다른 에이전트의 산출물을 입력으로 받으면, 작업 시작 전 **항상** 원 작성자에게 "제가 이해한 핵심이 맞나요?"를 확인한다(왜곡 방지 — 비전 원칙 #3). 예: Developer가 받은 기획을 Planner에게 확인.
- **1왕복 원칙**: B가 A에게 확인 → A가 "맞음" 또는 "이렇게 정정" 1회 응답 → B가 반영 후 작업. A의 응답이 교차 확인을 종료하므로 폭주하지 않는다.
- **첫 단계 예외**: Planner는 입력이 사용자 의도뿐이라 교차 확인 대상이 없다(모호하면 사용자에게 = 기존 clarification).
- Manager가 원 작성자를 호출해 확인받아 feed back. 깊이 상한은 능동 요청 체인과 공유.
- **트레이드오프(명시)**: 매 단계 +1 왕복(LLM 호출)으로 지연·비용이 늘지만, 사용자 요구대로 전달 정확성을 최우선한다. 비용 폭주는 1왕복 원칙 + 깊이 상한으로 막는다.

### 3.4 라우팅 (Manager)
- 위치: `xzawedManager/packages/server/src/claude/runner.ts:85-196`의 `handleAgentTool`.
- 기존 `ClarificationNeededError` catch 옆에 `AgentQueryError` 처리 추가:
  - `to:'user'` → 기존 사용자 경로.
  - `to:'<agent>'` → 해당 `RedisAgentHandler.execute()` 호출 → 응답을 질의 에이전트에 `clarificationContext`로 재주입.
- **무한 루프 방지**: 질의 체인 깊이 상한(예: 4). 초과 시 사용자 게이트로 에스컬레이션.

### 3.5 공유 위키 — 도메인 지식 베이스
위키는 단순 산출물 덤프가 아니라, **프로젝트 도메인 지식을 정리해 쌓는 베이스**다. 목적은 "각 서비스 에이전트가 업무를 수행할 때 실제로 도움이 되는 정보"를 제공하는 것 — 그래야 의미가 있다.

- 저장: 기존 PostgreSQL 인프라 재사용 — `xzawedManager/packages/server/src/db/`에 `knowledge.repo.ts` + `002_knowledge.sql`.
  ```sql
  CREATE TABLE domain_knowledge (
    id UUID PRIMARY KEY,
    project_id TEXT,       -- 프로젝트 단위 누적(세션을 넘어 강화)
    session_id TEXT,       -- 출처 세션
    author TEXT,           -- 지식을 만든 에이전트
    category TEXT,         -- decision | constraint | convention | domain_fact | ...
    title TEXT,            -- 한 줄 요약 (조회·중복판단용)
    content TEXT,          -- 정리된 도메인 지식
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```
- **수집·정리**: 에이전트의 작업이 도메인 관련 사실(결정·제약·규칙)을 만들면, 산출물에서 **도메인 지식을 추출·정리**해 기록한다. 원본 덤프가 아니라 "이 프로젝트에서 결정된 사실"을 정리된 형태로. 예:
  - `결제 PG = 토스페이먼츠 (사용자 승인 2026-06-01)`
  - `재고 표시 = 실시간 폴링 5초 주기 (Developer 확인)`
  - `인증 = JWT + refresh token`
- **추출 주체**: 에이전트가 산출물과 함께 "도메인 지식 항목"을 명시적으로 반환하거나, Manager가 산출물에서 LLM으로 추출. (구현 단계에서 선택 — 에이전트 반환을 우선 검토)
- **참조(핵심)**: 에이전트 호출 **전에** 해당 `project_id`의 도메인 지식을 조회해 입력 context에 포함한다. 에이전트는 프로젝트 도메인 규칙을 미리 알고 일관되게 작업한다 → "업무에 도움이 되는 정보". 프로젝트가 진행될수록 지식이 쌓여 강화된다.
- **범위**: P1은 추출·기록·조회(프로젝트 단위 누적). 중복 정제·충돌 해소·의미 검색(벡터)·요약 압축은 P2.
- DATABASE_URL 미설정 시: 위키 비활성(skip) — 협업(AgentQuery)은 그대로 동작. 기존 `server.ts:48-52` 조건부 패턴 따름.

## 4. 컴포넌트별 변경

| 컴포넌트 | 변경 |
|---|---|
| **xzawedShared** | 공통 `AgentQuery` 타입·스키마 추가(현재 각 에이전트가 메시지 타입을 따로 정의 → 질의 타입은 공통화) |
| **Manager `runner.ts`** | `handleAgentTool`에 `AgentQueryError` 라우팅(사용자/에이전트), 질의 체인 깊이 상한 |
| **Manager `redis-agent-handler.ts`** | `handleMessage:91-105`에 `agent_query` 응답 타입 분기 → `AgentQueryError` throw |
| **Manager `db/`** | `knowledge.repo.ts`, `002_knowledge.sql` 신규. 완료 시 도메인 지식 추출·기록, 에이전트 호출 전 `project_id`로 조회 |
| **7개 에이전트 `types.ts`** | 응답 타입에 `agent_query` 추가, `clarificationContext`·`domainKnowledge`(조회된 지식) 입력 필드 처리, 산출물에 `knowledgeItems` 반환 필드 |
| **7개 에이전트 runner** | 프롬프트에 "다른 에이전트에게 질의 가능 / 입력은 **항상** 원 작성자에게 교차 확인 / 도메인 지식 항목을 정리해 반환" 안내, 질의 응답·조회된 도메인 지식 반영 |

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
| AgentQuery(능동 요청) + **항상 수행하는 교차 확인** + Manager 라우팅 | 사용자 승인 게이트 (P3) |
| 위키: 도메인 지식 추출·정리·기록 + 프로젝트 단위 조회·활용 | 위키 중복정제·충돌해소·의미검색(벡터)·요약압축 (P2) |
| 질의 체인 깊이 상한 | 데모 렌더링(P4)·배포(P5)·VSCode(P6) |
| DATABASE_URL 조건부 위키 | 에이전트 간 직접 스트림(mesh) — 라우팅은 Manager 경유 유지 |

## 7. 성공 기준

1. 에이전트가 다른 에이전트에게 질의하고 답을 받아 작업에 반영한다(능동 요청 동작).
2. 에이전트가 다른 에이전트의 산출물을 입력받으면 작업 전 **항상** 원 작성자에게 교차 확인하고, 정정이 있으면 반영한다.
3. `to:'user'` 질의(기존 clarification)가 회귀 없이 동작한다.
4. 질의 체인이 상한을 넘으면 무한 루프 없이 사용자로 에스컬레이션한다.
5. 에이전트 작업에서 도메인 지식이 추출·정리되어 `domain_knowledge`에 기록되고, 후속 에이전트 호출 **전에** `project_id`로 조회되어 입력 context에 포함된다(DATABASE_URL 설정 시).
6. 프로젝트가 진행될수록 위키 지식이 누적되어 후속 작업에서 실제로 참조된다(도메인 강화).
7. DATABASE_URL 미설정 환경에서도 협업(AgentQuery·교차 확인)은 동작한다(위키만 skip).
8. 단위 테스트로 라우팅(사용자/에이전트), 항상 교차 확인, 깊이 상한, 위키 추출·기록·조회를 검증한다.

## 8. 위험 및 대응

- **무한 질의 루프**: 깊이 상한 + 사용자 에스컬레이션. 테스트로 강제.
- **항상 교차 확인의 비용·지연**: 매 단계 +1 LLM 왕복. 1왕복 원칙(A의 응답이 종료)·깊이 상한으로 폭주 차단. 사용자가 정확성을 위해 수용한 트레이드오프임을 명시.
- **메시지 스키마 분산**: AgentQuery·도메인 지식 항목만 공통화(xzawedShared), 나머지는 기존 유지 — 변경 최소.
- **위키 품질**: P1은 추출·기록·조회(append-only + 프로젝트 단위). 중복·충돌·노이즈 정제는 P2. 조회량이 커지면 프롬프트 컨텍스트 비대 우려 → P2에서 요약·검색으로 해소.
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
