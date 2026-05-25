[홈](../index.md) > [개념](.) > 세션 수명주기

# 세션 수명주기

세션은 xzawedOrchestrator에서 사용자와 지휘자 간의 독립된 대화 컨텍스트입니다.

---

## 세션이란?

각 Electron 창 또는 API 연결 단위가 하나의 **세션(Session)**을 구성합니다. 세션은 다음을 포함합니다.

- 고유한 UUID 식별자 (`sessionId`)
- 사용자 ID (`userId`)
- 현재 상태 (`state`)
- Claude 실행 모드 (`claudeMode`)
- 생성·수정 타임스탬프
- 관련 메시지 이력
- 진행 중인 태스크 큐

단일 사용자도 여러 Electron 창을 동시에 열어 **복수의 세션을 병렬로 운영**할 수 있습니다. 예를 들어, 쇼핑몰 개발과 랜딩 페이지 디자인을 동시에 진행하는 식입니다.

---

## 세션 상태 머신

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
         POST /sessions              ui_spec 생성             │
              │                           │                   │
              ▼                           ▼                   │
          ┌────────┐    메시지 전송   ┌─────────────────┐    │
          │ active │ ─────────────── │ waiting_manager │ ───┤
          └────────┘                 └─────────────────┘    │
              │                              │               │
              │                    매니저 회신               │
              │                              │               │
              │                              ▼               │
              │                   ┌──────────────────┐      │
              │                   │  waiting_user    │ ─────┘
              │                   └──────────────────┘
              │                              │
              │                     사용자 응답
              │                              │
              ▼                              ▼
          ┌───────────┐           ┌──────────────────┐
          │  error    │           │   completed      │
          └───────────┘           └──────────────────┘
```

### 상태 설명

| 상태 | 설명 |
|------|------|
| `active` | 세션 활성. 사용자 입력 대기 또는 처리 중 |
| `waiting_manager` | 지휘자가 xzawedManager에 작업을 전달하고 회신 대기 중 |
| `waiting_user` | 매니저가 추가 정보를 요청하여 사용자 응답 대기 중 |
| `completed` | 작업이 정상적으로 완료됨 |
| `error` | 처리 중 오류 발생 |

---

## 세션 격리 방식

세션 격리는 두 가지 레이어에서 이루어집니다.

### 1. Redis Streams 키 격리

각 세션은 고유한 스트림 키를 사용합니다.

```
orchestrator:to-manager:{sessionId}   # 지휘자 → 매니저
manager:to-orchestrator:{sessionId}   # 매니저 → 지휘자
```

`sessionId`를 스트림 키에 포함함으로써 서로 다른 세션의 메시지가 절대 섞이지 않습니다.

### 2. SessionStore 메모리 격리

서버 내부에서 세션은 `SessionStore`의 독립된 Map 엔트리로 관리됩니다.

```typescript
// 각 세션은 독립된 Map 항목으로 저장됨
const sessions = new Map<string, Session>();

// 메시지도 세션 ID로 분리 저장
const messageStore = new Map<string, Message[]>();
```

---

## 세션 생성

```bash
POST /sessions
Content-Type: application/json

{"userId": "user-123"}
```

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

세션 생성 시 자동으로 다음이 초기화됩니다.

- 빈 메시지 이력
- Redis Streams Consumer Group 생성 (`orchestrator-consumers`)
- 세션 상태 `active`로 설정

---

## 세션 지속성

| 배포 모드 | 세션 저장 방식 |
|-----------|---------------|
| `MODE=local` | 인메모리 (서버 재시작 시 초기화) + Redis Streams 메시지는 보존 |
| `MODE=remote` | 인메모리 + Redis (선택적으로 PostgreSQL 영속화 가능) |

> **Note:** 현재 버전에서 세션 메타데이터는 인메모리에만 저장됩니다. 서버를 재시작하면 세션 목록은 초기화되지만, Redis Streams에 남아 있는 **미처리 메시지는 재시작 후 자동으로 재개**됩니다.

---

## 서비스 중단과 재개

```
서비스 중단 발생
    │
    ▼
Redis Streams에 메시지 보존 (ACK 미완료 상태)
    │
    ▼
서버 재시작
    │
    ▼
StreamConsumer: XREADGROUP에서 PEL(Pending Entry List) 확인
    │
    ▼
미처리 메시지 자동 재처리
    │
    ▼
정상 처리 후 XACK
```

Redis Streams의 Consumer Group과 ACK 메커니즘 덕분에 서비스가 중단되어도 처리 중이던 메시지는 유실되지 않습니다.

---

## 다음 단계

- [Redis Streams 메시징](redis-streams.md) — ACK 기반 메시지 신뢰성 상세
- [REST API 레퍼런스](../reference/rest-api.md) — 세션 관련 API 엔드포인트

---

## 관련 문서

- [시스템 아키텍처](architecture.md)
- [WebSocket 프로토콜](../reference/websocket.md)
