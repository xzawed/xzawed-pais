# CLAUDE.md — xzawedShared

## 프로젝트 개요

xzawedShared(`@xzawed/agent-streams`)는 xzawed 멀티 에이전트 시스템의 **공통 기반 라이브러리**다.
7개 독립 에이전트 서비스가 공통으로 사용하는 `BaseConsumer<T>` 제네릭 Redis Streams 소비자와 경로 보안 유틸리티를 제공한다.

**현재 상태: 구현 완료 (6/6 테스트 통과)**

## 핵심 명령어

```bash
pnpm install       # 의존성 설치
pnpm build         # TypeScript 컴파일 → dist/ (다른 서비스 테스트 전 반드시 먼저 실행)
pnpm typecheck     # tsc 타입 체크
pnpm test          # Vitest 테스트
```

## 디렉토리 구조

```
src/
├── index.ts                     # 패키지 진입점 — BaseConsumer, validateWorkspaceRoot, SessionDispatcher 익스포트
├── workspace-guard.ts           # validateWorkspaceRoot() — 파일시스템 루트 거부
├── session-dispatcher.ts        # SessionDispatcher — per-session 동적 consumer 팩토리
├── streams/
│   └── base-consumer.ts         # BaseConsumer<T> 제네릭 클래스
└── __tests__/
    ├── workspace-guard.test.ts  # validateWorkspaceRoot 2건 테스트
    └── session-dispatcher.test.ts  # SessionDispatcher 테스트
```

## BaseConsumer 패턴

```typescript
class BaseConsumer<TMessage> {
  constructor(
    redis: Redis,
    onMessage: (msg: TMessage) => Promise<void>,
    consumerGroup: string,
    consumerName: string,
    streamPrefix: string,            // 예: 'manager:to-tester'
    schema: ZodType<TMessage>,       // safeParse로 메시지 검증
    sleep?: (ms: number) => Promise<void>  // 테스트용 주입
  )

  async start(sessionId: string): Promise<void>  // XREADGROUP 루프 시작
  stop(): void                                    // 루프 중단
}
```

**동작 세부사항:**
- `start(sessionId)`: 스트림 `${streamPrefix}:${sessionId}` 구독. Consumer Group 자동 생성 (BUSYGROUP 무시)
- 메시지 처리: `JSON.parse(raw)` → `schema.safeParse()` → `onMessage()` → `xack` (`try/finally`로 xack 보장)
- 파싱/검증 실패 시: 경고 로그 출력 후 xack하고 skip (프로세스 중단 없음)
- 오류 재시도: 1초부터 시작해 최대 30초까지 지수 백오프

## validateWorkspaceRoot 패턴

```typescript
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

// executor.ts의 validatePath() 최상단에서 호출
validateWorkspaceRoot(workspaceRoot)  // 파일시스템 루트(/, C:\)이면 즉시 throw
```

`path.resolve(workspaceRoot) === path.parse(resolved).root`이면 `Error('WORKSPACE_ROOT must not be filesystem root')` throw.

Builder, Tester, Watcher, Security 4개 서비스의 `executor.ts`에서 공통 사용.

## SessionDispatcher 패턴

Phase 3에서 추가된 per-session 동적 consumer 팩토리. 게이트웨이 스트림을 구독해 세션별 독립 consumer를 생성한다.

## 의존 관계

```
xzawedShared (@xzawed/agent-streams)
    ↑ 사용
xzawedPlanner / xzawedDeveloper / xzawedDesigner /
xzawedTester / xzawedBuilder / xzawedWatcher / xzawedSecurity
```

## 주의사항

- **다른 서비스 테스트 전 반드시 먼저 빌드**: `pnpm build`
- CI 워크플로우(`ci.yml`)는 xzawedShared를 먼저 빌드 후 나머지 서비스를 병렬 실행
- 로컬에서 `pnpm build` 없이 독립 에이전트 서비스 테스트를 실행하면 `@xzawed/agent-streams` 패키지를 찾지 못해 실패

## 환경 변수

없음. 순수 라이브러리이며 직접 실행되지 않는다.
