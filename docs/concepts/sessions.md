[홈](../index.md) > [개념](.) > 세션 수명주기

# 세션 수명주기

세션은 xzawedOrchestrator에서 사용자와 에이전트 파이프라인 간의 독립된 대화 컨텍스트다.

---

## 세션이 하는 일

세션은 하나의 작업 흐름 전체를 추적한다. 각 세션은 다음을 포함한다.

```typescript
// packages/shared/src/types/session.ts
export interface Session {
  id: string           // UUID
  userId: string
  projectId?: string   // 프로젝트 연동 시 설정
  state: SessionState
  claudeMode: ClaudeMode
  createdAt: number    // Unix ms
  updatedAt: number    // Unix ms
}
```

단일 사용자도 여러 세션을 병렬로 운영할 수 있다. 각 Electron 창 또는 API 연결이 독립된 세션을 구성한다.

---

## 세션 상태 머신

```
POST /sessions
    │
    ▼
 [active] ──── 메시지 전송 ────► [waiting_manager]
    │                                    │
    │                           Manager 회신
    │                                    │
    │                                    ▼
    │                           [waiting_user] ◄─┐
    │                                    │       │
    │                           사용자 응답       │
    │                                    │       │
    │                                    └───────┘ (추가 info_request 발생 시)
    │
    ├──────────────────────────────────► [completed]
    └──────────────────────────────────► [error]
```

| 상태 | 설명 |
|------|------|
| `active` | 세션 활성. 사용자 입력 대기 또는 처리 중 |
| `waiting_manager` | Orchestrator가 Manager에 작업을 전달하고 회신 대기 중 |
| `waiting_user` | Manager가 추가 정보를 요청하여 사용자 응답 대기 중 |
| `completed` | 작업이 정상적으로 완료됨 |
| `error` | 처리 중 오류 발생 |

---

## 세션 생성 흐름

`POST /sessions`를 호출하면 서버는 다음을 동시에 초기화한다.

1. `InMemorySessionStore` (또는 `PgSessionStore`)에 세션 엔티티 저장
2. `messageStore` 초기화 (PostgreSQL 없는 경우 인메모리 Map)
3. Manager에 `startSession` 요청 (`manager.client.ts`)
4. `StreamConsumer` 시작 — `manager:to-orchestrator:{sessionId}` 구독

```bash
POST /sessions
Content-Type: application/json

{"userId": "user-123", "projectId": "proj-456"}
```

```json
HTTP 201
{"sessionId": "550e8400-e29b-41d4-a716-446655440000"}
```

`AUTH=jwt` 모드에서는 JWT 토큰의 `sub`가 `userId`로 사용되고, `projectId`는 요청 바디에서 받는다. 인증된 사용자는 자신이 소유한 프로젝트에만 세션을 생성할 수 있다.

---

## 세션 격리 방식

세션 격리는 두 레이어에서 이루어진다.

### Redis Streams 키 격리

```
orchestrator:to-manager:{sessionId}
manager:to-orchestrator:{sessionId}
```

`sessionId`가 스트림 키에 포함되므로 서로 다른 세션의 메시지는 물리적으로 분리된다.

### 저장소 격리

```typescript
// InMemorySessionStore: 세션별 독립 Map 항목
private readonly sessions = new Map<string, Session>()
private readonly claudeSessionIds = new Map<string, string>()

// 메시지도 세션 ID로 분리 저장
const messageStore = new Map<string, Message[]>()
```

PostgreSQL 사용 시 `sessions` 테이블의 `id` 컬럼으로 격리된다.

---

## 세션 저장 방식

| 구성 | 세션 저장 방식 | 메시지 저장 방식 |
|------|---------------|-----------------|
| `DATABASE_URL` 미설정 | `InMemorySessionStore` (Map) | 인메모리 `messageStore` |
| `DATABASE_URL` 설정 | `PgSessionStore` (PostgreSQL) | `MessageRepo` (PostgreSQL) |

인메모리 모드에서는 서버 재시작 시 세션 메타데이터가 초기화된다. 단, Redis Streams에 남아 있는 미처리 메시지는 재시작 후 자동 재개된다.

---

## 태스크와 세션의 관계

메시지를 전송하면 서버는 Claude로 의도를 정제하고 `TaskStore`에 태스크를 등록한 뒤 Manager에 전달한다.

```
POST /sessions/:id/messages
    │
    ▼
ClaudeRunner.send()  ← 의도 파악 스트리밍
    │
    ▼
structureIntent()    ← 1-2문장 intent 정제
    │
    ▼
TaskStore.create()   ← pending 상태로 등록
    │
    ▼
StreamProducer.publish()  ← task_request 발행
    │
    ▼ Manager 응답 수신
TaskStore.update()  ← status_update → running
                    ← task_complete → completed
                    ← error → failed
```

`GET /sessions/:id/tasks`로 태스크 목록과 상태를 조회한다.

---

## 서비스 중단과 재개

서버가 중단되면 Redis Streams의 PEL(Pending Entry List)에 미처리 메시지가 유지된다. 재시작 후 `StreamConsumer`가 PEL을 스캔하여 자동으로 재처리한다. 자세한 내용은 [Redis Streams 메시징](redis-streams.md)을 참고한다.

---

## 관련 문서

- [Redis Streams 메시징](redis-streams.md) — ACK 기반 메시지 신뢰성 상세
- [동적 UI 패널](dynamic-ui.md) — waiting_user 상태와 UISpec의 관계
- [REST API 레퍼런스](../reference/rest-api.md) — 세션 관련 API 엔드포인트
- [WebSocket 프로토콜](../reference/websocket.md) — 실시간 이벤트 포맷
- [시스템 아키텍처](architecture.md)
