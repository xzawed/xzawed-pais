# Project Registry & Multi-Project Support 설계 스펙

**날짜:** 2026-05-24  
**범위:** xzawedManager (백엔드), xzawedOrchestrator (UI + 서버), xzawedShared + 5개 에이전트 (프로토콜)  
**목표:** xzawedPAIS 설치 후 사용자가 외부 서비스(로컬 디렉토리 또는 GitHub 리포)를 등록하고, Orchestrator UI 또는 Claude 대화를 통해 해당 서비스에 대한 개발·빌드·배포를 에이전트로 수행할 수 있게 한다.

---

## 1. 아키텍처 개요

### 두 가지 등록 경로

```
[대화형]
  사용자: "C:\my-service 작업 시작해줘"
  → Claude가 register_project tool 호출
  → DB 저장 + 현재 세션에 자동 연결

[UI형]
  Orchestrator 사이드바 Projects 패널
  → 폼 입력 (이름 + 로컬경로/GitHub URL)
  → 저장 후 프로젝트 클릭 시 새 세션 시작
```

### 전체 흐름

```
Orchestrator UI (Electron)
  ├ Projects 패널 (신규)
  └ 메시지 입력창 하단 프로젝트 컨텍스트 표시
        ↓ REST
Manager (포트 3001)
  ├ ProjectService: DB CRUD + GitHub clone/pull
  ├ SessionService: workspace_root 해석
  └ RedisAgentHandler: 에이전트 메시지에 workspaceRoot 주입
        ↓ Redis Streams (workspaceRoot 포함)
Developer / Builder / Tester / Watcher / Security
  → message.payload.workspaceRoot 우선 사용 (env var fallback)
```

---

## 2. 데이터 모델

### 2-1. 신규 테이블: `projects`

```sql
CREATE TABLE projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('local', 'github')),
  local_path     TEXT,           -- type='local'일 때 사용
  repo_url       TEXT,           -- type='github'일 때 사용
  branch         TEXT NOT NULL DEFAULT 'main',
  workspace_path TEXT NOT NULL,  -- 에이전트가 실제로 접근하는 경로
                                 -- local: local_path 그대로
                                 -- github: {os.homedir()}/.xzawed/workspaces/{id}
  push_strategy  TEXT NOT NULL DEFAULT 'push'
                   CHECK (push_strategy IN ('push', 'pr')),
                                 -- push: commit 후 branch에 직접 push
                                 -- pr: commit 후 PR 생성 (github-ops handler 사용)
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2-2. 기존 `sessions` 테이블 변경

```sql
ALTER TABLE sessions
  ADD COLUMN project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN workspace_root TEXT;
  -- project_id 없이도 직접 경로 지정 가능 (대화형 임시 등록 지원)
```

### 2-3. workspace_root 해석 우선순위

```
1. sessions.workspace_root (직접 설정)
2. projects.workspace_path (project_id → projects 조회)
3. WORKSPACE_ROOT env var (기존 fallback)
```

---

## 3. API 및 통합 지점

### 3-1. Manager REST API (신규)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/projects` | 프로젝트 등록 |
| GET | `/api/projects` | 목록 조회 |
| GET | `/api/projects/:id` | 단건 조회 |
| PATCH | `/api/projects/:id` | 수정 (이름, branch 등) |
| DELETE | `/api/projects/:id` | 삭제 |
| POST | `/api/projects/:id/sync` | GitHub clone/pull 수행 |

#### POST /api/projects 요청 스키마

```typescript
// 로컬
{ name: string; type: 'local'; localPath: string; description?: string }

// GitHub
{ name: string; type: 'github'; repoUrl: string; branch?: string; description?: string }
```

### 3-2. 세션 생성 API 변경

```typescript
// 기존
POST /api/sessions
{ sessionId: string }

// 변경 후
POST /api/sessions
{
  sessionId:     string
  projectId?:    string  // 프로젝트 선택 시
  workspaceRoot?: string  // 직접 경로 지정 시
}
```

