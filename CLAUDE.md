# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 플랫폼 개요

xzawedPAIS는 AI 멀티 에이전트 오케스트레이션 플랫폼이다. 사용자가 원하는 것을 자연어로 설명하면 특화된 Claude 에이전트들이 계획 → 개발 → 디자인 → 테스트 → 빌드 → 모니터링을 자동으로 수행한다.

**모든 서비스는 이 단일 저장소에서 관리된다.** 서비스 간 통신은 Redis Streams만 사용하며, 서비스끼리 직접 import하지 않는다.

전체 API·가이드·설계 스펙은 [`docs/`](docs/README.md)를 참고한다.

## 서비스 전체 현황

| 서비스 | 포트 | 상태 | 역할 | 상세 |
|---|---|---|---|---|
| xzawedOrchestrator | 3000 | ✅ v0.1.0 | 사용자 지시 수신·정제 후 Manager에 전달 | [CLAUDE.md](xzawedOrchestrator/CLAUDE.md) |
| xzawedManager | 3001 | ✅ 51/51 | Claude tool-calling 루프, 하위 에이전트 디스패치 | [CLAUDE.md](xzawedManager/CLAUDE.md) |
| xzawedPlanner | 3002 | ✅ 완성 | intent → 실행 가능한 Step[] 분해 | [CLAUDE.md](xzawedPlanner/CLAUDE.md) |
| xzawedDeveloper | 3003 | ✅ 31/31 | 코드 생성·수정, 파일 I/O | [CLAUDE.md](xzawedDeveloper/CLAUDE.md) |
| xzawedDesigner | 3004 | ✅ 26/26 | UI 컴포넌트 스펙 설계 | [CLAUDE.md](xzawedDesigner/CLAUDE.md) |
| xzawedTester | 3005 | ✅ 28/28 | 테스트 실행·분석 | [CLAUDE.md](xzawedTester/CLAUDE.md) |
| xzawedBuilder | 3006 | ✅ v0.2.0 | 프로젝트 빌드 감지·실행 | [CLAUDE.md](xzawedBuilder/CLAUDE.md) |
| xzawedWatcher | 3007 | ✅ 26/26 | 파일 변경 감시·이벤트 스트리밍 | [CLAUDE.md](xzawedWatcher/CLAUDE.md) |
| xzawedSecurity | 3008 | ✅ 45/45 | OWASP 보안 감사 | [CLAUDE.md](xzawedSecurity/CLAUDE.md) |

## 공통 기술 스택

TypeScript 5 (strict mode) 공통 적용. 모든 서비스가 사용:

- **Fastify 5** — HTTP 서버 (`/health` 엔드포인트)
- **ioredis** — Redis Streams 소비자/생산자
- **Zod** — 환경변수 검증 및 스키마
- **@anthropic-ai/sdk** — Claude API 호출
- **Vitest 2/3** — 테스트 (`pool: 'forks'`, 프로세스 격리)
- **pnpm** — 패키지 매니저 (npm/yarn 사용 금지)

xzawedOrchestrator 추가: **@modelcontextprotocol/sdk** (MCP 서버), **React 19 + Zustand** (Electron UI, Phase 2), **Turborepo** (xzawedOrchestrator·xzawedManager 모노레포).

## 공통 명령어 패턴

### Turborepo 기반 (xzawedOrchestrator, xzawedManager)

```bash
pnpm install
pnpm build                              # 전체 빌드
pnpm test                               # 전체 테스트
cd packages/server && pnpm dev          # 서버 개발 모드
cd packages/server && pnpm test <파일>  # 단일 테스트 파일
```

### 독립 서비스 (그 외 모든 에이전트)

```bash
pnpm install
pnpm dev               # tsx watch 개발 모드
pnpm test              # Vitest 전체 실행
pnpm test <파일>       # 단일 테스트 파일
pnpm build             # TypeScript 컴파일 → dist/
```

## Redis Streams 통신 구조

스트림 키 규칙:

```
{출발지}:to-{목적지}:{sessionId}   →   소비자 그룹: {목적지}-consumers
```

실제 예: `orchestrator:to-manager:{sessionId}`, `manager:to-planner:{sessionId}`, `{agent}:to-manager:{sessionId}` 등. 모든 에이전트는 `manager:to-{agent}:{sessionId}` 수신 → `{agent}:to-manager:{sessionId}` 응답 패턴을 따른다.

모든 메시지 공통 구조:

```typescript
{
  sessionId: string
  messageId: string
  timestamp: number
  type: string      // 서비스별 정의
  payload: object   // 서비스별 정의
}
```

## 공통 환경 변수

모든 서비스의 `.env.example`을 `.env`로 복사 후 실행.

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=<서비스별 포트>
MODE=local
```

서비스별 추가 환경 변수, 메시지 인터페이스, 아키텍처 세부 사항은 각 서비스 디렉토리의 `CLAUDE.md`를 참고한다.
