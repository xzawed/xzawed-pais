[홈](../README.md) > [서비스](.) > xzawedShared

# xzawedShared (@xzawed/agent-streams)

7개 독립 에이전트 서비스가 공통으로 사용하는 기반 라이브러리.

---

## 제공 기능

| 익스포트 | 설명 |
|----------|------|
| `BaseConsumer<T>` | 제네릭 Redis Streams 소비자 |
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
