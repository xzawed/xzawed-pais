# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

xzawedShared(`@xzawed/agent-streams`)는 xzawed 멀티 에이전트 시스템의 **공통 기반 라이브러리**다.  
7개 독립 에이전트 서비스(Planner, Developer, Designer, Tester, Builder, Watcher, Security)가 공통으로 사용하는 `BaseConsumer<T>` 제네릭 Redis Streams 소비자와 경로 보안 유틸리티를 제공한다.

현재 상태: **구현 완료 (2/2 테스트)** — BaseConsumer 제네릭 추상 클래스, validateWorkspaceRoot 유틸리티, 타입 익스포트

## 핵심 명령어

```bash
# 의존성 설치
pnpm install

# 빌드 (다른 서비스 테스트 전 반드시 먼저 실행)
pnpm build

# 타입 체크
pnpm typecheck

# 테스트
pnpm test
```

## 아키텍처

```
src/
├── index.ts                  # 패키지 진입점 — BaseConsumer, validateWorkspaceRoot 익스포트
├── workspace-guard.ts        # validateWorkspaceRoot() — 파일시스템 루트 WORKSPACE_ROOT 거부
├── streams/
│   └── base-consumer.ts      # BaseConsumer<T> 제네릭 추상 클래스
└── __tests__/
    └── workspace-guard.test.ts  # validateWorkspaceRoot 2건 테스트
```

## BaseConsumer 패턴

```typescript
abstract class BaseConsumer<T> {
  abstract parseMessage(data: Record<string, string>): T | null
  async start(sessionId: string, onMessage: (msg: T) => Promise<void>): Promise<void>
  stop(): void
}
```

- `parseMessage()`: Redis 원시 필드 맵 → 타입 `T` 변환 (safeParse 사용 권장)
- `start()`: Redis XREADGROUP 루프, `try/finally`로 xack 보장 (PEL 누수 방지)
- `stop()`: 루프 중단 플래그 설정

## validateWorkspaceRoot 패턴

```typescript
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

// validatePath() 최상단에서 호출
validateWorkspaceRoot(workspaceRoot)  // 파일시스템 루트(/, C:\)이면 즉시 throw
```

- `validateWorkspaceRoot(workspaceRoot)`: `path.resolve` 후 `path.parse().root`와 동일하면 `Error('WORKSPACE_ROOT must not be filesystem root')` throw
- Builder, Tester, Watcher, Security 4개 서비스의 `executor.ts`에서 공통 사용

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

없음. 이 패키지는 순수 라이브러리이며 직접 실행되지 않는다.
