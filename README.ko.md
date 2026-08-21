<div align="center">

# 🤖 xzawedPAIS

### AI 멀티 에이전트 오케스트레이션 플랫폼

> 자연어로 지시하면 9개의 전문 AI 에이전트가 계획→개발→디자인→테스트→빌드→모니터링을 자동 수행합니다

<br/>

**🌐 언어:** [English](./README.md) | 한국어

<br/>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-Streams-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Anthropic](https://img.shields.io/badge/Claude-Sonnet%204.6-D97706?logo=anthropic&logoColor=white)](https://anthropic.com/)

[![pnpm](https://img.shields.io/badge/pnpm-9.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-2%2F3.x-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.x-EF4444?logo=turborepo&logoColor=white)](https://turbo.build/)

[![Tests](https://img.shields.io/badge/테스트-337개%20이상%20통과-brightgreen)](.)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](./.github/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](./docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

---

## ✨ 개요

**xzawedPAIS**는 자연어 지시 하나로 9개의 전문 AI 에이전트가 협력하여 실제 소프트웨어를 만들어주는 플랫폼입니다.

_"쇼핑몰 만들어줘"_ 라고 입력하면, 에이전트들이 계획을 세우고, 코드를 작성하고, UI를 설계하고, 테스트를 실행하고, 빌드하고, 보안까지 검토합니다.

모든 서비스는 이 단일 저장소에서 관리되며, **Redis Streams**를 통해서만 통신합니다.

---

## 🏗️ 시스템 아키텍처

```
👤 사용자
   ↕  HTTP / WebSocket
🎯 xzawedOrchestrator (포트 3000)   — 지시 수신·정제
   ↕  Redis Streams
🗂️ xzawedManager      (포트 3001)   — tool-calling 루프, 에이전트 디스패치
   ↕  Redis Streams
   ├── 📋 xzawedPlanner    (포트 3002)  — intent → Step[] 분해
   ├── 💻 xzawedDeveloper  (포트 3003)  — 코드 생성·수정
   ├── 🎨 xzawedDesigner   (포트 3004)  — UI 컴포넌트 스펙 설계
   ├── 🧪 xzawedTester     (포트 3005)  — 테스트 실행·분석
   ├── 🔨 xzawedBuilder    (포트 3006)  — 프로젝트 빌드 감지·실행
   ├── 👁️  xzawedWatcher   (포트 3007)  — 파일 변경 감시·이벤트 스트리밍
   └── 🔒 xzawedSecurity   (포트 3008)  — OWASP 보안 감사
```

---

## 📊 서비스 현황

| 서비스 | 포트 | 테스트 | 역할 |
|---|---|---|---|
| [xzawedOrchestrator](./xzawedOrchestrator) | 3000 | 65/65 | 사용자 지시 수신·정제, Manager 전달 |
| [xzawedManager](./xzawedManager) | 3001 | 51/51 | Claude tool-calling 루프, 에이전트 디스패치 |
| [xzawedPlanner](./xzawedPlanner) | 3002 | 33/33 | intent → 실행 가능한 Step[] 분해 |
| [xzawedDeveloper](./xzawedDeveloper) | 3003 | 31/31 | 코드 생성·수정, 파일 I/O |
| [xzawedDesigner](./xzawedDesigner) | 3004 | 26/26 | UI 컴포넌트 스펙 설계 |
| [xzawedTester](./xzawedTester) | 3005 | 28/28 | 테스트 실행·분석 |
| [xzawedBuilder](./xzawedBuilder) | 3006 | 32/32 | 프로젝트 빌드 감지·실행 |
| [xzawedWatcher](./xzawedWatcher) | 3007 | 26/26 | 파일 변경 감시·이벤트 스트리밍 |
| [xzawedSecurity](./xzawedSecurity) | 3008 | 45/45 | OWASP 보안 감사 |

---

## 🔄 작동 원리 — Redis Streams

모든 서비스 간 통신은 **Redis Streams**만 사용합니다. 서비스끼리 직접 import하지 않습니다.

```
스트림 키 형식:  {출발지}:to-{목적지}:{sessionId}
소비자 그룹:     {목적지}-consumers
```

**예시 흐름:**

```
orchestrator:to-manager:{sid}
  → manager:to-planner:{sid}   → planner:to-manager:{sid}
  → manager:to-developer:{sid} → developer:to-manager:{sid}
  → manager:to-tester:{sid}    → tester:to-manager:{sid}
```

모든 메시지는 `{ sessionId, messageId, timestamp, type, payload }` 구조를 공유합니다.

---

## 🚀 빠른 시작

### 전제조건

- Node.js **22+** · pnpm **10+** (`engines`가 둘 다 강제합니다)
- Docker, 또는 `redis://localhost:6379`로 닿는 Redis
- `ANTHROPIC_API_KEY`

### 설치

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais
```

저장소 루트에 `package.json`이 없어 서비스별로 설치합니다. **`xzawedShared`를 먼저 빌드해야 합니다** — 에이전트 7종이 `file:../xzawedShared`로 의존하는데 그 `dist/`는 git에 없어서, 신선한 클론에서는 빌드 전까지 기동되지 않습니다.

```bash
cd xzawedShared && pnpm install && pnpm build && cd ..

cd xzawedOrchestrator && pnpm install && cd ..
cd xzawedManager      && pnpm install && cd ..

for svc in xzawedPlanner xzawedDeveloper xzawedDesigner \
           xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  (cd "$svc" && pnpm install)
done
```

### 환경 설정

두 가지가 발목을 잡습니다.

**`.env`는 에이전트 7종만 읽습니다.** 그쪽 `dev` 스크립트에만 `--env-file=.env`가 있습니다. Orchestrator·Manager에는 없고 저장소 어디도 `dotenv`를 쓰지 않아서, `xzawedManager/.env`에 값을 넣어도 `pnpm dev`에는 **아무 효과가 없습니다.** 그 둘은 셸에서 설정을 받습니다.

**`docker compose`는 루트 `.env`의 `POSTGRES_PASSWORD`를 요구합니다.** 복사할 루트 `.env.example`이 없습니다. 없으면 `docker compose up redis planner`처럼 일부만 지정해도 보간 단계에서 죽습니다.

### 실행

가장 짧은 성공 경로는 [Docker](#-docker)입니다.

소스에서 띄울 때는 이렇게 나뉩니다.

```bash
# 에이전트 — .env가 동작합니다
cp xzawedPlanner/.env.example xzawedPlanner/.env    # 에이전트마다 반복
cd xzawedPlanner && pnpm dev                        # 포트 3002

# Orchestrator · Manager — 값을 셸에 싣습니다
cd xzawedManager/packages/server
ANTHROPIC_API_KEY=sk-ant-... REDIS_URL=redis://localhost:6379 pnpm dev
```

**`POST /sessions/:id/messages`는 202만 반환합니다** — 답변은 WebSocket으로 흐릅니다. Electron 앱과 자율 프로필을 포함한 전체 절차는 **[docs/operations/running.md](docs/operations/running.md)**에 있습니다.

### 테스트

```bash
cd xzawedManager/packages/server && pnpm test <파일>    # 단일 파일
cd xzawedDeveloper && pnpm test -- --reporter=verbose   # 상세 출력
```

통합 테스트는 `DATABASE_URL` 없이 조용히 skip됩니다 — **skip 수를 확인하세요.** 로컬 그린이 CI 그린이 아닙니다.

---

## 🛠️ 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | TypeScript 5 (strict mode) |
| 패키지 관리 | pnpm (npm/yarn 사용 금지) |
| 모노레포 빌드 | Turborepo (Orchestrator + Manager) |
| HTTP 서버 | Fastify 5 |
| 메시지 큐 | ioredis — Redis Streams |
| 스키마 검증 | Zod |
| AI SDK | @anthropic-ai/sdk (Claude Sonnet 4.6) |
| 테스트 | Vitest 2/3 (pool: forks, 프로세스 격리) |
| MCP | @modelcontextprotocol/sdk (Orchestrator) |
| UI | React 19 + Zustand + Electron |
| 컨테이너 | Docker Compose (9개 서비스 + Redis) |
| CI/CD | GitHub Actions (빌드·테스트·감사 자동화) |

---

## 🐳 Docker

```bash
# 1. 서비스마다 자기 .env가 필요합니다 — 하나라도 없으면 즉시 중단됩니다
for s in Orchestrator Manager Planner Developer Designer Tester Builder Watcher Security; do
  cp "xzawed$s/.env.example" "xzawed$s/.env"
done

# 2. 루트 .env — 없으면 compose가 보간에서 실패합니다
echo 'POSTGRES_PASSWORD=원하는값' > .env

docker compose up --build
```

컨테이너 11개가 뜹니다 — `postgres`·`redis`와 9개 서비스. `workspace` 볼륨을 공유하고, Redis 헬스 체크 통과 후 의존 서비스가 시작됩니다.

**이미지에는 브라우저 UI가 없습니다.** Orchestrator Dockerfile이 `packages/web`을 싣지 않으므로, curl + WebSocket 클라이언트를 쓰거나 Electron 앱을 소스에서 실행합니다.

---

## ⚙️ CI/CD

모든 push와 PR에서 [GitHub Actions](./.github/workflows/ci.yml)가 자동 실행됩니다:

| 검사 | 범위 |
|---|---|
| `pnpm build` | 9개 서비스 병렬 빌드 |
| `pnpm test` | 전체 337개 이상 테스트 |
| `pnpm audit` | 중간 이상 취약점 0개 강제 |

[Dependabot](./.github/dependabot.yml)이 9개 서비스의 의존성 업데이트 PR을 매주 자동 생성합니다.

---

## 📚 문서

**처음 시작하시나요?** 비개발자도 따라할 수 있는 [빠른 시작 가이드](./QUICKSTART.md)를 먼저 읽어보세요.

전체 API, 서비스별 설계 문서, 가이드는 [`docs/`](./docs/README.md)를 참고하세요.

| 문서 | 설명 |
|------|------|
| [docs/operations/running.md](./docs/operations/running.md) | 로컬·Docker·원격 실행과 설정 계약 |
| [docs/spec/](./docs/spec/) | 서비스 경계 계약 (Redis 봉투·에이전트 RPC·Electron IPC) |
| [docs/services/](./docs/services/) | 서비스별 상세 문서 |

---

## 🤝 기여

기여를 환영합니다! Pull Request를 보내주세요.

```bash
# 테스트 실행 예시
cd xzawedManager && pnpm test
cd xzawedDeveloper && pnpm test
cd xzawedSecurity && pnpm test -- --reporter=verbose
```

---

## 📄 라이선스

[MIT License](./LICENSE) © 2026 xzawed

---

<div align="center">

Claude Sonnet 4.6으로 ❤️를 담아 제작

</div>