### 3-3. 신규 Claude Tool 핸들러

Manager `ToolRegistry`에 2개 추가:

**`register_project`**
- 입력: `{ name, type, localPath? | repoUrl?, branch?, description? }`
- 동작: DB 저장 → GitHub이면 clone 시작 → 현재 세션에 project_id 연결
- 출력: `{ projectId, workspacePath, status }`

**`switch_project`**
- 입력: `{ projectId }` 또는 `{ name }` (이름으로 검색)
- 동작: 현재 세션의 project_id 변경 → workspace_root 갱신
- 출력: `{ projectId, name, workspacePath }`

### 3-4. GitHub 동기화 흐름

```
등록 시 (type=github):
  POST /api/projects
  → ProjectService.create()
  → git clone <repoUrl> {os.homedir()}/.xzawed/workspaces/{id}/
  → workspace_path = {os.homedir()}/.xzawed/workspaces/{id}/
     (Windows: C:\Users\{user}\.xzawed\workspaces\{id}\)

작업 후 (Developer가 파일 수정):
  Manager가 github-ops ToolHandler 자동 호출
  → git add . && git commit -m "agent: {작업 설명}" && git push origin <branch>
    (push_strategy='push' 기본값)
  또는
  → git add . && git commit -m "agent: {작업 설명}" → PR 생성
    (push_strategy='pr' 시)

POST /api/projects/:id/sync:
  → git pull origin <branch> (최신화)
```

---

## 4. Orchestrator UI 변경

### 4-1. 사이드바 — Projects 패널

기존 Sessions 패널 아래에 Projects 패널 추가:

```
[Sessions]
  ● session-abc (my-shopping-mall)
  ○ session-def

[Projects]
  + 새 프로젝트
  ─────────────
  📁 my-shopping-mall
     C:\projects\shopping
  🐙 my-api-server
     github.com/user/api
```

- 📁 = 로컬, 🐙 = GitHub
- 프로젝트 클릭 → 해당 프로젝트로 새 세션 시작
- 우클릭 메뉴: 수정 / 동기화(type=github인 경우만 표시) / 삭제

### 4-2. 프로젝트 추가 Dialog

```
이름:   [                    ]
유형:   ● 로컬 디렉토리  ○ GitHub 리포
경로:   [                    ] [폴더 선택]   ← 로컬
또는
URL:    [https://github.com/ ]              ← GitHub
Branch: [main               ]

              [취소]  [프로젝트 추가]
```

GitHub 등록 시 clone 진행 상태 표시 후 완료.

### 4-3. 메시지 입력창 하단 프로젝트 컨텍스트

```
┌────────────────────────────────────────────────────┐
│  [메시지 입력...]                            [전송] │
│  📁 my-shopping-mall  ▾                            │
└────────────────────────────────────────────────────┘
```

- 클릭 시 프로젝트 선택 드롭다운
- 미선택: `(프로젝트 없음)` 표시, 기존 동작 유지

### 4-4. 신규 Zustand 스토어: `projects.store.ts`

```typescript
interface ProjectsStore {
  projects: Project[]
  activeProjectId: string | null
  fetchProjects: () => Promise<void>
  addProject: (input: CreateProjectInput) => Promise<Project>
  removeProject: (id: string) => Promise<void>
  setActiveProject: (id: string | null) => void
}
```

---

## 5. 에이전트 프로토콜 변경

### 5-1. 각 에이전트 핸들러 수정

BaseConsumer는 메시지 파싱·검증만 담당하므로 변경하지 않는다.
workspaceRoot 실제 사용 위치는 각 에이전트의 `onMessage` 핸들러 함수:

