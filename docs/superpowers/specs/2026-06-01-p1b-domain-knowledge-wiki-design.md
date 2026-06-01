# P1b 도메인 지식 위키 — 설계

- 작성일: 2026-06-01
- 상태: 승인됨
- 브랜치: `feat/manager/domain-knowledge-wiki`
- 범위: P1b 코어 (저장·조회·주입 + planner emit). 나머지 에이전트 확산·필터링·UI는 후속.

## 1. 목표

에이전트가 작업 중 얻은 **도메인 지식**(결정·제약·규칙)을 **프로젝트 단위로 누적**하고, 이후 에이전트 호출 시 주입해 협업 품질을 높인다. 비전의 "공유 위키에 도메인 지식을 누적해 가는 유기적 협업 조직"의 첫 구현.

확정된 핵심 결정:
- **추출 주체**: 에이전트가 직접 구조화된 지식을 반환(추가 LLM 호출 없음). 에이전트가 자기 도메인을 가장 잘 안다.
- **조회 방식**: 프로젝트 전체 최근 N건을 모든 에이전트 호출에 주입. `category` 컬럼은 향후 필터링용으로 예약(이번엔 미사용).

## 2. 현재 상태와 통합 지점 (코드 근거)

- DB 계층: `db/pool.ts`(`createPool`/`getPool`/`runMigrations`), `db/session.repo.ts`(repo 패턴), `db/migrations/001_sessions.sql`. `runMigrations`는 현재 `001_sessions.sql` 단일 파일 하드코딩 — 002 추가 필요.
- `DATABASE_URL` 선택적: `server.ts:50-52`에서 설정 시에만 pool·repo 생성. 위키도 동일하게 **조건부**.
- 스코프 키: `UserContext.projectId` (`types/user-context.ts`).
- 디스패치 단일 지점: `claude/runner.ts` `handleAgentTool` — `handler.execute(block.input, sessionId, userContext)` 호출. 주입·저장을 여기 한 곳에 둔다.
- 협업 베이스: `xzawedShared` `collaboration.ts`의 `MainOutcome` 정상 산출물(`{publishResult}`). 에이전트가 `runMain`에서 반환.

## 3. 데이터 모델

마이그레이션 `db/migrations/002_domain_knowledge.sql`:

```sql
CREATE TABLE IF NOT EXISTS domain_knowledge (
  id          BIGSERIAL PRIMARY KEY,
  project_id  TEXT NOT NULL,
  content     TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  category    TEXT,                      -- 예약(향후 필터링), 이번엔 NULL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_domain_knowledge_project
  ON domain_knowledge (project_id, created_at DESC);
```

`runMigrations`를 002도 실행하도록 확장(파일 목록 순회).

## 4. 컴포넌트

### 4.1 KnowledgeRepo (`db/knowledge.repo.ts`)
SessionRepo와 동일 패턴.
- `insertMany(projectId, entries: { content: string; sourceAgent: string }[]): Promise<void>` — 다중 INSERT(빈 배열이면 no-op).
- `recentByProject(projectId, limit): Promise<{ content: string; sourceAgent: string }[]>` — `created_at DESC LIMIT`.

### 4.2 Manager handleAgentTool (단일 지점)
- **주입(호출 전)**: projectId가 있고 repo가 있으면 `recentByProject(projectId, N)` 조회 → `block.input`의 `context.domainKnowledge`에 주입(기존 context 보존). N은 `MANAGER_WIKI_INJECT_LIMIT`(기본 20).
- **저장(게이트 통과 후)**: 게이트를 통과해 최종 확정된 `result.knowledge`(string[])를 `insertMany(projectId, entries)`. abort는 `GateAbortError` throw로 저장 안 됨. revise는 최종 result만 저장.
- repo/projectId 없으면 주입·저장 모두 skip(graceful).

### 4.3 협업 베이스 + 에이전트
- `MainOutcome` 정상 산출물 타입에 선택적 `knowledge?: string[]` 추가:
  `{ readonly publishResult: () => Promise<void>; readonly knowledge?: string[] }`.
- 에이전트 complete 메시지 payload에 선택적 `knowledge?: string[]` 포함. `RedisAgentHandler` outputSchema가 이를 surface → `handler.execute` 반환값(result)에 knowledge 포함 → Manager가 읽음.
- **walking skeleton**: planner만 knowledge 반환(generatePlan 결과에서 결정·제약을 string[]로). 주입은 모든 에이전트에 공통 적용(context.domainKnowledge). 나머지 6개 emit은 후속 PR(공유 베이스라 확산 단순).

## 5. 데이터 흐름

```
agent 호출
  → KnowledgeRepo.recentByProject(projectId, N)
  → block.input.context.domainKnowledge 주입
  → agent 실행(주입된 지식 활용) → 결과 + knowledge[] 반환
  → 승인 게이트 통과
  → KnowledgeRepo.insertMany(projectId, knowledge)
  → 다음 단계가 조회 시 누적분 반영
```

## 6. 에러 처리
- `DATABASE_URL` 미설정 또는 projectId 없음 → 위키 전체 no-op(에이전트 흐름 정상).
- DB 쿼리 오류 → 로그 후 계속(에이전트 흐름 차단 금지, session.repo 패턴 동일).
- knowledge 파싱 실패(타입 불일치) → 해당 항목 skip.

## 7. 테스트
- `KnowledgeRepo` 단위: insertMany(빈 배열 no-op 포함)·recentByProject (pg pool mock).
- runner: 주입 경로(repo.recentByProject 호출·context.domainKnowledge 주입), 저장 경로(게이트 통과 후 insertMany 호출, abort 시 미호출), repo 없을 때 skip.
- 협업 베이스: runMain이 knowledge 반환 시 outcome에 포함.
- planner: generatePlan 결과에서 knowledge 추출.

## 8. 범위 경계 (YAGNI)

| 포함 (P1b 코어) | 제외 (후속) |
|---|---|
| domain_knowledge 테이블·repo·마이그레이션 | category 필터링 |
| 주입(최근 N) + 저장(게이트 후) | 키워드/임베딩 검색 |
| 협업 베이스 knowledge 반환 타입 | 위키 뷰어 UI |
| planner emit(walking skeleton) | 나머지 6개 에이전트 emit 확산 |

## 9. 성공 기준
1. planner가 반환한 지식이 프로젝트 단위로 저장된다.
2. 이후 에이전트 호출에 최근 N건이 `context.domainKnowledge`로 주입된다.
3. `DATABASE_URL` 미설정 시 위키가 비활성화되며 기존 흐름이 깨지지 않는다(회귀 없음).
4. abort 시 지식이 저장되지 않는다.
5. 단위 테스트로 주입·저장·skip 경로를 검증한다.

## 10. 후속 (별도 사이클)
- 나머지 6개 에이전트 knowledge emit 확산(공유 베이스 활용).
- category/tags 필터링, 키워드·임베딩 검색.
- 위키 뷰어 UI(Orchestrator), 지식 편집·삭제.
