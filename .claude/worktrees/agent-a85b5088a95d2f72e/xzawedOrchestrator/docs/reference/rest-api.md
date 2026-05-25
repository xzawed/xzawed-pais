[홈](../index.md) > [레퍼런스](.) > REST API

# REST API 레퍼런스

xzawedOrchestrator 백엔드 서버의 모든 REST API 엔드포인트를 설명합니다.

**Base URL:** `http://localhost:3000` (로컬) 또는 `https://your-server.com` (원격)

---

## 공통 사항

### Content-Type

모든 요청·응답은 `application/json`을 사용합니다.

### 오류 응답 포맷

```json
{
  "error": "오류 메시지",
  "statusCode": 404
}
```

---

## 헬스체크

### GET /health

서버 상태를 확인합니다. 인증 없이 접근 가능합니다.

**응답 200 OK**

```json
{
  "status": "ok",
  "timestamp": 1747267200000
}
```

**curl 예시**

```bash
curl http://localhost:3000/health
```

---

## 세션

### POST /sessions

새로운 대화 세션을 생성합니다.

**요청 본문**

```json
{
  "userId": "user-123"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `userId` | string | 아니오 | 사용자 ID. 미입력 시 `"anonymous"` |

**응답 201 Created**

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**curl 예시**

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123"}'
```

---

### POST /sessions/:id/messages

세션에 메시지를 전송합니다. 메시지는 비동기로 처리되며 즉시 `202 Accepted`를 반환합니다. 처리 결과는 WebSocket으로 스트리밍됩니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 세션 ID |

**요청 본문**

