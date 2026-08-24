<div align="center">

# 🤖 xzawedPAIS

### AI 멀티 에이전트 오케스트레이션 플랫폼

원하는 것을 자연어로 설명하세요.

특화된 Claude 에이전트 7종이 계획·개발·디자인·테스트·빌드·감시·보안 감사를 나눠 수행합니다.
오케스트레이터와 매니저가 조율하고, 서비스끼리는 **오직 Redis Streams로만** 대화합니다.

<br/>

**🌐 Language:** [English](./README.md) · 한국어

<br/>

[![CI](https://github.com/xzawed/xzawed-pais/actions/workflows/ci.yml/badge.svg)](https://github.com/xzawed/xzawed-pais/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Redis](https://img.shields.io/badge/Redis-Streams-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Claude](https://img.shields.io/badge/Claude-Anthropic-D97706?logo=anthropic&logoColor=white)](https://anthropic.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](./docker-compose.yml)

</div>

---

## ✨ 무엇인가

**xzawedPAIS**는 자연어 지시가 특화된 Claude 서비스들의 파이프라인을 통과하는 단일 저장소 플랫폼입니다.

각 서비스가 소프트웨어 생명주기의 한 국면을 맡습니다 — 계획, 개발, 디자인, 테스트, 빌드, 감시, 보안.

서비스는 서로를 직접 import하지 않습니다. **모든 메시지가 Redis Stream 경계를 건너므로** 프로세스 수준 격리와 독립적인 실패 도메인, 재생 가능한 감사 기록이 구조적으로 따라옵니다. CI 잡(`module-boundaries`)이 이 경계를 강제합니다.

---

## ⚠️ 기본으로 실제 도는 것

이것을 맨 위에 두는 것은 의도입니다.

**기본 경험은 대화형 챗 + 사람 승인 게이트입니다.** 목표를 설명하면 에이전트가 작업을 제안하고, 되돌릴 수 없는 것은 사람이 승인해야 실행됩니다.

완전 자율 아크 — Task Graph 분해, 검증 채널, 오라클, 리스크 분류, 릴리스·배포 게이트 — 는 **실재하고 머지됐고 테스트도 있지만, 기본 off인 플래그 뒤에 있습니다**.

> 📖 **무엇이 기본 실행이고 무엇이 휴면인지는 [`docs/LIVE_VS_FLAGGED.md`](./docs/LIVE_VS_FLAGGED.md)가 단일 진실원천입니다.**
>
> 자율 스택은 `PAIS_PROFILE=autonomous`(+ JWT 시크릿·DB)로 켭니다.

---

## 🏗️ 구조

```
👤 사용자
   │  HTTP · WebSocket · MCP
   ▼
🎯 Orchestrator  :3000   지시 정제 · 승인/결정 표면 · Electron UI
   │
   │  Redis Streams
   ▼
🗂️ Manager       :3001   Claude tool-calling 루프 · 에이전트 디스패치
   │
   ├──▶ 📋 Planner    :3002   intent → 실행 가능한 Step[]
   ├──▶ 💻 Developer  :3003   코드 생성 · 파일 I/O
   ├──▶ 🎨 Designer   :3004   UI 컴포넌트 스펙
   ├──▶ 🧪 Tester     :3005   테스트 실행 · 분석
   ├──▶ 🔨 Builder    :3006   빌드 감지 · 실행
   ├──▶ 👁️ Watcher    :3007   파일 변경 스트리밍
   └──▶ 🔒 Security   :3008   OWASP 보안 감사
```

---

## 📦 서비스

| 서비스 | 포트 | 역할 |
|---|---|---|
| [Orchestrator](./xzawedOrchestrator/CLAUDE.md) | 3000 | 지시 수신·정제, 승인·결정 표면, Electron 앱 |
| [Manager](./xzawedManager/CLAUDE.md) | 3001 | Claude tool-calling 루프, 에이전트 디스패치, 자율 아크 |
| [Planner](./xzawedPlanner/CLAUDE.md) | 3002 | intent를 실행 가능한 단계로 분해 |
| [Developer](./xzawedDeveloper/CLAUDE.md) | 3003 | 코드 생성·수정 |
| [Designer](./xzawedDesigner/CLAUDE.md) | 3004 | UI 컴포넌트 스펙 설계 |
| [Tester](./xzawedTester/CLAUDE.md) | 3005 | 테스트 실행·실패 분석 |
| [Builder](./xzawedBuilder/CLAUDE.md) | 3006 | 프로젝트 빌드 감지·실행 |
| [Watcher](./xzawedWatcher/CLAUDE.md) | 3007 | 파일 변경 이벤트 스트리밍 |
| [Security](./xzawedSecurity/CLAUDE.md) | 3008 | OWASP Top 10 감사 |

HTTP 서비스가 아닌 둘이 더 있습니다.

- **[Shared](./xzawedShared/CLAUDE.md)** — `@xzawed/agent-streams`. 에이전트 전부와 Manager가 쓰는 공통 라이브러리
- **[Launcher](./xzawedLauncher/CLAUDE.md)** — 비개발자용 설치·실행 Electron 런처

> 각 서비스의 구조·계약·함정은 자기 `CLAUDE.md`에 있습니다. 이 표는 색인이지 요약이 아닙니다.

---

## ⚡ 서비스는 어떻게 대화하나

규칙은 하나입니다. **이름 붙은 Redis 스트림, 직접 import 금지.**

```
스트림 키:    {출발지}:to-{목적지}:{sessionId}
소비자 그룹:  {목적지}-consumers

orchestrator:to-manager:{sid}   →  manager-consumers
manager:to-planner:{sid}        →  planner-consumers
planner:to-manager:{sid}        →  manager-consumers
```

모든 메시지가 같은 봉투를 씁니다.

```typescript
{
  sessionId: string   // 동시 세션 격리
  messageId: string
  timestamp: number
  type:      string   // 서비스가 정의하는 이벤트 타입
  payload:   object   // 서비스가 정의하는 본문
}
```

재시도·DLQ 격리·멱등 소비는 공통 `BaseConsumer`가 한 곳에서 담당합니다.

---

## 🚀 시작하기

### 사전 요구

- **Node.js ≥ 22** · **pnpm ≥ 10** — 둘 다 `engines`가 강제합니다
- **Docker**, 또는 `redis://localhost:6379`로 닿는 Redis
- [console.anthropic.com](https://console.anthropic.com/)에서 발급한 **`ANTHROPIC_API_KEY`**

<br/>

### 방법 A — Docker (가장 빠른 길)

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais

# 1. 서비스마다 자기 .env 가 필요합니다 — 하나라도 없으면 실행이 중단됩니다
for s in Orchestrator Manager Planner Developer Designer Tester Builder Watcher Security; do
  cp "xzawed$s/.env.example" "xzawed$s/.env"
done

# 2. 루트 .env — 없으면 compose 가 변수 치환 단계에서 실패합니다
echo 'POSTGRES_PASSWORD=choose-one' > .env

docker compose up --build
```

컨테이너 **11개**가 뜹니다 — `postgres`, `redis`, 그리고 서비스 9개. 파일 I/O용 `workspace` 볼륨을 공유하고, 앱 서비스는 전부 **실검사 `/health/ready`** 를 통과해야 의존 서비스가 시작됩니다.

> **이미지에 브라우저 UI는 없습니다.** Orchestrator 이미지가 `packages/web`을 싣지 않으므로, curl + WebSocket 클라이언트를 쓰거나 Electron 앱을 소스에서 실행하세요.

<br/>

### 방법 B — 소스에서

**루트에 `package.json`이 없습니다.** 서비스별로 설치하고, **`xzawedShared`를 먼저 빌드**해야 합니다 — 에이전트가 `file:../xzawedShared`로 참조하는데 그 `dist/`는 git에 없습니다.

```bash
cd xzawedShared && pnpm install && pnpm build && cd ..

cd xzawedOrchestrator && pnpm install && cd ..
cd xzawedManager      && pnpm install && cd ..

for svc in xzawedPlanner xzawedDeveloper xzawedDesigner \
           xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  (cd "$svc" && pnpm install)
done
```

실행:

```bash
# 에이전트는 .env 를 직접 읽습니다
cp xzawedPlanner/.env.example xzawedPlanner/.env    # 에이전트마다 반복
cd xzawedPlanner && pnpm dev                        # :3002

# Orchestrator·Manager 는 셸에서 설정을 받습니다
cd xzawedManager/packages/server
ANTHROPIC_API_KEY=sk-ant-... REDIS_URL=redis://localhost:6379 pnpm dev
```

<br/>

### 여기서 두 번 걸립니다

**`.env`는 에이전트 7종만 읽습니다.** 그쪽 `dev` 스크립트가 `--env-file=.env`를 넘기기 때문입니다. Orchestrator·Manager는 그러지 않고 이 저장소는 `dotenv`를 쓰지 않으므로, `xzawedManager/.env`에 값을 넣어도 **아무 효과가 없습니다.** 셸에 넣으세요.

**`docker compose`는 루트 `.env`의 `POSTGRES_PASSWORD`를 요구합니다.** 복사해 올 루트 `.env.example`이 없습니다. 없으면 `docker compose up redis planner`조차 중단됩니다.

> `POST /sessions/:id/messages`는 **202만 반환합니다** — 응답은 WebSocket으로 스트리밍됩니다. Electron 앱과 자율 프로필을 포함한 전체 절차는 **[docs/operations/running.md](./docs/operations/running.md)** 에 있습니다.

---

## 🧪 테스트

```bash
cd xzawedManager/packages/server && pnpm test <파일>    # 단일 파일
cd xzawedDeveloper && pnpm test                          # 서비스 전체
```

통합 테스트는 **DB가 없으면 조용히 skip됩니다.** skip 수를 항상 확인하세요 — 로컬 그린이 CI 그린이 아닙니다.

> 공통 라이브러리를 고쳤다면 소비자에 동기화하세요: `bash scripts/sync-shared.sh`. `file:` 의존은 install 시점에 **복사**되므로 재빌드만으로는 소비자가 stale로 남습니다.

---

## ⚙️ CI/CD

모든 push와 PR이 [GitHub Actions](./.github/workflows/ci.yml)를 돌립니다 — 서비스별 빌드·테스트·audit에 더해 중복 검출, 모듈 경계, i18n 키 동기화, 문서 불변식, SonarCloud 같은 저장소 전역 게이트가 함께 돕니다.

잡 목록의 진실원천은 `ci.yml`입니다. 여기에 개수를 복사하지 않습니다 — 복사본은 반드시 어긋납니다.

[Dependabot](./.github/dependabot.yml)이 모든 패키지 디렉토리에 주간 의존성 PR을 엽니다.

---

## 📚 문서

| 여기서 시작 | 용도 |
|---|---|
| **[QUICKSTART.md](./QUICKSTART.md)** | 비개발자용 단계별 설치 안내 |
| **[docs/LIVE_VS_FLAGGED.md](./docs/LIVE_VS_FLAGGED.md)** | 기본 실행 vs 플래그 게이트 |
| **[docs/README.md](./docs/README.md)** | 전체 색인 — 아키텍처·운영·개발 |
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | 브랜치·PR 체크리스트·리뷰 기준 |
| **[CLAUDE.md](./CLAUDE.md)** | 저장소 공통 규칙·보안 불변식·워크플로 |

---

## 📄 라이선스

[MIT](./LICENSE) © 2026 xzawed

<div align="center">
<br/>

Built with [Claude](https://anthropic.com/)

</div>
