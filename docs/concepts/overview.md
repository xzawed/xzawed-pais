[홈](../README.md) > [개념](./) > 플랫폼 개요

# 플랫폼 개요

xzawedPAIS의 에이전트 계층 구조와 각 서비스의 역할을 설명한다.

---

## 동작 방식

사용자가 자연어로 지시를 입력하면 xzawedPAIS는 다음 순서로 처리한다.

1. **Orchestrator**가 자연어 지시를 수신하고 구조화된 작업 명세로 정제한다.
2. **Manager**가 Claude tool-calling 루프를 통해 작업을 분석하고 전문 에이전트에 위임한다.
3. **전문 에이전트**(Planner, Developer, Designer, Tester, Builder, Watcher, Security)가 각 담당 작업을 수행한다.
4. 결과가 Manager → Orchestrator → 사용자 순으로 전달된다.

모든 서비스 간 통신은 Redis Streams를 통한 비동기 메시지 교환으로 이루어진다. 서비스끼리 직접 import하지 않는다.

---

## 에이전트 계층 구조

```
사용자
  ↕ 자연어 채팅 (Electron 앱 또는 REST API)
xzawedOrchestrator  (포트 3000)
  ↕ Redis Streams
xzawedManager       (포트 3001)
  ↕ Redis Streams
├── xzawedPlanner   (포트 3002)  — 작업 → Step[] 분해
├── xzawedDeveloper (포트 3003)  — 코드 생성·수정
├── xzawedDesigner  (포트 3004)  — UI 컴포넌트 설계
├── xzawedTester    (포트 3005)  — 테스트 실행·분석
├── xzawedBuilder   (포트 3006)  — 빌드 실행·결과 반환
├── xzawedWatcher   (포트 3007)  — 파일 변경 감시 스트리밍
└── xzawedSecurity  (포트 3008)  — OWASP 보안 감사
```

---

## 서비스별 역할

### xzawedOrchestrator (포트 3000)

사용자와 에이전트 팀 사이의 진입점이다.

- 사용자의 자연어 지시를 수신하여 구조화된 작업 명세로 정제한다.
- xzawedManager를 통해 전문 에이전트에 작업을 위임한다.
- 에이전트의 진행 상황을 WebSocket으로 사용자에게 스트리밍한다.
- 추가 입력이 필요할 때 동적 UI 양식을 생성하여 사용자에게 요청한다.
- Electron 데스크탑 앱 UI를 포함한다.

기술 스택: Fastify 5, ioredis, @anthropic-ai/sdk, Turborepo, React 19, Electron, Zustand, Tailwind CSS v4

### xzawedManager (포트 3001)

에이전트 오케스트레이션 계층이다.

- Claude tool-calling 루프를 실행하여 작업을 분석한다.
- 8개 ToolHandler를 통해 전문 에이전트에 작업을 위임한다.
- GitHub 작업(저장소 생성, 브랜치, 커밋, PR)을 직접 처리한다.

기술 스택: Fastify 5, ioredis, @anthropic-ai/sdk, @octokit/rest, Turborepo

### xzawedPlanner (포트 3002)

사용자 의도를 실행 가능한 단계로 분해한다.

- 작업 지시를 받아 순서가 있는 `Step[]` 배열로 변환한다.
- 각 Step에 담당 에이전트와 입력/출력 명세를 포함한다.

### xzawedDeveloper (포트 3003)

코드를 생성하고 수정한다.

- 파일 생성, 수정, 삭제 등 파일 I/O 작업을 수행한다.
- `WORKSPACE_ROOT` 경로를 기준으로 파일을 관리한다.

### xzawedDesigner (포트 3004)

UI 컴포넌트 스펙을 설계한다.

- UISpec JSON 형식으로 컴포넌트 구조를 정의한다.
- 동적 UI 양식, 목업, 진행 보드 생성을 지원한다.

### xzawedTester (포트 3005)

테스트를 실행하고 결과를 분석한다.

- 프로젝트 테스트 실행 후 통과/실패 결과를 반환한다.
- 실패 원인과 수정 방향을 포함한 분석 리포트를 생성한다.

### xzawedBuilder (포트 3006)

프로젝트 빌드를 감지하고 실행한다.

- 프로젝트 유형을 감지하여 적절한 빌드 명령을 실행한다.
- 빌드 결과(성공/실패, 출력 로그)를 Manager에 반환한다.

### xzawedWatcher (포트 3007)

파일 변경을 감시하고 이벤트를 스트리밍한다.

- 지정된 경로의 파일 변경을 감지하여 Redis Streams로 이벤트를 전송한다.
- Claude API를 사용하지 않는다.

### xzawedSecurity (포트 3008)

OWASP 기반 보안 감사를 수행한다.

- 코드베이스를 정적 분석하여 보안 취약점을 탐지한다.
- OWASP Top 10 카테고리 기반으로 결과를 분류한다.

---

## Redis Streams 메시지 구조

모든 서비스 간 메시지는 다음 형식을 따른다.

```typescript
{
  sessionId: string      // 작업 세션 ID
  messageId: string      // 메시지 고유 ID
  timestamp: number      // Unix timestamp (ms)
  type: string           // 서비스별 정의
  payload: object        // 서비스별 정의
}
```

스트림 키 규칙:

```
{source}:to-{target}:{sessionId}
consumer group: {target}-consumers
```

채널 전체 목록은 [Redis Streams](redis-streams.md)를 참고한다.

---

## 배포 시나리오

### 로컬 단일 사용자

개인 PC에서 모든 서비스를 직접 실행한다. `docker-compose.yml`로 Redis와 9개 서비스를 한 번에 시작할 수 있다.

```bash
docker compose up
```

### 개인 원격 서버

Railway, AWS 등 클라우드에 서비스를 배포하고 Electron 앱 또는 API로 접속한다.

### 팀 공유 서버

팀이 하나의 서버를 공유한다. 각 사용자의 세션은 `sessionId`로 격리되어 서로 간섭하지 않는다.

---

## 다음 단계

- [시스템 아키텍처](architecture.md) — 컴포넌트 구조와 데이터 흐름 상세 설명
- [Redis Streams](redis-streams.md) — 에이전트 간 메시징 설계
- [Claude 실행 모드](claude-runners.md) — `api` / `cli` / `remote` 세 가지 실행 방식 비교
- [퀵스타트](../getting-started/quickstart.md) — 첫 메시지 전송
