<div align="center">

# 🎯 xzawedOrchestrator

### 프로젝트 지휘자 — AI 멀티 에이전트 오케스트레이션 플랫폼

> 자연어로 지시하면 AI 전문 에이전트 팀이 실제 소프트웨어를 만들어주는 Electron 기반 플랫폼

<br/>

**🌐 언어:** [English](./README.md) | 한국어

<br/>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-latest-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)

[![pnpm](https://img.shields.io/badge/pnpm-9.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.x-EF4444?logo=turborepo&logoColor=white)](https://turbo.build/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Redis](https://img.shields.io/badge/Redis-Streams-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Anthropic](https://img.shields.io/badge/Claude-Sonnet%204.6-D97706?logo=anthropic&logoColor=white)](https://anthropic.com/)

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![Docs](https://img.shields.io/badge/docs-최신-blue)](./docs/index.md)

</div>

---

## ✨ 개요

**xzawedOrchestrator(지휘자)** 는 xzawed 멀티 에이전트 시스템의 최상위 진입점입니다.

사용자가 _"쇼핑몰 만들어줘"_ 처럼 자연어로 서비스 구현 의도를 전달하면, 지휘자가 의도를 정제하여 전문 에이전트 팀(기획·개발·디자인·테스트 등)에 전달하고 진행 상황을 실시간으로 중계합니다.

```
👤 사용자  →  🎯 지휘자  →  🗂️ 총관리자  →  💻 개발자 / 🎨 디자이너 / 🧪 테스터 ...
```

---

## 🚀 빠른 시작

```bash
# 1. 클론 및 의존성 설치
git clone https://github.com/xzawed/xzawedOrchestrator.git
cd xzawedOrchestrator
pnpm install

# 2. 환경변수 설정
cp .env.example .env

# 3. 서버 시작
cd packages/server && pnpm dev
# → http://localhost:3000 에서 실행됩니다
```

첫 세션을 5분 안에 만들려면 → [📖 퀵스타트 가이드](docs/quickstart.md)

---

## 🎁 주요 기능

| 기능 | 설명 |
|------|------|
| 💬 **자연어 지시** | 기술 스펙 없이 원하는 서비스를 말로 설명 |
| ⚡ **실시간 스트리밍** | 메신저 형태로 Claude 응답을 실시간으로 확인 |
| 🖥️ **동적 UI 패널** | 필요 시 양식·목업·현황판을 자동 렌더링 |
| 🤖 **3가지 Claude 모드** | CLI 구독 / API 키 / 원격 서버 CLI 전환 가능 |
| 🔄 **Redis Streams** | 서비스 중단 시에도 작업 유실 없는 비동기 통신 |
| 📦 **유연한 배포** | 개인 PC · 개인 클라우드 · 팀 서버 동일 코드베이스 |
| 🔌 **MCP 서버 내장** | Claude Code 등 외부 MCP 클라이언트와 네이티브 통합 |
| 🔐 **세션 격리** | 멀티 창·멀티 사용자 각각 독립 세션으로 운영 |

---

## 🏗️ 시스템 아키텍처

### xzawed Suite 전체 구조

```
👤 사용자
   ↕  Electron 앱 (IPC / WebSocket)
🎯 xzawedOrchestrator   ← 이 프로젝트
   ↕  Redis Streams
🗂️ xzawedManager        ← 별도 서비스 (포트 3001, 구현 완료)
   ↕  Redis Streams
   ├── 📋 xzawedPlanner    (기획자)
   ├── 💻 xzawedDeveloper  (개발자)
   ├── 🎨 xzawedDesigner   (디자이너)
   ├── 🧪 xzawedTester     (테스터)
   ├── 🔨 xzawedBuilder    (빌드관리자)
   ├── 👁️  xzawedWatcher   (이슈관리자)
   └── 🔐 xzawedSecurity   (보안관리자)
```

### Monorepo 패키지 구조

```
xzawedOrchestrator/
┌────────────────────────────────────────────────────────────────┐
│   packages/app (Electron)        packages/server (Fastify)     │
│  ┌──────────────────────┐        ┌───────────────────────┐     │
│  │  🖥️  React UI         │◄──WS──►│  🌐 REST API          │     │
│  │  💬 채팅 채널         │        │  🔌 WebSocket         │     │
│  │  🎛️  동적 UI 패널    │        │  🤖 MCP 서버          │     │
│  │  ⚙️  Settings        │        │  ⚡ Claude 실행기     │     │
│  └──────────────────────┘        │  📮 Redis Streams     │     │
│                                  │  🗃️  세션 관리        │     │
│                                  └──────────┬────────────┘     │
│                       packages/shared (공통 TypeScript 타입)   │
└──────────────────────────────────────────────┼─────────────────┘
                                               │ Redis Streams
                                               ▼
                                     🗂️ xzawedManager (포트 3001, 구현 완료)
```

---

## 🚢 배포 모드

| 모드 | 설명 | 설정 |
|------|------|------|
| 🏠 **로컬** | 모든 것이 내 PC에서 실행. 다중 창 지원 | `MODE=local` |
| ☁️ **개인 서버** | 개인 클라우드에 백엔드 배포 | `MODE=remote` |
| 👥 **팀 서버** | 팀원 공유 서버, JWT 인증 적용 | `MODE=remote` + `AUTH=jwt` |

---

## 🤖 Claude 실행 모드

| 모드 | 방식 | 비용 |
|------|------|------|
| 🖥️ **CLI 구독** _(기본)_ | 로컬 Claude Code CLI 서브프로세스 | Claude 구독 요금만 |
| 🔑 **API 키** | Anthropic SDK 직접 호출 | 토큰당 과금 |
| 🌐 **외부 서버 CLI** | SSH / HTTP 원격 서버의 CLI 사용 | 서버 운영비만 |

---

## 🛠️ 기술 스택

| 영역 | 기술 | 버전 |
|------|------|------|
| 언어 | TypeScript (strict) | 5.x |
| 패키지 관리 | pnpm workspaces | 9.x |
| 모노레포 빌드 | Turborepo | 2.x |
| 데스크탑 앱 | Electron | 최신 안정 |
| UI 라이브러리 | React + Zustand | 19.x |
| 백엔드 프레임워크 | Fastify | 5.x |
| 실시간 통신 | @fastify/websocket | — |
| AI 프로토콜 | @modelcontextprotocol/sdk | 1.x |
| AI SDK | @anthropic-ai/sdk | 0.27+ |
| 메시지 큐 | ioredis (Redis Streams) | 5.x |
| 테스트 | Vitest + Playwright | 2.x |
| 패키징 | electron-builder | — |

---

## 📚 문서

| 문서 | 설명 |
|------|------|
| [📖 퀵스타트](docs/quickstart.md) | 5분 안에 서버 실행 |
| [🔧 설치 가이드](docs/guides/installation.md) | 환경 설정 및 설치 |
| [⚙️ 설정 완전 가이드](docs/guides/configuration.md) | 모든 설정 옵션 |
| [🏗️ 아키텍처 개요](docs/concepts/architecture.md) | 시스템 구조 설명 |
| [🤖 Claude 실행기](docs/concepts/claude-runners.md) | 3가지 실행 모드 |
| [📮 Redis Streams](docs/concepts/redis-streams.md) | 비동기 메시징 설계 |
| [🌐 REST API 레퍼런스](docs/reference/rest-api.md) | API 엔드포인트 |
| [🔌 MCP 도구 레퍼런스](docs/reference/mcp-tools.md) | MCP 통합 |
| [🔑 환경변수 목록](docs/reference/environment-variables.md) | 모든 환경변수 |
| [📋 문서 홈](docs/index.md) | 전체 문서 네비게이션 |

---

## 🤝 기여

기여를 환영합니다! 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

```bash
# 개발 환경 시작
pnpm install
cd packages/server && pnpm dev
```

---

## 📄 라이선스

[MIT License](./LICENSE) © 2026 xzawed
