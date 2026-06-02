# 위키 항목 편집/삭제 — 설계 (고정 계약 + WBS 워크트리 실행)

- 작성일: 2026-06-02
- 상태: 승인됨
- 통합 브랜치(W0): `feat/wiki-edit-delete`
- 범위: WikiPanel에서 PO가 누적 도메인 지식을 인라인 편집(content+category)·삭제. 전체 5계층.
- 비고: WBS 분해 후 7개 작업패키지를 독립 계획 → 5렌즈 교차검토(63건 중 42 확정, ~11 계약충돌) → 아래 **단일 고정 계약**으로 해소. 이 문서가 모든 워크트리의 단일 기준점이다.

## 1. 목표
PO가 누적 도메인 지식을 직접 큐레이션(수정·삭제). 비전의 "PO가 도메인 지식을 관리".

## 2. 고정 계약 (FROZEN — 모든 계층이 이 계약을 향해 구현, 드리프트 0)

### 2.1 타입 (id 노출, insertMany 무영향)
- `KnowledgeEntry`(쓰기/입력, **id 없음** — 현행 유지): `{ content: string; sourceAgent: string; category?: string; createdAt?: string }`. `insertMany`는 이 타입 그대로 → runner.ts 등 기존 호출부 **무영향**.
- **신규** `KnowledgeRecord`(읽기 결과): `KnowledgeEntry & { id: number }`. `recentByProject`가 `KnowledgeRecord[]` 반환.
- **id는 `number`로 통일** 전 계층(repo·route 파라미터 파싱·proxy·app `KnowledgeItem.id`·WikiPanel key). repo는 `Number(r.id)` 매핑. (BIGINT>2^53 정밀도 손실은 프로젝트별 지식 규모상 비현실적 — 문서화하고 허용.)

### 2.2 repo (`knowledge.repo.ts`)
- `recentByProject(...)`: SELECT에 `id` 추가, 반환 타입 `KnowledgeRecord[]` (`id: Number(r.id)`).
- `updateById(projectId: string, id: number, content: string, category: string | null): Promise<boolean>` — `UPDATE domain_knowledge SET content=$, category=$ WHERE id=$ AND project_id=$`. 반환 = `rowCount > 0`.
- `deleteById(projectId: string, id: number): Promise<boolean>` — `DELETE … WHERE id=$ AND project_id=$`. 반환 = `rowCount > 0`.
- **project_id 가드(보안 핵심)**: 두 변이 모두 WHERE에 `AND project_id=$` — id만으로 타 프로젝트 행 변조 불가.
- SQL 문자열을 updateById/deleteById가 서로 구분되게 유지(jscpd <100토큰).

### 2.3 Manager route (`api/knowledge.route.ts`) — 비인증(GET과 동일)
- `PATCH /projects/:projectId/knowledge/:id` body `{ content: string; category?: string }`.
  - 검증: `:id`가 숫자(정규식/`Number.isInteger`) 아니면 **400**; `content` trim 후 빈 문자열이면 **400**.
  - `category`: 비어있거나(`''`) 없으면 **clear → null**; 있으면 그대로(자유 문자열; UI는 decision/constraint/rule/tech만 노출).
  - `knowledgeRepo` 없으면 **503**. `updateById` false → **404**. true → **200 `{ ok: true }`**.
- `DELETE /projects/:projectId/knowledge/:id`.
  - `:id` 숫자 검증(400). repo 없음 503. `deleteById` false → **404**. true → **204 No Content**.
- 가드 블록 중복(repo없음·id검증)은 작은 헬퍼(`parseId`)로 추출해 jscpd 회피.

### 2.4 Orchestrator proxy (`packages/server/src/api/knowledge.route.ts`) — 비인증(GET과 동일)
- `PATCH …/:id`(JSON body + content-type 전달)·`DELETE …/:id`를 `MANAGER_URL`로 전달.
- 기존 GET 패턴 미러: `new URL(config.managerUrl)`(SSRF 방어)·`AbortSignal.timeout(5000)`·**상태코드 pass-through**(204/200/400/404 그대로 relay)·transport 오류 시 **502**.
- URL 빌드 중복은 `buildManagerUrl(config, projectId, id?)` 헬퍼로 추출(jscpd).

### 2.5 App api (`lib/api.ts`)
- `KnowledgeItem`에 `id: number` 추가.
- `updateKnowledge(baseUrl, projectId, id: number, content: string, category: string | null): Promise<void>` — PATCH, JSON body `{content, category}`. non-ok면 throw.
- `deleteKnowledge(baseUrl, projectId, id: number): Promise<void>` — DELETE. non-ok면 throw.
- `validateBaseUrl` 적용.

