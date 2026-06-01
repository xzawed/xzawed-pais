# 위키 뷰어 — 설계

- 작성일: 2026-06-02
- 상태: 승인됨
- 브랜치: `feat/wiki-viewer`
- 범위: 읽기 전용 도메인 지식 뷰어(walking skeleton). 검색·편집·실시간은 후속.

## 1. 목표

PO(사용자)가 프로젝트에 누적된 도메인 지식(planner·designer·developer·security가 emit한 결정·제약)을 Orchestrator 앱 화면에서 확인한다. 비전의 "사용자는 PO로서 지식을 본다"를 완성.

확정 결정:
- **데이터 경로**: Manager HTTP 엔드포인트 + Orchestrator 서버 프록시 (Manager가 자기 DB 소유, 관심사 분리).
- **인증**: 읽기 전용 도메인 지식이라 Manager 라우트는 비인증(health와 동일, 민감정보 아님).
- **범위**: walking skeleton — 조회·리스트만. 검색/필터/편집/실시간은 후속.

## 2. 현재 상태와 통합 지점 (코드 근거)

- Manager는 이미 HTTP 라우트 호스팅: `api/health.route.ts`, `api/sessions.route.ts`(`app.post` 등). 새 GET 라우트 추가 가능. `server.ts`에서 `knowledgeRepo`(DATABASE_URL 설정 시) 생성됨.
- `KnowledgeRepo.recentByProject(projectId, limit)`는 현재 `{content, sourceAgent}`만 반환 — 뷰어 표시용 `createdAt` 추가 필요.
- Orchestrator 서버는 Manager와 Redis로 통신하며 app→manager HTTP 경로는 없음. `MANAGER_URL`은 `server-manager.ts:28`에서 임베디드 서버 env로 전달됨 → 서버 코드에서 `config`로 접근 가능하게 배선 필요.
- 앱: `lib/api.ts`(fetch 래퍼), `RightPanel`/`DynamicPanel`/`ActivityBar` 레이아웃. ActivityBar에 nav 항목 추가 패턴 존재.

## 3. 데이터 경로

```
앱 WikiPanel
  → GET {serverUrl}/projects/:projectId/knowledge        (Orchestrator 서버)
  → Orchestrator: fetch {MANAGER_URL}/projects/:projectId/knowledge  (프록시)
  → Manager: knowledgeRepo.recentByProject(projectId, limit)
  → { items: [{ content, sourceAgent, createdAt }] }      (DB 없으면 { items: [] })
```

## 4. 컴포넌트

### 4.1 Manager — `api/knowledge.route.ts` (신규)
- `GET /projects/:projectId/knowledge?limit=N` (기본 50, 상한 200).
- 핸들러: `knowledgeRepo`가 있으면 `recentByProject(projectId, limit)`, 없으면 `{ items: [] }`.
- **비인증**(health와 동일). `server.ts`에서 `knowledgeRepo`를 라우트에 주입.
- `KnowledgeRepo.recentByProject` 반환에 `createdAt` 추가(쿼리에 이미 정렬용으로 select). 시그니처: `{ content, sourceAgent, createdAt }[]`.

### 4.2 Orchestrator 서버 — `api/knowledge.route.ts` (신규)
- `GET /projects/:projectId/knowledge` → `fetch(new URL('/projects/:id/knowledge', MANAGER_URL))` 프록시 후 JSON 반환.
- Manager 미응답/오류 → `{ items: [] }` + `app.log.warn`. (503 대신 graceful 빈 목록)
- `MANAGER_URL`을 server config로 노출(`config.ts` + sessions route config처럼 주입).
- SSRF: MANAGER_URL은 설정값(사용자 입력 아님). `new URL` 파싱으로 방어.

### 4.3 앱
- `lib/api.ts` `getKnowledge(baseUrl, projectId): Promise<{ items: KnowledgeItem[] }>` — `KnowledgeItem = { content; sourceAgent; createdAt }`. validateBaseUrl 적용.
- **`components/WikiPanel.tsx`** (신규): 활성 projectId의 지식을 마운트 시 fetch해 리스트(내용 + sourceAgent 뱃지). 빈 상태 안내 문구. `data-testid="wiki-panel"`, 항목 `data-testid="wiki-item"`.
- **ActivityBar**: '위키' nav 항목 추가 → WikiPanel 토글(기존 패널 토글 패턴 따름).
- i18n: `wiki.title`·`wiki.empty`·`wiki.source` ko/en/ja.

## 5. 범위 경계 (YAGNI)

| 포함 (skeleton) | 제외 (후속) |
|---|---|
| 3계층 조회 경로 | 검색·필터·카테고리 |
| 읽기 전용 리스트 패널 | 지식 편집·삭제 |
| 빈 상태·graceful 폴백 | 실시간 갱신(폴링/WS) |
| i18n ko/en/ja | DATABASE_URL 인프라 배선 |

## 6. 에러 처리
- DB 없음 → Manager `{ items: [] }`. Manager 미응답 → Orchestrator `{ items: [] }` + 경고. 앱은 "아직 지식 없음" 표시.
- projectId 없음(프로젝트 미선택) → 패널은 안내 문구.

## 7. 성공 기준
1. 프로젝트에 지식이 있으면 WikiPanel에 내용·출처가 표시된다.
2. DB 없음/Manager 미응답 시 빈 목록 안내가 표시되고 앱이 깨지지 않는다.
3. Manager 라우트·Orchestrator 프록시·앱 fetch·패널이 각각 단위/브라우저 테스트로 검증된다.

## 8. 후속 (별도 사이클)
- 검색·카테고리 필터, 지식 편집/삭제, 실시간 갱신.
- DATABASE_URL docker-compose 배선(운영 영속화).
- 게이트 승인 카드에서 "이 결정을 위키에 저장" 인라인 액션.
