[홈](../README.md) > [서비스](.) > xzawedShared

# xzawedShared (@xzawed/agent-streams)

7개 독립 에이전트 서비스가 공통으로 사용하는 기반 라이브러리.

---

## 제공 기능

서비스가 늘며 단순 소비자 라이브러리에서 **공통 계약·복원력 코어 모음**으로 확장됐다. 모듈 패밀리별 요약(상세·사용 예시는 [xzawedShared/CLAUDE.md](../../xzawedShared/CLAUDE.md)):

| 모듈 패밀리 | 주요 익스포트 | 설명 |
|------------|--------------|------|
| `streams/base-consumer` | `BaseConsumer<T>`, `defaultDedupKey` | 제네릭 Redis Streams 소비자 — 바운드 재시도·DLQ 격리·멱등 소비(M6)·never-throws |
| `streams/dlq` | `redriveDlq`, `dlqStreamKey`, `idemKey`, `DlqMessageSchema` | DLQ 계약 단일출처 + 격리 메시지 재처리 운영 도구 |
| `streams/event-bus` | `RedisEventBus`, `EventBus`/`StreamConsumerPort`/`RequestReplyPort` | 전송 추상화(발행·그룹소비·RPC 라운드트립 포트) — Redis 명령을 한 어댑터로 집약 |
| `streams/session-dispatcher` | `SessionDispatcher`, `ConsumerLike` | per-session 동적 consumer 팩토리 (Phase 3) |
| `streams/collaboration` | `runCollaborativeHandle`, `createCollaborativeHandler` | 7개 에이전트 handle 골격(abort·query·정상·error) 공통화 |
| `workspace-guard` | `validateWorkspaceRoot`, `resolveWorkspaceRoot` | 파일시스템 루트 방어 + 워크스페이스 경로 해석 |
| `claude/answer-query` | `callClaudeText`, `answerViaClaude`, `extractClaudeText` | Claude 호출·텍스트 추출·교차질의 응답 공통 로직 |
| `prompt/domain-knowledge` | `formatDomainKnowledge` | 도메인 위키 주입 포매터 |
| `types/agent-query` | `AgentQuerySchema`, `parseAgentQuery`, `collaborationPayloadFields` | AgentQuery 교차질의 타입·스키마 |
| `types/event-envelope` | `EventEnvelopeSchema`, `makeEnvelope` | correlation/causation/idempotency 봉투 |
| `types/work-package` | `WorkPackageSchema` | §7 WP 계약(risk·inputs·outputs·epicId·고정 `attributionCounters{impl,task,plan}`) |
| `task-graph` | `buildTaskGraph`, `detectCycle`, `topoSort`, `readyNodes`, `oracleSatisfiedSet` | P1d Task Manager 순수 그래프 코어 + P3-1 DoR satisfied-set |
| `decomposition` | `coverageMatrix`, `contentHashId`, `mergeKeepInflight` | P2-1 결정론 분해 코어(커버리지·안정 ID·재진입 병합) |
| `budget` | `costOf`, `MODEL_PRICING`, `BudgetCircuitBreaker`, `BudgetExceededError` | §13 budget 서킷(토큰 비용 워크플로/일 상한·fail-closed) |
| `resilience` | `ProviderCircuitBreaker`, `Bulkhead`, `ProviderCircuitOpenError` | §13 provider 서킷(장애 fail-fast) + 벌크헤드(종류별 풀·FIFO 큐) |
| `risk` | `scoreClassification`, `routeModels`, `combineRisk`, `evaluateHumanGate`, `RiskClassificationSchema` | P2r-1 Wiki Agent 리스크 분류 결정론 코어(LLM/IO 0·라우팅 §5·사람 게이트 §4) |

> ⚠️ `risk/`의 §19 캘리브레이션 상수(`FULL_CONFIDENCE_SUPPORT`·`*_SCORE_THRESHOLD`·`LOW_CONFIDENCE_THRESHOLD`)는 `risk/index.ts`에서만 export되고 **top-level 배럴(`src/index.ts`)에는 아직 미re-export**다 — `@xzawed/agent-streams`로 직접 import 불가. P2r-2/3/4 배선 시 배럴 라인을 복원한다.

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

**`@xzawed/agent-streams` 전체 export 목록**은 위 [제공 기능](#제공-기능) 표 + 배럴 [`xzawedShared/src/index.ts`](../../xzawedShared/src/index.ts)를 단일 진실원천으로 한다. 위 3개는 가장 오래된 핵심 export일 뿐이며, 현재는 16개 모듈 패밀리(스트림·계약·복원력·분해·리스크 코어)를 노출한다.

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