```typescript
// 현재 (각 에이전트 핸들러)
const workspaceRoot = process.env.WORKSPACE_ROOT!

// 변경 (각 에이전트 핸들러)
const workspaceRoot = message.payload.workspaceRoot
                   ?? process.env.WORKSPACE_ROOT!
```

대상: xzawedDeveloper, xzawedBuilder, xzawedTester, xzawedWatcher, xzawedSecurity 핸들러 함수 각 1곳.

### 5-2. 에이전트 RequestSchema 변경 (5개)

xzawedDeveloper, xzawedBuilder, xzawedTester, xzawedWatcher, xzawedSecurity:

```typescript
payload: z.object({
  workspaceRoot: z.string().optional(),  // ← 신규 (optional, 하위 호환)
  // 기존 필드들 ...
})
```

xzawedPlanner, xzawedDesigner는 파일시스템 미사용 → 변경 없음.

### 5-3. Manager RedisAgentHandler 수정

```typescript
async execute(toolInput, sessionId) {
  const workspaceRoot = await sessionService.getWorkspaceRoot(sessionId)
  await redis.xadd(requestStream, '*', 'data', JSON.stringify({
    sessionId,
    payload: { ...toolInput, workspaceRoot }
  }))
}
```

### 5-4. 변경 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `xzawedShared/src/base-consumer.ts` | workspaceRoot payload 우선 읽기 |
| `xzawedDeveloper/src/consumer.ts` | workspaceRoot optional 추가 |
| `xzawedBuilder/src/consumer.ts` | 동일 |
| `xzawedTester/src/consumer.ts` | 동일 |
| `xzawedWatcher/src/consumer.ts` | 동일 |
| `xzawedSecurity/src/consumer.ts` | 동일 |
| `xzawedManager/packages/server/src/tools/redis-agent-handler.ts` | workspaceRoot 주입 |
| `xzawedManager/packages/server/src/services/session.service.ts` | getWorkspaceRoot() 추가 |
| `xzawedManager/packages/server/src/services/project.service.ts` | 신규: CRUD + GitHub clone |
| `xzawedManager/packages/server/src/routes/projects.route.ts` | 신규: REST 엔드포인트 |
| `xzawedManager/packages/server/src/tools/register-project.handler.ts` | 신규: Claude tool |
| `xzawedManager/packages/server/src/tools/switch-project.handler.ts` | 신규: Claude tool |
| `xzawedManager/packages/server/src/db/migrations/` | 신규: projects 테이블 마이그레이션 |
| `xzawedOrchestrator/packages/app/src/renderer/src/store/projects.store.ts` | 신규: Zustand 스토어 |
| `xzawedOrchestrator/packages/app/src/renderer/src/components/ProjectsPanel.tsx` | 신규: 사이드바 패널 |
| `xzawedOrchestrator/packages/app/src/renderer/src/components/AddProjectDialog.tsx` | 신규: 등록 Dialog |
| `xzawedOrchestrator/packages/app/src/renderer/src/components/ProjectContextBar.tsx` | 신규: 입력창 하단 컨텍스트 |

---

## 6. 구현 제외 범위

- 프로젝트별 접근 권한 제어 (멀티 유저 시나리오)
- GitHub 이외의 Git 호스팅 (GitLab, Bitbucket)
- 프로젝트 간 의존성 관리
- 빌드 결과물 배포 인프라 (Docker 빌드/push 등)

---

## 7. 구현 순서 (의존성 기준)

```
1. DB 마이그레이션 + ProjectService + projects.route.ts
2. SessionService.getWorkspaceRoot() + sessions 테이블 변경
3. RedisAgentHandler workspaceRoot 주입
4. BaseConsumer + 5개 에이전트 스키마 변경
5. register_project / switch_project tool 핸들러
6. Orchestrator: projects.store + ProjectsPanel + AddProjectDialog
7. Orchestrator: ProjectContextBar (입력창 하단)
8. GitHub sync (POST /api/projects/:id/sync + clone/pull 로직)
```