```json
{
  "content": "쇼핑몰 서비스를 만들고 싶어요."
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `content` | string | 예 | 사용자 메시지 내용 |

**응답 202 Accepted**

```json
{
  "messageId": "660f9500-f30c-52e5-b827-557766551111",
  "status": "accepted"
}
```

**응답 404 Not Found** (세션 미존재)

```json
{
  "error": "Session not found"
}
```

**curl 예시**

```bash
curl -X POST http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "쇼핑몰 서비스를 만들고 싶어요."}'
```

---

### GET /sessions/:id/messages

세션의 메시지 이력을 조회합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 세션 ID |

**응답 200 OK**

```json
[
  {
    "id": "660f9500-...",
    "sessionId": "550e8400-...",
    "role": "user",
    "content": "쇼핑몰 서비스를 만들고 싶어요.",
    "timestamp": 1747267200000
  },
  {
    "id": "770a1600-...",
    "sessionId": "550e8400-...",
    "role": "assistant",
    "content": "네, 쇼핑몰 서비스 구현을 도와드리겠습니다. 먼저 몇 가지 요구사항을 확인하겠습니다.",
    "timestamp": 1747267205000,
    "uiSpec": {
      "type": "form",
      "title": "서비스 구성 요구사항",
      "fields": [...]
    }
  }
]
```

**Message 객체 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string (UUID) | 메시지 ID |
| `sessionId` | string (UUID) | 소속 세션 ID |
| `role` | `"user"` \| `"assistant"` \| `"system"` | 메시지 역할 |
| `content` | string | 메시지 내용 |
| `timestamp` | number | Unix 밀리초 타임스탬프 |
| `uiSpec` | UISpec (optional) | 동적 UI 명세 (있을 경우) |

**curl 예시**

```bash
curl http://localhost:3000/sessions/550e8400-e29b-41d4-a716-446655440000/messages
```

---

### POST /sessions/:id/ui-actions

동적 UI 패널의 폼 제출 결과를 전송합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 세션 ID |

**요청 본문**

```json
{
  "action": "submit_requirements",
  "data": {
    "service_type": "ecommerce",
    "features": ["products", "payment"],
    "notes": "한국어 결제 수단 필수"
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `action` | string | 예 | UISpec의 `submitAction` 값 |
| `data` | object | 예 | 폼 입력 데이터 (필드 ID → 값) |

**응답 202 Accepted**

```json
{
  "status": "accepted"
}
```

**curl 예시**

```bash
curl -X POST http://localhost:3000/sessions/550e8400-.../ui-actions \
  -H "Content-Type: application/json" \
  -d '{
    "action": "submit_requirements",
    "data": {
      "service_type": "ecommerce",
      "features": ["products", "payment"]
    }
  }'
```

---

### GET /sessions/:id/tasks

세션에서 진행 중인 태스크 목록을 조회합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 세션 ID |

**응답 200 OK**

```json
{
  "tasks": [
    {
      "taskId": "task-001",
      "agentId": "xzawedDeveloper",
      "status": "in_progress",
      "description": "쇼핑몰 백엔드 API 구현",
      "progress": 45
    }
  ]
}
```

**curl 예시**

```bash
curl http://localhost:3000/sessions/550e8400-.../tasks
```

---

## Auth 엔드포인트

> **Rate Limiting**: `/auth/register`·`/auth/login`은 IP당 분당 5회, `/auth/refresh`는 IP당 분당 20회 제한. 초과 시 `429 Too Many Requests` 반환.

| 메서드 | 경로 | 설명 | 인증 필요 |
|--------|------|------|-----------|
| `POST` | `/auth/register` | 이메일·패스워드 회원가입 | 아니오 |
| `POST` | `/auth/login` | 이메일·패스워드 로그인 | 아니오 |
| `POST` | `/auth/refresh` | Refresh token으로 Access token 재발급 (rotation) | 아니오 |
| `POST` | `/auth/logout` | 현재 사용자의 모든 refresh token 무효화 | Bearer token |
| `GET` | `/auth/me` | 현재 사용자 정보 조회 | Bearer token |

---

## 프로젝트

> 모든 `/projects` 엔드포인트는 Bearer token 인증이 필요합니다.

### GET /projects

현재 사용자의 프로젝트 목록을 조회합니다.

**응답 200 OK**

```json
{
  "projects": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "user-123",
      "name": "My App",
      "description": "A sample project",
      "githubOwner": "octocat",
      "githubRepo": "hello-world",
      "githubBranch": "main",
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

---

### POST /projects

새 프로젝트를 생성합니다.

**요청 본문**

```json
{
  "name": "My App",
  "description": "A sample project",
  "githubOwner": "octocat",
  "githubRepo": "hello-world",
  "githubBranch": "main"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | 예 | 프로젝트 이름 |
| `description` | string | 아니오 | 프로젝트 설명 |
| `githubOwner` | string | 아니오 | GitHub 소유자 (사용자명 또는 조직) |
| `githubRepo` | string | 아니오 | GitHub 저장소 이름 |
| `githubBranch` | string | 아니오 | 기본 브랜치 이름 |

**응답 201 Created**

```json
{
  "project": { "id": "550e8400-...", "name": "My App", ... }
}
```

**응답 400 Bad Request** (name 누락 또는 빈 문자열)

```json
{
  "error": "name is required"
}
```

---

### GET /projects/:id

특정 프로젝트를 조회합니다. 소유자만 접근 가능합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 프로젝트 ID |

**응답 200 OK**

```json
{
  "project": { "id": "550e8400-...", "name": "My App", ... }
}
```

**응답 404 Not Found** (미존재 또는 타 사용자 소유)

```json
{
  "error": "Project not found"
}
```

---

### PATCH /projects/:id

프로젝트 정보를 수정합니다. 변경할 필드만 포함하면 됩니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 프로젝트 ID |

**요청 본문** (변경할 필드만 포함)

```json
{
  "name": "Updated Name",
  "githubBranch": "develop"
}
```

**응답 200 OK**

```json
{
  "project": { "id": "550e8400-...", "name": "Updated Name", ... }
}
```

---

### DELETE /projects/:id

프로젝트를 삭제합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 프로젝트 ID |

**응답 204 No Content**

---

### PUT /projects/:id/github-token

프로젝트에 GitHub Personal Access Token(PAT)을 AES-256-GCM으로 암호화하여 저장합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 프로젝트 ID |

**요청 본문**

```json
{
  "token": "ghp_xxxxxxxxxxxxxxxxxxxx"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `token` | string | 예 | GitHub PAT |

**응답 204 No Content**

**응답 503 Service Unavailable** (암호화 키 미설정)

```json
{
  "error": "GitHub token storage not configured"
}
```

---

### DELETE /projects/:id/github-token

저장된 GitHub PAT를 삭제합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 프로젝트 ID |

**응답 204 No Content**

---

### GET /projects/:id/github-token/status

GitHub PAT 저장 여부를 조회합니다. 토큰 평문은 반환하지 않습니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 프로젝트 ID |

**응답 200 OK**

```json
{
  "exists": true
}
```

---

## 프로젝트 GitHub 토큰

| 메서드 | 경로 | 설명 | 인증 필요 |
|--------|------|------|-----------|
| `PUT` | `/projects/:id/github-token` | GitHub PAT 저장 (AES-256-GCM 암호화) | Bearer token |
| `DELETE` | `/projects/:id/github-token` | GitHub PAT 삭제 | Bearer token |
| `GET` | `/projects/:id/github-token/status` | PAT 존재 여부 조회 `{ exists: boolean }` | Bearer token |

---

## 엔드포인트 요약

| 메서드 | 경로 | 설명 | 인증 필요 |
|--------|------|------|-----------|
| `GET` | `/health` | 서버 상태 확인 | 아니오 |
| `POST` | `/sessions` | 세션 생성 | `AUTH=jwt` 시 예 |
| `POST` | `/sessions/:id/messages` | 메시지 전송 | `AUTH=jwt` 시 예 |
| `GET` | `/sessions/:id/messages` | 메시지 이력 조회 | `AUTH=jwt` 시 예 |
| `POST` | `/sessions/:id/ui-actions` | UI 폼 제출 | `AUTH=jwt` 시 예 |
| `GET` | `/sessions/:id/tasks` | 태스크 목록 조회 | `AUTH=jwt` 시 예 |
| `GET` | `/projects` | 프로젝트 목록 조회 | Bearer token |
| `POST` | `/projects` | 프로젝트 생성 | Bearer token |
| `GET` | `/projects/:id` | 프로젝트 조회 | Bearer token |
| `PATCH` | `/projects/:id` | 프로젝트 수정 | Bearer token |
| `DELETE` | `/projects/:id` | 프로젝트 삭제 | Bearer token |
| `PUT` | `/projects/:id/github-token` | GitHub PAT 저장 | Bearer token |
| `DELETE` | `/projects/:id/github-token` | GitHub PAT 삭제 | Bearer token |
| `GET` | `/projects/:id/github-token/status` | PAT 존재 여부 조회 | Bearer token |

---

## 다음 단계

- [WebSocket 프로토콜](websocket.md) — 실시간 스트리밍 연결
- [MCP 도구 레퍼런스](mcp-tools.md) — MCP로 세션 관리

---

## 관련 문서

- [세션 수명주기](../concepts/sessions.md)
- [동적 UI 패널](../concepts/dynamic-ui.md)
