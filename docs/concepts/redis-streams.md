[홈](../index.md) > [개념](.) > Redis Streams 메시징

# Redis Streams 메시징

xzawedPAIS가 서비스 간 비동기 통신에 Redis Streams를 사용하는 방식, 스트림 키 구조, ACK 기반 신뢰성 보장, 장애 복구 동작을 설명한다.

---

## Redis Streams를 선택한 이유

일반 Redis Pub/Sub는 구독자가 오프라인일 때 메시지를 유실한다. Redis Streams는 메시지를 스트림에 영속하고, Consumer Group과 ACK 메커니즘으로 처리 보장을 제공한다.

| 요구사항 | Pub/Sub | Redis Streams |
|----------|---------|---------------|
| 서비스 중단 시 메시지 보존 | 불가 | 스트림에 영속 |
| 재시작 후 미처리 메시지 재개 | 불가 | Consumer Group + ACK |
| 메시지 처리 순서 보장 | 불보장 | ID 기반 순서 보장 |
| 세션별 격리 | 채널 이름 | 스트림 키 |

---

## 스트림 키 구조

xzawedPAIS의 모든 스트림 키는 다음 규칙을 따른다.

```
{출발지}:to-{목적지}:{sessionId}
```

각 세션마다 두 개의 스트림이 존재한다.

```
orchestrator:to-manager:{sessionId}   Orchestrator → Manager
manager:to-orchestrator:{sessionId}   Manager → Orchestrator
```

Manager와 하위 에이전트 간 스트림도 동일한 규칙을 따른다.

```
manager:to-planner:{sessionId}
manager:to-developer:{sessionId}
manager:to-designer:{sessionId}
manager:to-tester:{sessionId}
manager:to-builder:{sessionId}
manager:to-watcher:{sessionId}
manager:to-security:{sessionId}
```

`{sessionId}`에 UUID를 포함함으로써 세션 간 완전 격리를 보장한다.

Consumer Group 이름은 목적지 서비스명을 따른다: `orchestrator-consumers`, `planner-consumers` 등.

---

## 메시지 포맷

### Orchestrator → Manager

스트림 키: `orchestrator:to-manager:{sessionId}`

```typescript
interface OrchestratorToManagerMessage {
  sessionId: string
  messageId: string       // UUID
  timestamp: number       // Unix ms
  type: OrchestratorMessageType
  payload: {
    intent: string        // 정제된 사용자 의도
    context: Record<string, unknown>
    priority: 'normal' | 'high'
    userContext?: UserContext
  }
}

type OrchestratorMessageType = 'task_request' | 'info_response' | 'abort'

interface UserContext {
  userId: string
  projectId: string
  workspaceRoot: string
  githubRepo?: { owner: string; repo: string; branch: string }
}
```

**메시지 타입:**

| 타입 | 설명 |
|------|------|
| `task_request` | 새 작업 요청 |
| `info_response` | Manager의 정보 요청에 대한 사용자 응답 (동적 UI 폼 제출 포함) |
| `abort` | 작업 중단 요청 |

### Manager → Orchestrator

스트림 키: `manager:to-orchestrator:{sessionId}`

```typescript
interface ManagerToOrchestratorMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: ManagerMessageType
  payload: {
    agentId: string       // 어느 하위 에이전트의 메시지인지
    content: string
    uiSpec?: UISpec       // info_request 시 폼 스펙 포함 가능
  }
}

type ManagerMessageType = 'status_update' | 'info_request' | 'task_complete' | 'error'
```

**메시지 타입:**

| 타입 | 설명 | WebSocket 이벤트 |
|------|------|-----------------|
| `status_update` | 작업 진행 상황 | `agent_status` |
| `info_request` | 사용자에게 추가 정보 요청 | `agent_info_request` |
| `task_complete` | 작업 완료 | `agent_done` |
| `error` | 오류 발생 | `agent_error` |

---

## ACK 기반 신뢰성

StreamConsumer는 XREADGROUP으로 메시지를 읽고, 핸들러 실행 후 반드시 XACK를 호출한다.

```
Consumer Group: orchestrator-consumers

XREADGROUP GROUP orchestrator-consumers consumer-{pid}
  COUNT 10 BLOCK 2000
  STREAMS manager:to-orchestrator:{sessionId} >
  ↓
parseRedisEntry()  ← Zod safeParse로 런타임 검증
  ↓
handler(msg) — try/finally
  └── 성공·실패 무관하게 → XACK (PEL 누수 방지)
```

`>` 기호는 "아직 이 Consumer Group에 전달되지 않은 새 메시지"를 의미한다.

수신 메시지는 반드시 Zod `safeParse`로 검증한다. 검증 실패 시 핸들러를 건너뛰고 즉시 XACK를 호출하여 처리 루프를 중단시키지 않는다.

---

## 소스 구현 요약

```typescript
// packages/server/src/streams/producer.ts
export class StreamProducer {
  async publish(message: OrchestratorToManagerMessage): Promise<string> {
    const id = await redis.xadd(
      `orchestrator:to-manager:${message.sessionId}`,
      '*',      // Redis가 자동으로 ID 생성
      'data', JSON.stringify(message)
    )
    if (id === null) throw new Error('Redis xadd returned null')
    return id
  }
}

// packages/server/src/streams/consumer.ts
export class StreamConsumer {
  async start(sessionId: string, handler: MessageHandler): Promise<void> {
    await this.ensureGroup(sessionId)  // XGROUP CREATE MKSTREAM
    while (this.running) {
      const results = await redis.xreadgroup(
        'GROUP', 'orchestrator-consumers', `consumer-${process.pid}`,
        'COUNT', '10', 'BLOCK', '2000',
        'STREAMS', `manager:to-orchestrator:${sessionId}`, '>'
      )
      for (const [id, fields] of entries) {
        const msg = parseRedisEntry(fields)  // Zod safeParse
        if (msg === null) { await ack(id); continue }
        try { await handler(msg) }
        finally { await ack(id) }  // 항상 ACK — PEL 누수 방지
      }
    }
  }
}
```

---

## 장애 복구 동작

서비스가 메시지를 읽은 후 XACK 전에 종료되면, 해당 메시지는 PEL(Pending Entry List)에 남는다.

```
시나리오: handler() 실행 중 서버 강제 종료

1. XREADGROUP으로 메시지 읽기 → PEL에 등록
2. handler() 실행 중 프로세스 종료
3. XACK 미호출 → 메시지 PEL에 유지

서버 재시작:
1. StreamConsumer.start() → ensureGroup() (BUSYGROUP 오류 무시)
2. ID '>' 대신 '0'으로 XREADGROUP → PEL 메시지 재수신
3. handler() 재실행 → XACK
```

handler는 멱등성을 보장해야 한다. 재시작 후 동일 메시지가 두 번 처리될 수 있다. `messageId`로 중복 처리를 방지한다.

---

## Redis 없이 실행하기

Redis가 설치되지 않은 환경에서는 자동으로 `ioredis-mock` 인메모리 폴백이 적용된다. 인메모리 폴백은 서버 재시작 시 스트림 데이터가 초기화되므로 개발·테스트 환경에서만 사용한다.

---

## 관련 문서

- [시스템 아키텍처](architecture.md) — 전체 서비스 구성
- [세션 수명주기](sessions.md) — 세션과 스트림의 관계
- [환경변수 목록](../reference/environment-variables.md) — Redis 관련 설정