### 2.6 App UI (`components/WikiPanel.tsx`)
- 각 항목에 `wiki-item-edit`·`wiki-item-delete` 버튼.
- **편집(인라인)**: `editingId` 상태. 편집 모드 = `wiki-edit-content`(textarea) + `wiki-edit-category`(select: 미분류/decision/constraint/rule/tech) + `wiki-edit-save`/`wiki-edit-cancel`. 저장 → `updateKnowledge` 후 **refetch**. 취소 → 원본 복원.
- **삭제(in-DOM 확인, `window.confirm` 금지)**: `wiki-item-delete` → 인라인 확인 영역 `wiki-delete-confirm`/`wiki-delete-cancel`. 확인 → `deleteKnowledge` 후 **refetch**.
- 기존 검색/출처/분류 필터 동작 유지. refetch는 기존 조회 경로 단일 재사용(중복 금지).
- category 리터럴(decision/constraint/rule/tech)은 컴포넌트 상수 1곳으로 모아 필터·편집 드롭다운 공유(드리프트·중복 방지).

### 2.7 i18n (`locales/{ko,en,ja}/app.json`) — **6키**
`wiki.edit` · `wiki.delete` · `wiki.save` · `wiki.cancel` · `wiki.delete_confirm` · `wiki.category_none`(미분류 옵션 라벨). check-i18n.js 통과.

### 2.8 인증
쓰기 경로는 읽기 경로와 동일 **비인증**(위키 전체가 비인증 read-only, MODE=local PO 도구). 안전장치 = ① project_id WHERE 가드 ② in-DOM 삭제 확인. (AUTH=jwt 시 토큰 강제는 후속.)

## 3. WBS 계층 + 워크트리/브랜치/머지 규율

```
W0  feat/wiki-edit-delete            ← 통합 브랜치 = 최종 단일 PR
├─ W1 Manager 백엔드   [worktree: .claude/worktrees/wiki-w1-manager,  branch feat/wiki-edit-delete/w1-manager]
│   ├─ W1.1 repo   └─ W1.2 route
├─ W2 Orch-server      [worktree: .claude/worktrees/wiki-w2-orch-server, branch feat/wiki-edit-delete/w2-orch-server]
│   └─ W2.1 proxy
└─ W3 App              [worktree: .claude/worktrees/wiki-w3-app, branch feat/wiki-edit-delete/w3-app]
    ├─ W3.1 api  ├─ W3.2 WikiPanel  └─ W3.3 i18n
```
- 재귀 분해 시 `부모.자식`(W1.1.1…) — 번호로 소속 명확. 서브일감은 **부모 워크트리 안 순차 커밋**(별도 브랜치 X), 커밋 메시지 `[W1.1]` 태그.
- **불변식**: ① 모든 워크트리는 W0 HEAD(본 스펙·계약 포함)에서 분기 → 드리프트 0. ② 파일 집합 분리(Manager/Orch-server/App) → 머지 충돌 0. ③ 서브일감 브랜치는 W0로 직접 머지 금지(부모 서비스 브랜치 경유). ④ 머지 순서 W1→W2→W3 후 W0에서 통합 검증 → 단일 PR.

## 4. 에러 처리
- repo/DATABASE_URL 없음 → Manager 503, 앱은 무동작(기존 폴백). 프록시 Manager 불가 → 502. 없는/타프로젝트 id → 404.
- 편집 취소 → 원본 복원. 변이 실패 → 목록 유지(낙관적 갱신 안 함, 성공 시 refetch).

## 5. 테스트 (계층별, SonarCloud 80% 신규 분기 목표)
- repo: `recentByProject` id 매핑; `updateById`/`deleteById` SQL(WHERE id AND project_id, params)·rowCount>0 true/false; 기존 fixture에 id 보강.
- Manager route: PATCH 정상 200/빈 content 400/비숫자 id 400/없음 404/repo없음 503; DELETE 정상 204/404/repo없음 503.
- proxy: PATCH(body+CT)·DELETE 전달·상태 pass-through(204/404)·transport 오류 502.
- app api: updateKnowledge/deleteKnowledge URL·메서드·body·non-ok throw.
- WikiPanel browser: edit 진입→저장 시 updateKnowledge+refetch; 취소 복원; delete→in-DOM 확인→deleteKnowledge+refetch; 확인 취소.
- i18n 동기화(check-i18n.js).

## 6. 성공 기준
1. WikiPanel에서 항목 편집(content+category) 저장 시 위키에 반영(refetch)되고, 삭제 시 in-DOM 확인 후 제거된다.
2. 타 프로젝트 id로는 변조/삭제 불가(project_id WHERE 가드).
3. Redis 스트림·세션 라우트 무관; 위키 경로만 변경. 단일 PR로 W0→master.
4. 빌드·테스트·jscpd 0·audit 0·i18n 동기화·어드버서리얼 리뷰 확정 0.

## 7. 후속
쓰기 경로 인증 강화(AUTH=jwt), 편집 이력/audit, soft-delete, 저장 전 주석.
