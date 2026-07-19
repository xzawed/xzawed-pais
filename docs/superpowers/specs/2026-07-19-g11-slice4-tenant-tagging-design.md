# G11 Slice 4 — Manager 쓰기 태깅 (tenant_id) 설계

- 상태: 설계 승인 완료(사용자 승인·2026-07-19)
- 날짜: 2026-07-19
- 관련: [G11 멀티테넌트 경계](2026-07-19-g11-tenant-boundary-design.md) Slice 4
- 선행: Slice 0(#458 IDOR 폐색)·Slice 1(#459 신원)·Slice 2(#461 프로젝트 org 소유권)·Slice 3(#462 UserContext.tenantId 캐리어) — 전부 머지(master 00e9613)

## 목적

Manager가 쓰는 데이터 행에 **테넌트 귀속을 기록한다**. 읽기 격리는 하지 않는다.

Slice 4는 "격리"가 아니라 **Slice 4b(읽기 격리)가 추가 마이그레이션 없이 순수 술어 추가로 끝나게 만드는 데이터 토대**다. 이 정의를 문서에 그대로 쓴다 — 저장소의 정직성 규약상 `docs/LIVE_VS_FLAGGED.md`에 "태깅만·enforcement 0"을 명시해야 "✅"가 격리로 오인되지 않는다.

## 조사 근거 (33-에이전트 Workflow·137개 사실·25건 적대 검증→8건 정정)

### 출발점: tenantId는 아직 아무도 읽지 않는다

Manager 비-테스트 소스에서 `tenantId`가 등장하는 곳은 `types/user-context.ts:10` **단 하나**이고, 필드를 읽거나 분기하거나 기록하는 코드는 0곳이다. 참고할 기존 tenant 술어가 저장소에 하나도 없다. Slice 4는 "연결"이 아니라 **최초 소비 지점 신설**이다.

단 tenantId는 `userContext` 객체의 승객으로서 이미 물리적으로 두 곳에 도달해 있다 — `task_graphs.graph_dag` JSONB(`task-graph.repo.ts:78-81`)와 7개 에이전트 아웃바운드 페이로드(`tools/redis-agent-handler.ts:74-75`가 userContext를 통째로 spread).

### 설계를 좌우한 제약

| # | 제약 | 근거 | 이 설계에 미친 영향 |
|---|---|---|---|
| C1 | Manager↔Orchestrator DB는 **런타임만 공유·CI는 분리** | `docker-compose.yml:83`("postgres 공유 DB" 주석)·CI는 잡마다 격리 pg에 Manager 마이그레이션만 적용 | 크로스 서비스 조인 백필은 프로덕션에선 되고 **CI에선 전 통합 스위트가 죽는다**. `server.ts:80`이 try/catch 없이 `runMigrations` 호출 → 마이그레이션 실패 = 기동 실패 → **백필 전면 배제** |
| C2 | Manager 러너는 **버전 추적 없이 매 기동 전량 재실행** | `pool.ts:55-76`(readdir→sort→전부 apply·`schema_migrations` 없음·advisory lock 729431 + 40P01/40001 재시도 #403) | Orchestrator 007/008 백필 패턴 복사 금지. **백필 배제의 두 번째 독립 근거** |
| C3 | migration이 enforcement의 **전제가 아니다** | `release-gate.repo.ts:111`이 이미 `graph_dag->'userContext'->>'projectId'`로 운영 중 | 4b는 DDL 0줄로도 가능. 이번 컬럼 추가는 인덱스 성능·JSONB 없는 테이블 커버를 위한 **선택**이며 그렇게 문서화한다 |
| C5 | `upsertGraph`의 `ON CONFLICT DO UPDATE`가 `graph_dag`를 **통째 교체** | `task-graph.repo.ts:83-90` | 재분해가 tenantId 없이 오면 테넌트 유실(P4a-2 userContext 유실과 동형) → **COALESCE 보존 규칙 필수** |
| C6 | Manager엔 `authUser` 객체가 **없다** | `jwt.plugin.ts:12-25`(`verifyServiceToken`은 `jwtVerify()`만 수행) | 태그를 HTTP 요청자로부터 얻을 수 없다 → **소스는 페이로드(userContext)뿐** |
| C7 | tenantId **부재가 정상 상태** | Orchestrator `sessions.route.ts:107·117` 조건부 spread. 부재 3경우 = pool 없음 / 프로젝트 미소유·미존재 / `users.org_id` NULL | 태그 컬럼은 nullable, 인자는 **nullable-but-required** |

### 정정된 가정 (적대 검증 결과)

- ~~"Slice 4는 migration이 반드시 필요하다"~~ → **반증**(C3).
- ~~"테스트 churn이 ~28파일"~~ → **반증**. 그 수치는 *언급 횟수*였다. 실제 호출부 실측:

  | 메서드 | 프로덕션 호출 | 테스트 파일 |
  |---|---|---|
  | `createRequest` | 9곳 | 4개 |
  | `upsertGraph` | 1곳 | 1개 |
  | `recordEvidence` | 1곳 | 1개 |
  | `upsertDraft` | 1곳 | 2개 |
  | `recordFindings` | 1곳 | 0개 |
  | `insertMany` | 2곳 | 1개 |

  실제 churn은 **테스트 ~9파일**. 이 정정이 아래 "필수 인자" 결정을 뒤집었다.

## 설계

### 1. 스키마 — migration 017 (10개 테이블·백필 0·인덱스 0)

```sql
-- 017_tenant_tagging.sql
-- G11 Slice 4 — 쓰기 태깅(enforcement 0). legacy 행은 NULL 유지(백필 없음).
ALTER TABLE task_graphs             ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE wp_state_log            ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE wp_leases               ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE oracles                 ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE decision_requests       ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE risk_classifications    ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE advisory_findings       ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE wp_verification_results ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE release_gates           ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE domain_knowledge        ADD COLUMN IF NOT EXISTS tenant_id TEXT;
```

세 가지 의도적 결정:

- **백필 없음.** C1·C2 두 독립 근거. `015_decision_requests_project_id.sql`이 "legacy 행은 NULL" 주석과 함께 선례를 만들어 뒀다.
- **인덱스 없음.** tenant_id를 질의하는 코드가 0줄이므로 지금 인덱스는 순수 비용이다. 4b에서 술어와 함께 추가한다. (015가 인덱스를 같이 넣은 건 `pendingByProject`가 즉시 질의했기 때문 — 여기엔 해당 없음.)
- **플래그 없음.** Slice 1/2/3과 같은 순수 additive·enforcement 0. tenantId 부재 시 NULL이 들어가며 이는 기존 동작과 동일하다. 부수 효과로 OutboxRelay 배선 함정(`server.ts:220-233`의 14-flag OR에 새 flag를 빠뜨리면 이벤트가 `published_at=NULL`로 영구 무음 잔류)을 통째로 회피한다.

### 2. 태깅 소스

`userContext.tenantId` (Slice 3 캐리어)가 **유일한 소스**다. DB 조회 0·크로스 서비스 조인 0. 이것이 C1의 CI 함정을 원천 차단한다.

### 3. 저장소별 배선

모든 경로를 실측했다(file:line은 검증된 값).

| 테이블 | 등급 | 스레딩 경로 |
|---|---|---|
| `task_graphs` | 원천 | `PersistGraphInput.userContext`에 이미 존재 → **새 인자 없이** 저장소 내부에서 파생 |
| `wp_leases` · `wp_state_log` | A | `dispatch.ts:100` getGraph 직후(`:139`가 이미 projectId 사용 중) |
| `oracles` | A | decomposition consumer의 `upsertDraft` |
| `decision_requests` | 혼합 | `createRequest` 9 호출부 — 아래 별도 표 |
| `risk_classifications` | A | `decompose/risk-producer.ts` upsert 경로 |
| `wp_verification_results` | A | `worker.ts:185` `userContext` → `persistVerificationEvidence`로 **인자 1개 스레딩** → `:272` `recordEvidence` |
| `release_gates` | A | `completion.ts:52`가 **이미 `getGraph`를 호출**해 `stored`를 갖고 있다 → `:59` `recordGate`에서 파생. **새 배관 0** |
| `domain_knowledge` | A | `claude/runner.ts:381·397` — 이미 `insertMany(userContext.projectId, …)`로 userContext 사용 중 |
| `advisory_findings` | C→A | `worker.ts:185` userContext를 `maybeProduceAdvisory`로 스레딩 — **형제 함수 `maybeRequestGoldenSignoff(:301)`가 이미 정확히 이 패턴으로 userContext를 받는다**. DB 왕복 0 |

**getGraph 역방향 조회를 신설할 곳이 한 곳도 없다.** 모든 태그 소스가 이미 스코프에 있거나 인자 1개 스레딩으로 닿는다.

#### `decision_requests` 9 호출부 — 태그 소스가 두 종류다

| 호출부 | 태그 소스 |
|---|---|
| `decompose/risk-producer.ts:69` | 분해 경로 userContext |
| `decompose/trigger.ts:51` | 분해 경로 userContext |
| `streams/decomposition-consumer.ts:113` (decompose_inconsistent) | 분해 경로 userContext |
| `streams/decomposition-consumer.ts:167` (oracle brief) | 분해 경로 userContext |
| `streams/worker.ts:309` (golden brief) | `userContext`(이미 인자로 받는 중) |
| `streams/decision-brief.ts:91` (defect brief) | `GraphQueryPort` 확장 |
| `streams/signoff-brief.ts:62` (release signoff) | `GraphQueryPort` 확장(`resolveProjectId`와 동일 경로) |
| `streams/degraded-signoff-brief.ts:47` (N2) | `GraphQueryPort` 확장 |
| **`streams/decision-expiry-consumer.ts:81` (B1 재에스컬레이션)** | **원 요청 행의 `tenant_id`를 복사** — userContext가 아니다 |

⚠️ **마지막 항목이 이 설계에서 유일하게 소스가 다른 지점이다.** B1은 만료된 blocking 결정을 새 PENDING으로 재생성하며 원 요청의 wpId/projectId를 복사하는데, 테넌트도 같은 방식으로 복사해야 한다. userContext는 이 소비자의 스코프에 없고, 있더라도 **원 요청의 테넌트가 정답**이다.

이를 위해 `DecisionRepo`의 읽기 경로(`rowToRequest`·`expiredPendingRequests`)가 `tenant_id`를 실어 나르도록 확장해야 한다. 이 한 줄을 빠뜨리면 재에스컬레이션된 결정만 영구 NULL로 남으며, **이는 §5가 막으려는 무음 누락의 정확한 사례다** — 컴파일러가 인자를 강제하더라도 *올바른 값의 출처*는 강제하지 못하므로, 이 경로는 전용 테스트로 고정한다(검증 ①).

`GraphQueryPort`(`lease.ts:7-9`) 확장은 additive optional이다:

```ts
export interface GraphQueryPort {
  getGraph(workflowId: string): Promise<{
    userContext: { projectId: string; tenantId?: string } | null
  } | null>
}
```

구조적 좁은 포트이므로 `{ userContext: { projectId: 'p1' } }`를 반환하는 기존 mock이 그대로 만족한다. `signoff-brief.ts:42`와 공유되므로 1회 확장으로 둘 다 해결된다.

### 4. C5 유실 방어

10개 테이블 중 upsert 의미론(`ON CONFLICT DO UPDATE`)을 쓰는 건 `task_graphs`·`oracles`·`risk_classifications` 3개뿐이므로 이 3개에 보존 규칙을 명시한다(예시는 `task_graphs`):

```sql
ON CONFLICT (workflow_id) DO UPDATE
  SET graph_dag  = EXCLUDED.graph_dag,
      tenant_id  = COALESCE(EXCLUDED.tenant_id, task_graphs.tenant_id),
      event_id   = EXCLUDED.event_id,
      version    = task_graphs.version + 1,
      updated_at = NOW()
```

한 번 붙은 테넌트는 tenantId 없는 재분해가 와도 지워지지 않는다. `oracles`(`upsertDraft`)·`risk_classifications`(`upsert`)도 같은 이유로 동일한 COALESCE 보존 규칙을 쓴다. 나머지 7개 테이블은 `ON CONFLICT ... DO NOTHING`이거나(5개) `ON CONFLICT` 절이 아예 없어(`wp_state_log`·`domain_knowledge` — append-only INSERT) COALESCE가 애초에 적용 불가하며, 태그가 자연히 멱등이다.

### 5. 인자 계약 — required-but-nullable

새로 추가하는 저장소 인자는 **`tenantId: string | null`(필수·null 허용)** 이다. optional(`tenantId?: string`)이 아니다.

근거 넷:

1. **`createRequest` 9 호출부가 정확히 무음 누락이 일어나는 형태다.** 결정 브리프 종류는 defect·risk·oracle·golden·signoff·degraded·decompose_inconsistent로 계속 늘어나 왔고 앞으로도 늘어난다. optional이면 새 브리프 추가자가 빠뜨려도 컴파일이 통과하고 그 결정 타입만 영구 NULL로 남는다. **그 버그는 4b에서 격리를 켤 때 처음 드러난다** — 그 시점엔 "이 테이블은 태그가 반쯤 없으니 fail-open해야 한다"가 되어 Slice 4의 가치가 소급 무효화된다.
2. **이 저장소에 정확히 이 실패의 사체가 있다.** `x-actor-id`는 "Orchestrator 프록시가 전달"이라고 주석까지 달렸지만 실제 전파는 0건이다. optional + 문서화 = 안 배선됨의 실물 증거다.
3. **nullable이 C7을 정직하게 표현한다.** 부재는 버그가 아니라 정상이다. `string | null`은 각 호출부에 "여기 테넌트가 있는가"를 명시적으로 답하게 강제하되, 없을 때 가짜 값을 지어내게 하지 않는다. required non-nullable이면 `?? ''` 같은 거짓말이 끼어든다.
4. **컴파일러는 공짜고 테스트는 유료다.** optional은 "테스트로 막는다"는 약속에 의존하는데, 그 테스트는 나중에 지워지거나 새 호출부를 커버하지 않는다. 타입은 잊히지 않는다.

보완 원칙 — **저장소 메서드가 이미 userContext(또는 그것을 담은 input 객체)를 인자로 받고 있으면 새 인자를 만들지 않고 메서드 내부에서 파생한다.** 새 인자가 없으면 누락이 구조적으로 불가능하다.

현재 이에 해당하는 곳은 `TaskGraphRepo.upsertGraph`(`PersistGraphInput.userContext`) **하나뿐**이다. 나머지 저장소 메서드는 workflowId·wpId 같은 스칼라만 받으므로 `tenantId: string | null`을 새로 추가한다. 값은 호출부가 스코프의 userContext에서 꺼내 넘긴다(§3 표).

## 검증

### ① 저장소 단위 pg 통합 테스트

10개 테이블 각각 2케이스. 기존 관용구(`describe.skipIf(!url)`, `TEST_DATABASE_URL ?? DATABASE_URL`)를 그대로 쓴다.

- tenantId 주입 → 행의 `tenant_id` 일치
- tenantId `null` → NULL 기록 + 기존 동작 보존

두 경로는 전용 케이스를 추가한다:

- **`task_graphs` 재분해 COALESCE 보존** — 태그된 행에 `tenantId: null`로 재upsert 했을 때 기존 값이 살아남는지. §4가 실제로 작동하는지 확인하는 유일한 테스트다.
- **B1 재에스컬레이션 테넌트 승계** — 태그된 blocking 결정을 만료시켜 `decision-expiry-consumer`가 새 PENDING을 만들었을 때, 새 행의 `tenant_id`가 **원 요청의 값과 같은지**. §3의 "소스가 다른 유일한 지점"을 고정한다.

### ② G9 아크 E2E 전파 단언

`premium-profile-e2e.integration.test.ts:77` fixture에 tenantId를 실어 `decompose → graph_dag → dispatch(wp_leases) → verify(wp_verification_results)`까지 태그가 실제로 박히는지 end-to-end로 단언한다.

이것이 §5 결정의 백스톱이다 — 타입이 "호출부가 값을 넘겼다"를 보장하고, 이 테스트가 "그 값이 DB까지 도달했다"를 보장한다.

⚠️ 이 파일은 전용 `manager-redis-integration` 잡에서만 돌고 `turborepo` 잡에선 skip된다. PR 전 두 잡을 모두 확인한다.

### ③ 마이그레이션 멱등성 정적 가드 이식

Orchestrator의 `migrate-idempotent.test.ts`(무DB 정적)를 Manager로 이식해 017 포함 전 마이그레이션의 `IF NOT EXISTS` 관례를 강제한다. C2 때문에 Manager가 훨씬 더 필요한 쪽인데 없었다(#457 선례).

### 회귀 방어 게이트

PR 전 `git show --stat`으로 테스트 파일 증감을 확인한다. 이 저장소는 대량 테스트 수정에서 두 번 사고가 났다 — #339(구현자가 기존 테스트를 덮어씀→복원)·#295(subagent 무음 삭제→`git show --stat`으로 적발).

## 범위 밖 — 명시적 비-목표

| 항목 | 왜 제외 | 어디로 |
|---|---|---|
| 읽기 술어·격리 | 이 슬라이스의 정의상 비-목표 | Slice 4b |
| 백필 | C1(CI 분리 DB)·C2(매 기동 재실행) | 영구 제외(legacy NULL) |
| 크로스 서비스 조인(users/tenants/projects) | 태깅 소스가 페이로드뿐이라 불필요. Manager 소스에 이 조인은 0건이며 서비스 경계 위반이 된다 | 소멸 |
| 전역 sweep 3종 | 성격이 격리가 아니라 **공정성** — 한 테넌트의 PENDING 폭주가 다른 테넌트의 LIMIT 슬롯을 굶긴다(`expiredActiveLeases`·`expiredPendingRequests`·`replaySessions`는 인자에 workflowId조차 없다) | Slice 5 계열 |
| `manager_events`/`manager_outbox` | INSERT가 7곳에 복제돼 있어 공용 `appendEvent` 헬퍼 추출이 선행 | 별도 PR |
| 인덱스 | 질의 0줄 | 4b |
| 무인증 GET 3종 잠금 | oracle-tier 개방 포스처는 제품 결정 | 별도 |

### 별도 로드맵 항목 — 조사 중 발견한 실제 보안 구멍

태깅으로는 **하나도 고쳐지지 않는다.** 이번 PR 범위 밖이되 다음 슬라이스 후보로 기록한다.

- `PATCH /oracles/:oracleId/approve` → `OracleRepo.approve(oracleId)` — projectId 파라미터 **자체가 없다**. 서비스 토큰만 통과하면 임의 워크플로의 오라클 승인 가능.
- `PATCH /workflows/:workflowId/risk-classification/approve` — 소유권 검증 0. 승인이 wp.risk write-back → mutation 게이트 발화로 실행 경로까지 전파된다.
- `hasApprovedReleaseSignoff` / `hasApprovedDegradedDispatch` — workflowId만 확인. 교차 사인오프가 배포 게이트를 열 수 있다.

## 산출물

- `017_tenant_tagging.sql` + 저장소 10곳 + 호출부 ~15곳 + 테스트 ~9파일 수정/추가
- `docs/LIVE_VS_FLAGGED.md` — "G11 Slice 4 = 태깅만·enforcement 0"
- 루트 `CLAUDE.md` · `xzawedManager/CLAUDE.md` — 서비스 표·테스트 수 갱신
- 이 설계 문서 + 메모리 갱신

**PR 1개. flag 0 · 이벤트 0 · 읽기 술어 0 · 백필 0.** "off" 개념이 없다 — 항상 태깅하며 tenantId가 없으면 NULL이 들어갈 뿐이다.

## 불변식

- 단일 사용자 배포의 **런타임 동작은 바이트 동일**하다. 유일한 관측 가능 변화는 새 컬럼에 값이 기록된다는 것뿐이며, 이를 읽는 코드는 0줄이다.
- AUTH=jwt 전제(AUTH=none 로컬은 테넌트 무의미·기존 폴백 보존).
- Slice 4b가 이 토대 위에 순수 술어 추가로 올라간다 — 추가 마이그레이션 없이.
