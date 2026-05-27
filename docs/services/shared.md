[홈](../README.md) > [서비스](.) > xzawedShared

# xzawedShared (@xzawed/agent-streams)

7개 독립 에이전트 서비스가 공통으로 사용하는 기반 라이브러리.

---

## 제공 기능

| 익스포트 | 설명 |
|----------|------|
| `BaseConsumer<T>` | 제네릭 Redis Streams 소비자 |
| `SessionDispatcher` | per-session 동적 consumer 팩토리 (Phase 3) |
| `validateWorkspaceRoot(path)` | 파일시스템 루트 방어 |

---

## BaseConsumer 사용법

```typescript
import { BaseConsumer } from '@xzawed/agent-streams'
import { z } from 'zod'

const consumer = new BaseConsumer(
  redis,
  async (msg) => { /* 처리 */ },
  'my-consumers',           // consumer group
  'my-consumer-1',          // consumer name
  'manager:to-myservice',   // stream prefix
  MyMessageSchema,          // Zod 스키마
)

await consumer.start(sessionId)  // XREADGROUP 루프 시작
consumer.stop()                  // 루프 중단
```

**동작 보장**:
- Consumer Group 자동 생성 (BUSYGROUP 무시)
- 메시지 처리: `JSON.parse` → `safeParse` → `onMessage` → `xack` (`try/finally`)
- 파싱 실패 시 경고 로그 + xack + skip (프로세스 중단 없음)
- 재연결: 1초~30초 지수 백오프

---

## validateWorkspaceRoot 사용법

```typescript
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

// 서비스 시작 시 호출 (executor.ts 또는 config 로드 시)
validateWorkspaceRoot(config.workspaceRoot)
// path.resolve(workspaceRoot) === path.parse(resolved).root 이면 throw
```

---

## SessionDispatcher

Phase 3(PR #122)에서 추가된 per-session 동적 consumer 팩토리.

**사용법:**
게이트웨이 스트림을 구독하고, 세션 알림 수신 시 서비스별 Consumer를 동적으로 생성한다.

**생성자:**
- `gatewayStream`: 수신할 게이트웨이 스트림 키 (예: `manager:to-planner:sessions`)
- `consumerFactory`: `(sessionId: string) => ConsumerLike` — 세션별 consumer 생성 함수

**ConsumerLike 인터페이스:**
```typescript
interface ConsumerLike {
  start(sessionId: string): Promise<void>
  stop(): void
}
```

**`@xzawed/agent-streams` 현재 exports:**
1. `BaseConsumer` — 단일 스트림 소비자 기반 클래스
2. `SessionDispatcher` — per-session 동적 consumer 팩토리
3. `validateWorkspaceRoot(root: string): void` — 워크스페이스 루트 검증

---

## 의존 서비스

xzawedPlanner, xzawedDeveloper, xzawedDesigner, xzawedTester, xzawedBuilder, xzawedWatcher, xzawedSecurity

---

## 빌드 선행 요건

독립 에이전트 서비스 테스트 실행 전 반드시 먼저 빌드:

```bash
cd xzawedShared && pnpm install && pnpm build
```

---

## 관련 문서

- [코딩 컨벤션](../development/conventions.md)
- [보안 패턴](../development/security-patterns.md)
