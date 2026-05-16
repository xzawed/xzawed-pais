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

[![Tests](https://img.shields.io/badge/테스트-235개%20이상%20통과-brightgreen)](.)
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
| [xzawedOrchestrator](./xzawedOrchestrator) | 3000 | v0.1.0 | 사용자 지시 수신·정제, Manager 전달 |
| [xzawedManager](./xzawedManager) | 3001 | 51/51 | Claude tool-calling 루프, 에이전트 디스패치 |
| [xzawedPlanner](./xzawedPlanner) | 3002 | ✅ | intent → 실행 가능한 Step[] 분해 |
| [xzawedDeveloper](./xzawedDeveloper) | 3003 | 31/31 | 코드 생성·수정, 파일 I/O |
| [xzawedDesigner](./xzawedDesigner) | 3004 | 26/26 | UI 컴포넌트 스펙 설계 |
| [xzawedTester](./xzawedTester) | 3005 | 28/28 | 테스트 실행·분석 |
| [xzawedBuilder](./xzawedBuilder) | 3006 | v0.2.0 | 프로젝트 빌드 감지·실행 |
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

- Node.js 20+
- pnpm 9+
- Redis (로컬 또는 `redis://localhost:6379`)
- Anthropic API 키

### 설치

```bash
# 저장소 클론
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais

# 각 서비스 의존성 설치 (Turborepo 기반 서비스)
cd xzawedOrchestrator && pnpm install && cd ..
cd xzawedManager && pnpm install && cd ..

# 독립 서비스 설치
for svc in xzawedPlanner xzawedDeveloper xzawedDesigner xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  cd $svc && pnpm install && cd ..
done
```

### 환경 설정

각 서비스 디렉토리에서 `.env.example`을 복사합니다:

```bash
# 공통 환경변수 (.env)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=<서비스별 포트>
MODE=local
```

### 실행

```bash
# Turborepo 기반 서비스
cd xzawedOrchestrator && pnpm build && cd packages/server && pnpm dev
cd xzawedManager      && pnpm build && cd packages/server && pnpm dev

# 독립 서비스 (각각 별도 터미널)
cd xzawedPlanner   && pnpm dev
cd xzawedDeveloper && pnpm dev
cd xzawedDesigner  && pnpm dev
cd xzawedTester    && pnpm dev
cd xzawedBuilder   && pnpm dev
cd xzawedWatcher   && pnpm dev
cd xzawedSecurity  && pnpm dev
```

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
| UI (Phase 2) | React 19 + Zustand + Electron |

---

## 📚 문서

전체 API, 서비스별 설계 문서, 가이드는 [`docs/`](./docs/README.md)를 참고하세요.

| 문서 | 설명 |
|------|------|
| [docs/specs/](./docs/specs/) | 각 서비스 설계 스펙 |
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
