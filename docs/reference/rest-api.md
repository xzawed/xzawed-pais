[홈](../index.md) > [레퍼런스](.) > REST API

# REST API

xzawedOrchestrator 서버의 모든 REST API 엔드포인트입니다.

**Base URL:** `http://localhost:3000` (로컬) / `https://your-server.com` (원격)

모든 요청·응답은 `application/json`을 사용합니다.

**오류 응답 형식:**

```json
{ "error": "오류 메시지" }
```

---

## 엔드포인트 요약

| 메서드 | 경로 | 설명 | 인증 |
|--------|------|------|------|
| `GET` | `/health` | 서버 상태 확인 | 불필요 |
| `POST` | `/sessions` | 세션 생성 | `USER_JWT_SECRET` 설정 시 access token |
| `POST` | `/sessions/:id/messages` | 메시지 전송 | `USER_JWT_SECRET` 설정 시 access token |
| `GET` | `/sessions/:id/messages` | 메시지 이력 조회 | `USER_JWT_SECRET` 설정 시 access token |
| `POST` | `/sessions/:id/ui-actions` | UI 폼 제출 | `USER_JWT_SECRET` 설정 시 access token |
| `GET` | `/sessions/:id/tasks` | 태스크 목록 조회 | `USER_JWT_SECRET` 설정 시 access token |
| `POST` | `/auth/register` | 사용자 등록 | 불필요 |
| `POST` | `/auth/login` | 로그인 | 불필요 |
| `POST` | `/auth/refresh` | 토큰 갱신 | refresh token |
| `POST` | `/auth/logout` | 로그아웃 | access token |
| `GET` | `/auth/me` | 현재 사용자 조회 | access token |
| `GET` | `/projects` | 프로젝트 목록 | access token |
| `POST` | `/projects` | 프로젝트 생성 | access token |
| `GET` | `/projects/:id` | 프로젝트 단건 조회 | access token |
| `PATCH` | `/projects/:id` | 프로젝트 수정 | access token |
| `DELETE` | `/projects/:id` | 프로젝트 삭제 | access token |
| `PUT` | `/projects/:id/github-token` | GitHub PAT 저장 | access token |
| `DELETE` | `/projects/:id/github-token` | GitHub PAT 삭제 | access token |
| `GET` | `/projects/:id/github-token/status` | GitHub PAT 존재 여부 | access token |

`/auth/*`와 `/projects` 엔드포인트는 `DATABASE_URL`과 `USER_JWT_SECRET`을 모두 설정해야 등록됩니다.

---

## 헬스체크

### GET /health

서버 가동 상태를 확인합니다. 인증 없이 접근 가능합니다.

**응답 200**

```json
{ "status": "ok", "timestamp": 1747267200000 }
```

```bash
curl http://localhost:3000/health
```

---

## 세션

### POST /sessions

새 세션을 생성합니다.

**요청 본문** (`USER_JWT_SECRET` 미설정 시):

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `userId` | string | 아니오 | 사용자 ID. 미입력 시 `"anonymous"` |

```json
{ "userId": "user-123" }
```

**요청 본문** (`USER_JWT_SECRET` 설정 시, `Authorization: Bearer <accessToken>` 필요):

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectId` | string (UUID) | 예 | 세션을 연결할 프로젝트 ID. 요청자 소유 여부 검증 |

```json
{ "projectId": "uuid" }
```

**응답 201**

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123"}'
```

---

### POST /sessions/:id/messages

세션에 메시지를 전송합니다. 처리는 비동기로 진행되며 즉시 `202 Accepted`를 반환합니다. 처리 결과는 WebSocket으로 스트리밍됩니다.

**경로 파라미터:**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `id` | string (UUID) | 세션 ID |

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `content` | string | 예 | 사용자 메시지 내용 |

```json
{ "content": "쇼핑몰 서비스를 만들고 싶어요." }
```

**응답 202**

```json
{ "messageId": "660f9500-f30c-52e5-b827-557766551111", "status": "accepted" }
```

**응답 404** (세션 미존재)

```json
{ "error": "Session not found" }
```

```bash
curl -X POST http://localhost:3000/sessions/550e8400-.../messages \
  -H "Content-Type: application/json" \
  -d '{"content": "쇼핑몰 서비스를 만들고 싶어요."}'
```

---

### GET /sessions/:id/messages

세션의 메시지 이력을 반환합니다.

