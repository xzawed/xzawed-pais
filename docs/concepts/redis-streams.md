[홈](../index.md) > [개념](.) > Redis Streams 메시징

# Redis Streams 메시징

xzawedOrchestrator는 xzawedManager와의 비동기 통신에 Redis Streams를 사용합니다. 이 문서는 Redis Streams를 선택한 이유, 스트림 구조, ACK 기반 신뢰성, 장애 복구 동작을 설명합니다.

---

## Redis Streams를 선택한 이유

일반 Redis Pub/Sub 대신 Streams를 선택한 이유는 다음과 같습니다.

| 요구사항 | 일반 Pub/Sub | Redis Streams |
|----------|-------------|---------------|
| 서비스 중단 시 메시지 보존 | 불가 (메모리에서 즉시 소멸) | 가능 (스트림에 영속) |
| 재시작 후 미처리 메시지 재개 | 불가 | Consumer Group + ACK으로 가능 |
| 메시지 처리 순서 보장 | 보장 없음 | ID 기반 순서 보장 |
| 메시지 이력 조회 | 불가 | 스트림 범위 조회 가능 |
| 세션별 격리 | 채널 이름으로 가능 | 스트림 키로 가능 |

---

## 스트림 구조

각 세션마다 두 개의 스트림이 생성됩니다.

```
orchestrator:to-manager:{sessionId}   지휘자 → 매니저
manager:to-orchestrator:{sessionId}   매니저 → 지휘자
```

`{sessionId}`에 UUID를 포함하여 **세션 간 완전 격리**를 보장합니다. 서로 다른 사용자나 창의 메시지가 절대 섞이지 않습니다.

---

## 메시지 포맷

### 지휘자 → 매니저

스트림 키: `orchestrator:to-manager:{sessionId}`

```typescript
interface OrchestratorToManagerMessage {
  sessionId: string
  messageId: string       // UUID
  timestamp: number       // Unix ms
  type: 'task_request' | 'info_response' | 'abort'
  payload: {
    intent: string        // 정제된 사용자 의도
    context: Record<string, unknown>  // 수집된 요구사항
    priority: 'normal' | 'high'
    userContext?: {       // 프로젝트 연동 시 포함
      userId: string
      projectId: string
      workspaceRoot: string
      githubRepo?: { owner: string; repo: string; branch: string }
    }
  }
}
```

**메시지 타입:**

| 타입 | 설명 |
|------|------|
| `task_request` | 새 작업 요청 (가장 일반적) |
| `info_response` | 매니저의 정보 요청에 대한 사용자 응답 |
| `abort` | 작업 중단 요청 |

### 매니저 → 지휘자

스트림 키: `manager:to-orchestrator:{sessionId}`

```typescript
interface ManagerToOrchestratorMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'status_update' | 'info_request' | 'task_complete' | 'error'
  payload: {
    agentId: string       // 어느 하위 에이전트의 메시지인지
    content: string
    uiSpec?: UISpec       // 추가 입력이 필요한 경우 폼 스펙
  }
}
```

**메시지 타입:**

| 타입 | 설명 |
|------|------|
| `status_update` | 작업 진행 상황 업데이트 |
| `info_request` | 사용자에게 추가 정보 요청 (uiSpec 포함 가능) |
| `task_complete` | 작업 완료 보고 |
| `error` | 오류 발생 보고 |

---

## ACK 기반 신뢰성

Consumer Group과 ACK 메커니즘으로 메시지 처리 신뢰성을 보장합니다.

```
Consumer Group: orchestrator-consumers

XREADGROUP GROUP orchestrator-consumers consumer-{pid}
  COUNT 10
  BLOCK 2000
  STREAMS manager:to-orchestrator:{sessionId} >

  ↓ 메시지 수신

handler(message) 실행
  │
  └── 성공/실패 무관하게 → XACK manager:to-orchestrator:{sessionId} orchestrator-consumers {id}
                           (항상 ACK — PEL 누수 방지)
```

`>` 기호는 "아직 다른 컨슈머에게 전달되지 않은 새 메시지만"을 의미합니다. 재시작 후에는 PEL(Pending Entry List)을 확인하여 처리되지 않은 메시지를 재처리합니다.

---

## 장애 복구 동작

### 서비스 중단 시나리오

```
시나리오: 매니저에서 메시지 도착 후 처리 도중 서버 중단

1. 메시지 수신: manager:to-orchestrator:{sessionId}에 메시지 도착
2. XREADGROUP으로 읽기 완료 (PEL에 등록)
3. handler() 실행 중...
4. 서버 프로세스 강제 종료
5. XACK 호출되지 않음 → 메시지는 PEL에 유지

서버 재시작:
1. StreamConsumer 초기화
2. XREADGROUP으로 PEL 스캔
3. 처리되지 않은 메시지 재수신
4. handler() 재실행
5. XACK로 완료 처리
```

> **Warning:** handler()가 멱등성(idempotency)을 보장해야 합니다. 재시작 후 동일 메시지가 두 번 처리될 수 있습니다. `messageId`를 이용하여 중복 처리를 방지하세요.

---

## Redis 없이 실행하기

Redis가 설치되지 않은 환경에서는 자동으로 `ioredis-mock` 인메모리 폴백이 적용됩니다. 단, 인메모리 폴백은 **서버 재시작 시 스트림 데이터가 초기화**되므로 개발·테스트 환경에서만 사용하세요.

---

## 구현 참조

```typescript
// packages/server/src/streams/producer.ts
export class StreamProducer {
  async publish(message: OrchestratorToManagerMessage): Promise<string> {
    const redis = getRedisClient(this.redisUrl)
    return redis.xadd(
      `orchestrator:to-manager:${message.sessionId}`,
      '*',        // Redis가 자동으로 ID 생성
      'data',
      JSON.stringify(message)
    )
  }
}

// packages/server/src/streams/consumer.ts
export class StreamConsumer {
  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)
    while (this.running) {
      const results = await redis.xreadgroup(
        'GROUP', GROUP, `consumer-${process.pid}`,
        'COUNT', '10', 'BLOCK', '2000',
        'STREAMS', `manager:to-orchestrator:${sessionId}`, '>'
      )
      for (const [id, msg] of entries) {
        try {
          await handler(msg)
        } finally {
          await redis.xack(streamKey, GROUP, id)  // 성공/실패 무관하게 항상 ACK — PEL 누수 방지
        }
      }
    }
  }
}
```

---

## 다음 단계

- [세션 수명주기](sessions.md) — 세션과 스트림의 관계
- [환경변수 목록](../reference/environment-variables.md) — Redis 관련 설정

---

## 관련 문서

- [시스템 아키텍처](architecture.md)
- [설정 옵션 완전 가이드](../guides/configuration.md)
