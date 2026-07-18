# G11 — 멀티테넌트 경계 (Tier-2 첫 하위시스템) 설계

- 상태: 설계 승인 대기(사용자 리뷰)
- 날짜: 2026-07-19
- 관련: Tier-2 G11(joint verification 로드맵·멀티테넌트 SaaS SKU)
- 선행: Tier-0(G1~G5)·Tier-1(G6~G10) 완료

## 목적

xzawedPAIS를 멀티테넌트 SaaS로 제공하기 위한 **테넌트 경계 토대**를 도입한다. 현재 테넌트/조직 개념은 코드 전체에 0건(그린필드)이며, 유일 소유 축은 `userId`(Orchestrator)·`workflowId`/`projectId`(Manager)다.

## 확정 결정 (사용자 승인)

- **테넌트 모델 = C**: `users.org_id`(사용자당 단일 org·가입 시 개인 org 자동 생성) + **row-level tenant_id 애플리케이션 필터**. 팀 초대·RBAC(org_members)는 후속(B로 승격 시 org_id는 "primary org"로 잔존).
- **API 키 전략 = 플랫폼 키 + per-tenant 비용귀속/쿼터**: 플랫폼 단일 `ANTHROPIC_API_KEY` 유지, budget 서킷을 tenant 버킷+per-tenant cap으로 tenant화. BYOK(테넌트 자기 키)는 후속(G13).

## 확정된 사실 (조사 근거)

- **테넌트 부재**: `tenant|org_id|organization` grep이 4개 서비스 소스에서 0건. JWT `AccessTokenPayload = {sub, email, displayName}`(tokens.ts:4-8)에 org claim 없음.
- **소유권 primitive 존재**: `assertProjectOwner`(auth/ownership.ts:5-18) + `ProjectRepo.findByIdAndUser`(project.repo.ts:148-155). projects·sessions 라우트는 이걸로 게이팅.
- **⚠️ 기존 IDOR(테넌시 무관하게 오늘 취약)**: `knowledge.route.ts`(쓰기)·`decisions.route.ts`(POST)가 `:projectId`를 Manager로 프록시하며 **로그인만 확인·프로젝트 소유권 미확인** → cross-user 유출. 이 지점이 테넌시가 `assertProjectInOrg`로 일반화할 seam.
- **캐리어 존재**: `UserContext`(user-context.ts:4-13)·`EventEnvelope`(event-envelope.ts:11-26)·`buildUserContext`(sessions.route.ts:92-110)가 tenant_id를 서비스 간 자동 전파할 배관. 단 UserContext는 3+곳 drift(단일 출처화 필요).
- **단일 API 키**: 9곳 클라이언트 생성부가 정적 `ANTHROPIC_API_KEY` 주입. budget-circuit.ts:98 `Map<workflowId, number>` 누적(tenant 차원 0).

## 슬라이스 계획 (각 회귀-0·additive-flag)

### Slice 0 — 쓰기 IDOR 폐색 (독립·제품결정 무관·첫 PR)
- `knowledge.route.ts`(PATCH/DELETE)·`decisions.route.ts`(POST)에 Manager 프록시 **앞** `assertProjectOwner(projectId, authUser.sub)` 삽입(기존 primitive 재사용).
- **정상 소유자 회귀 0**(자기 프로젝트는 통과)·cross-user만 차단. 테넌시 seam 확립.
- ⚠️ **읽기(GET) 오픈은 범위 밖**(현재 "비인증 PO 도구" 의도 — 잠금은 enforcement 슬라이스의 제품결정). Slice 0은 인증된-쓰기 IDOR만.

### Slice 1 — 신원 (tenants + users.org_id + JWT claim·enforcement 0)
- migration: `tenants(id, name, created_at)` + `users.org_id`(nullable FK). register 시 개인 org 자동 생성·user.org_id 세팅·기존 user 백필(개인 org).
- `AccessTokenPayload`에 `orgId` 추가(tokens.ts) + auth.route.ts 3 발급부(register/login/refresh) 주입.
- `user-auth.hook.ts`가 `req.authUser.orgId` 노출.
- **쿼리 필터·데이터 tenant_id 컬럼 없음** → 기존 경로 바이트 동일(orgId는 실려 흐르나 아무것도 필터 안 함). 생산자-먼저·enforcement-나중(P2r/P5 패턴 동형).

### Slice 2 — 소유권 경계 (Orchestrator·flag)
- `assertProjectOwner`→`assertProjectInOrg(orgId, projectId)` 확장(Slice 0 게이트 승격). `project.repo`: `findByIdAndOrg`·create에 org_id·`UNIQUE(org_id, slug)`. projects.org_id 컬럼 + 백필.

### Slice 3 — 전파 캐리어 (UserContext.tenantId)
- `UserContext`에 tenantId 추가(**단일 계약 출처화 선행** — Manager·Orchestrator·7에이전트 drift 해소) → buildUserContext → task/decompose payload → graph_dag 영속까지 자동 전파. `EventEnvelope`에도 tenantId(enveloped 스트림 자동 운반).

### Slice 4 — Manager 저장소 술어 (flag)
- Manager repo에 `WHERE tenant_id=$` 추가(knowledge·decision·risk는 projectId 있음 → tenant_id 병행). task_graphs·oracles 등 후속.

### Slice 5 — per-tenant 비용 버킷 (플랫폼 키·flag)
- budget-circuit을 `Map<tenantId, number>` 버킷+per-tenant cap으로. runner record를 tenant 차원으로. (BYOK client 라우팅은 G13.)

## 이 세션 범위

- **Slice 0**(IDOR 폐색) — 즉시·독립 PR.
- **Slice 1**(신원) — 승인 시 후속 PR.
- Slice 2~5는 후속 세션(각 회귀-0 슬라이스로 점진).

## 불변식

- 각 슬라이스 additive migration·flag(또는 회귀-0 순수 추가). off/미승인 시 단일 사용자 경로 바이트 동일.
- AUTH=jwt 전제(AUTH=none 로컬은 테넌트 무의미·기존 폴백 보존).

## 범위 밖 (YAGNI·후속)

- 팀 초대·RBAC·org_members(B 승격) · BYOK/시크릿 KMS(G13) · Postgres RLS(규제 SKU) · 읽기 GET 잠금(제품결정) · schema/DB-per-tenant · G12 과금원장 · G14 SLO.