**응답 200**

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
    "content": "네, 쇼핑몰 서비스 구현을 도와드리겠습니다.",
    "timestamp": 1747267205000,
    "uiSpec": { "type": "form", "title": "서비스 구성 요구사항", "fields": [] }
  }
]
```

**Message 객체:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string (UUID) | 메시지 ID |
| `sessionId` | string (UUID) | 소속 세션 ID |
| `role` | `"user"` \| `"assistant"` \| `"system"` | 메시지 역할 |
| `content` | string | 메시지 내용 |
| `timestamp` | number | Unix 밀리초 타임스탬프 |
| `uiSpec` | object (optional) | 동적 UI 명세 |

```bash
curl http://localhost:3000/sessions/550e8400-.../messages
```

---

### POST /sessions/:id/ui-actions

동적 UI 패널의 폼 제출 결과를 Manager에 전달합니다. Manager에 `info_response` 메시지로 발행됩니다.

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `action` | string | 예 | UISpec의 `submitAction` 값 |
| `data` | object | 예 | 폼 입력 데이터 (필드 ID → 값) |

```json
{
  "action": "submit_requirements",
  "data": { "service_type": "ecommerce", "features": ["products", "payment"] }
}
```

**응답 202**

```json
{ "status": "accepted" }
```

**응답 400**

```json
{ "error": "action is required" }
```

---

### GET /sessions/:id/tasks

세션의 태스크 목록을 반환합니다.

**응답 200**

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

**Task 객체:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string (UUID) | 태스크 ID |
| `sessionId` | string (UUID) | 소속 세션 ID |
| `status` | `"pending"` \| `"running"` \| `"completed"` \| `"failed"` | 태스크 상태 |
| `intent` | string | xzawedManager로 전달된 작업 의도 |
| `result` | string \| null | 완료 시 결과 내용 |
| `createdAt` | number | Unix 밀리초 타임스탬프 |
| `updatedAt` | number | Unix 밀리초 타임스탬프 |

---

## 인증

`DATABASE_URL`과 `USER_JWT_SECRET`을 모두 설정해야 아래 엔드포인트가 등록됩니다.

`/auth/register`와 `/auth/login`은 IP당 분당 5회, `/auth/refresh`는 분당 20회 Rate Limit이 적용됩니다.

### POST /auth/register

새 사용자를 등록합니다.

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `email` | string | 예 | 이메일 주소 |
| `password` | string | 예 | 비밀번호 (8자 이상) |
| `displayName` | string | 아니오 | 표시 이름 |

**응답 201**

```json
{
  "user": { "id": "uuid", "email": "user@example.com", "displayName": "홍길동", "createdAt": "2026-05-22T00:00:00.000Z" },
  "accessToken": "<JWT, 15분 유효>",
  "refreshToken": "<opaque token, 30일 유효>"
}
```

**응답 409** (이메일 중복)

```json
{ "error": "Email already registered" }
```

---

### POST /auth/login

이메일·비밀번호로 로그인합니다.

**요청 본문:**

```json
{ "email": "user@example.com", "password": "password123" }
```

**응답 200**

```json
{
  "user": { "id": "uuid", "email": "user@example.com", "displayName": "홍길동", "createdAt": "..." },
  "accessToken": "<JWT>",
  "refreshToken": "<opaque token>"
}
```

**응답 401**

```json
{ "error": "Invalid credentials" }
```

---

### POST /auth/refresh

refresh token으로 새 access token을 발급합니다. 기존 refresh token은 rotation 방식으로 폐기됩니다.

**요청 본문:**

```json
{ "refreshToken": "<opaque token>" }
```

**응답 200**

```json
{ "accessToken": "<새 JWT>", "refreshToken": "<새 opaque token>" }
```

---

### POST /auth/logout

`Authorization: Bearer <accessToken>` 헤더가 필요합니다. 현재 사용자의 모든 refresh token을 폐기합니다.

**응답 200**

```json
{ "ok": true }
```

---

### GET /auth/me

`Authorization: Bearer <accessToken>` 헤더가 필요합니다.

**응답 200**

```json
{ "user": { "id": "uuid", "email": "user@example.com", "displayName": "홍길동", "createdAt": "2026-05-22T00:00:00.000Z" } }
```

---

## 프로젝트

`DATABASE_URL`과 `USER_JWT_SECRET`을 모두 설정해야 아래 엔드포인트가 등록됩니다. 모든 엔드포인트는 `Authorization: Bearer <accessToken>` 헤더가 필요합니다.

### GET /projects

현재 사용자의 프로젝트 목록을 반환합니다.

**응답 200**

```json
{
  "projects": [
    {
      "id": "uuid", "userId": "uuid", "name": "쇼핑몰 서비스", "slug": "my-shop",
      "description": "온라인 쇼핑몰", "githubOwner": "myorg", "githubRepo": "my-shop",
      "githubBranch": "main", "createdAt": "2026-05-22T00:00:00.000Z", "updatedAt": "2026-05-22T00:00:00.000Z"
    }
  ]
}
```

---

### POST /projects

새 프로젝트를 생성합니다.

**요청 본문:**

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | 예 | 프로젝트 이름 |
| `description` | string | 아니오 | 프로젝트 설명 |
| `githubOwner` | string | 아니오 | GitHub 조직 또는 사용자명 |
| `githubRepo` | string | 아니오 | GitHub 레포지토리명 |
| `githubBranch` | string | 아니오 | 기본 브랜치 (기본값: `main`) |

**응답 201**

```json
{ "project": { "id": "uuid", "name": "쇼핑몰 서비스", "..." } }
```

---

### GET /projects/:id

프로젝트 단건을 반환합니다.

**응답 200**

```json
{ "project": { "id": "uuid", "name": "쇼핑몰 서비스", "..." } }
```

---

### PATCH /projects/:id

전달한 필드만 업데이트합니다.

**요청 본문:**

```json
{ "name": "새 이름", "description": "새 설명", "githubBranch": "develop" }
```

**응답 200**

```json
{ "project": { "id": "uuid", "name": "새 이름", "..." } }
```

---

### DELETE /projects/:id

프로젝트를 삭제합니다.

**응답 204**

---

### PUT /projects/:id/github-token

GitHub Personal Access Token을 AES-256-GCM으로 암호화하여 저장합니다. `GITHUB_TOKEN_ENCRYPTION_KEY` 미설정 시 503을 반환합니다.

**요청 본문:**

```json
{ "token": "ghp_..." }
```

**응답 204**

---

### DELETE /projects/:id/github-token

저장된 GitHub PAT를 삭제합니다.

**응답 204**

---

### GET /projects/:id/github-token/status

GitHub PAT 저장 여부를 반환합니다. 토큰 값은 포함되지 않습니다.

**응답 200**

```json
{ "exists": true }
```

---

## 다음 단계

- [WebSocket 프로토콜](websocket.md) — 실시간 스트리밍 연결
- [MCP 도구 레퍼런스](mcp-tools.md) — MCP로 세션 관리
