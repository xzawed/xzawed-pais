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

인증 미사용 모드 (`USER_JWT_SECRET` 미설정):

```json
{
  "userId": "user-123"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `userId` | string | 아니오 | 사용자 ID. 미입력 시 `"anonymous"` |

인증 모드 (`USER_JWT_SECRET` 설정, `Authorization: Bearer <accessToken>` 필요):

```json
{
  "projectId": "uuid"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectId` | string (UUID) | 예 | 세션을 연결할 프로젝트 ID. 요청자 소유 여부 검증 |

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

세션의 태스크 목록을 조회합니다.

**경로 파라미터**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 세션 ID |

**응답 200 OK**

```json
{
  "tasks": [
    {
      "id": "a1b2c3d4-...",
      "sessionId": "550e8400-...",
      "status": "running",
      "intent": "쇼핑몰 백엔드 API 구현",
      "result": null,
      "createdAt": 1747267200000,
      "updatedAt": 1747267210000
    }
  ]
}
```

**Task 객체 필드:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string (UUID) | 태스크 ID |
| `sessionId` | string (UUID) | 소속 세션 ID |
| `status` | `"pending"` \| `"running"` \| `"completed"` \| `"failed"` | 태스크 상태 |
| `intent` | string | xzawedManager로 전달된 작업 의도 |
| `result` | string \| null | 완료 시 결과 내용 |
| `createdAt` | number | Unix 밀리초 타임스탬프 |
| `updatedAt` | number | Unix 밀리초 타임스탬프 |

**curl 예시**

```bash
curl http://localhost:3000/sessions/550e8400-.../tasks
```

---

## 인증 (`AUTH=jwt` + `DATABASE_URL` + `USER_JWT_SECRET` 설정 시 활성화)

모든 `/auth/*`·`/projects` 엔드포인트는 `DATABASE_URL`과 `USER_JWT_SECRET`이 모두 설정된 경우에만 등록됩니다.

### POST /auth/register

새 사용자를 등록합니다. IP당 분당 5회로 Rate Limit이 적용됩니다.

**요청 본문**

```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "홍길동"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `email` | string | 예 | 이메일 주소 |
| `password` | string | 예 | 비밀번호 (8자 이상) |
| `displayName` | string | 아니오 | 표시 이름 |

**응답 201 Created**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "홍길동",
    "createdAt": "2026-05-22T00:00:00.000Z"
  },
  "accessToken": "<JWT, 15분 유효>",
  "refreshToken": "<opaque token, 30일 유효>"
}
```

**응답 409 Conflict** (이메일 중복)

```json
{ "error": "Email already registered" }
```

---

### POST /auth/login

이메일·비밀번호로 로그인합니다. IP당 분당 5회로 Rate Limit이 적용됩니다.

**요청 본문**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**응답 200 OK**

```json
{
  "user": { "id": "uuid", "email": "user@example.com", "displayName": "홍길동", "createdAt": "..." },
  "accessToken": "<JWT>",
  "refreshToken": "<opaque token>"
}
```

**응답 401 Unauthorized** (자격증명 불일치)

```json
{ "error": "Invalid credentials" }
```

---

### POST /auth/refresh

Refresh token으로 새 access token을 발급합니다. 기존 refresh token은 rotation 방식으로 폐기되고 새 토큰이 발급됩니다. IP당 분당 20회로 Rate Limit이 적용됩니다.

**요청 본문**

```json
{ "refreshToken": "<opaque token>" }
```

**응답 200 OK**

```json
{
  "accessToken": "<새 JWT>",
  "refreshToken": "<새 opaque token>"
}
```

---

### POST /auth/logout

현재 사용자의 모든 refresh token을 폐기합니다. `Authorization: Bearer <accessToken>` 헤더가 필요합니다.

**응답 200 OK**

```json
{ "ok": true }
```

---

### GET /auth/me

현재 인증된 사용자 정보를 반환합니다. `Authorization: Bearer <accessToken>` 헤더가 필요합니다.

**응답 200 OK**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "홍길동",
    "createdAt": "2026-05-22T00:00:00.000Z"
  }
}
```

---

## 프로젝트 (`AUTH=jwt` + `DATABASE_URL` + `USER_JWT_SECRET` 설정 시 활성화)

모든 `/projects` 엔드포인트는 `Authorization: Bearer <accessToken>` 헤더가 필요합니다.

### GET /projects

현재 사용자의 프로젝트 목록을 조회합니다.

**응답 200 OK**

```json
{
  "projects": [
    {
      "id": "uuid",
      "userId": "uuid",
      "name": "쇼핑몰 서비스",
      "slug": "my-shop",
      "description": "온라인 쇼핑몰",
      "githubOwner": "myorg",
      "githubRepo": "my-shop",
      "githubBranch": "main",
      "createdAt": "2026-05-22T00:00:00.000Z",
      "updatedAt": "2026-05-22T00:00:00.000Z"
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
  "name": "쇼핑몰 서비스",
  "description": "온라인 쇼핑몰",
  "githubOwner": "myorg",
  "githubRepo": "my-shop",
  "githubBranch": "main"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | 예 | 프로젝트 이름 |
| `description` | string | 아니오 | 프로젝트 설명 |
| `githubOwner` | string | 아니오 | GitHub 조직 또는 사용자명 |
| `githubRepo` | string | 아니오 | GitHub 레포지토리명 |
| `githubBranch` | string | 아니오 | 기본 브랜치 (기본값: `main`) |

**응답 201 Created**

```json
{ "project": { "id": "uuid", "name": "쇼핑몰 서비스", ... } }
```

---

### GET /projects/:id

프로젝트 단건을 조회합니다.

**응답 200 OK**

```json
{ "project": { "id": "uuid", "name": "쇼핑몰 서비스", ... } }
```

---

### PATCH /projects/:id

프로젝트를 수정합니다. 전달한 필드만 업데이트됩니다.

**요청 본문**

```json
{
  "name": "새 이름",
  "description": "새 설명",
  "githubBranch": "develop"
}
```

**응답 200 OK**

```json
{ "project": { "id": "uuid", "name": "새 이름", ... } }
```

---

### DELETE /projects/:id

프로젝트를 삭제합니다.

**응답 204 No Content**

---

### PUT /projects/:id/github-token

프로젝트의 GitHub Personal Access Token을 저장합니다. 토큰은 AES-256-GCM으로 암호화하여 DB에 저장됩니다. `GITHUB_TOKEN_ENCRYPTION_KEY`가 설정되지 않으면 503을 반환합니다.

**요청 본문**

```json
{ "token": "ghp_..." }
```

**응답 204 No Content**

---

### DELETE /projects/:id/github-token

저장된 GitHub Personal Access Token을 삭제합니다.

**응답 204 No Content**

---

### GET /projects/:id/github-token/status

GitHub Personal Access Token 저장 여부를 확인합니다. 토큰 값은 반환되지 않습니다.

**응답 200 OK**

```json
{ "exists": true }
```

---

## 엔드포인트 요약

| 메서드 | 경로 | 설명 | 인증 필요 |
|--------|------|------|-----------|
| `GET` | `/health` | 서버 상태 확인 | 아니오 |
| `POST` | `/sessions` | 세션 생성 | `USER_JWT_SECRET` 설정 시 예 |
| `POST` | `/sessions/:id/messages` | 메시지 전송 | `USER_JWT_SECRET` 설정 시 예 |
| `GET` | `/sessions/:id/messages` | 메시지 이력 조회 | `USER_JWT_SECRET` 설정 시 예 |
| `POST` | `/sessions/:id/ui-actions` | UI 폼 제출 | `USER_JWT_SECRET` 설정 시 예 |
| `GET` | `/sessions/:id/tasks` | 태스크 목록 조회 | `USER_JWT_SECRET` 설정 시 예 |
| `POST` | `/auth/register` | 사용자 등록 | 아니오 |
| `POST` | `/auth/login` | 로그인 | 아니오 |
| `POST` | `/auth/refresh` | 토큰 갱신 | 아니오 (refresh token) |
| `POST` | `/auth/logout` | 로그아웃 | access token |
| `GET` | `/auth/me` | 현재 사용자 조회 | access token |
| `GET` | `/projects` | 프로젝트 목록 | access token |
| `POST` | `/projects` | 프로젝트 생성 | access token |
| `GET` | `/projects/:id` | 프로젝트 단건 조회 | access token |
| `PATCH` | `/projects/:id` | 프로젝트 수정 | access token |
| `DELETE` | `/projects/:id` | 프로젝트 삭제 | access token |
| `PUT` | `/projects/:id/github-token` | GitHub PAT 저장 | access token |
| `DELETE` | `/projects/:id/github-token` | GitHub PAT 삭제 | access token |
| `GET` | `/projects/:id/github-token/status` | GitHub PAT 존재 여부 확인 | access token |

---

## 다음 단계

- [WebSocket 프로토콜](websocket.md) — 실시간 스트리밍 연결
- [MCP 도구 레퍼런스](mcp-tools.md) — MCP로 세션 관리

---

## 관련 문서

- [세션 수명주기](../concepts/sessions.md)
- [동적 UI 패널](../concepts/dynamic-ui.md)
