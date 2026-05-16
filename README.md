<div align="center">

# 🤖 xzawedPAIS

### AI Multi-Agent Orchestration Platform

> Describe what you want to build in plain language — nine specialized AI agents handle planning, development, design, testing, building, and monitoring automatically.

<br/>

**🌐 Language:** English | [한국어](./README.ko.md)

<br/>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Redis](https://img.shields.io/badge/Redis-Streams-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Anthropic](https://img.shields.io/badge/Claude-Sonnet%204.6-D97706?logo=anthropic&logoColor=white)](https://anthropic.com/)

[![pnpm](https://img.shields.io/badge/pnpm-9.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-2%2F3.x-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Turborepo](https://img.shields.io/badge/Turborepo-2.x-EF4444?logo=turborepo&logoColor=white)](https://turbo.build/)

[![Tests](https://img.shields.io/badge/tests-337%2B%20passing-brightgreen)](./docs/README.md)
[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](./.github/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](./docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

</div>

---

## ✨ Overview

**xzawedPAIS** is a single-repository AI multi-agent orchestration platform. A user's natural-language instruction flows through a pipeline of nine specialized Claude-powered services — each responsible for a distinct phase of the software lifecycle — with all inter-service communication handled exclusively via **Redis Streams**.

No service imports another directly. Every message crosses a stream boundary, giving the system fault tolerance and process-level isolation by design.

---

## 🏗️ Architecture

```
👤 User
   │  (HTTP / WebSocket / MCP)
   ▼
🎯 xzawedOrchestrator  (port 3000)  — intent refinement & relay
   │
   │  Redis Streams
   ▼
🗂️ xzawedManager       (port 3001)  — Claude tool-calling loop & dispatch
   │
   ├──▶ 📋 xzawedPlanner    (port 3002)  — intent → Step[] decomposition
   ├──▶ 💻 xzawedDeveloper  (port 3003)  — code generation & file I/O
   ├──▶ 🎨 xzawedDesigner   (port 3004)  — UI component spec design
   ├──▶ 🧪 xzawedTester     (port 3005)  — test execution & analysis
   ├──▶ 🔨 xzawedBuilder    (port 3006)  — build detection & execution
   ├──▶ 👁️  xzawedWatcher   (port 3007)  — file-change monitoring
   └──▶ 🔒 xzawedSecurity   (port 3008)  — OWASP security audit
```

---

## 📦 Services

| Service | Port | Tests | Role |
|---|---|---|---|
| [xzawedOrchestrator](./xzawedOrchestrator/) | 3000 | 65 / 65 | User instruction intake, intent refinement, Manager relay |
| [xzawedManager](./xzawedManager/) | 3001 | 51 / 51 | Claude tool-calling loop, sub-agent dispatch |
| [xzawedPlanner](./xzawedPlanner/) | 3002 | 33 / 33 | intent → executable Step[] breakdown |
| [xzawedDeveloper](./xzawedDeveloper/) | 3003 | 31 / 31 | Code generation & modification, file I/O |
| [xzawedDesigner](./xzawedDesigner/) | 3004 | 26 / 26 | UI component spec & layout design |
| [xzawedTester](./xzawedTester/) | 3005 | 28 / 28 | Test execution & failure analysis |
| [xzawedBuilder](./xzawedBuilder/) | 3006 | 32 / 32 | Project build detection & execution |
| [xzawedWatcher](./xzawedWatcher/) | 3007 | 26 / 26 | File-change surveillance & event streaming |
| [xzawedSecurity](./xzawedSecurity/) | 3008 | 45 / 45 | OWASP Top 10 security audit |

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| Language | TypeScript 5 (strict mode) |
| Package manager | pnpm 9 |
| Monorepo build | Turborepo 2 (Orchestrator + Manager) |
| HTTP server | Fastify 5 |
| Messaging | ioredis — Redis Streams |
| Schema validation | Zod |
| AI SDK | @anthropic-ai/sdk — Claude Sonnet 4.6 |
| Testing | Vitest 2/3 (`pool: 'forks'`) |
| Orchestrator extras | @modelcontextprotocol/sdk, React 19, Electron |
| Containerization | Docker Compose (all 9 services + Redis) |
| CI/CD | GitHub Actions (build · test · audit on every PR) |

---

## ⚡ How It Works — Redis Streams

Every service communicates through named Redis streams. No direct imports cross service boundaries.

```
Stream key format:  {source}:to-{target}:{sessionId}
Consumer group:     {target}-consumers

Examples:
  orchestrator:to-manager:{sid}   →  manager-consumers
  manager:to-planner:{sid}        →  planner-consumers
  manager:to-developer:{sid}      →  developer-consumers
  planner:to-manager:{sid}        →  manager-consumers
```

Each message carries a common envelope:

```typescript
{
  sessionId:  string   // isolates concurrent sessions
  messageId:  string
  timestamp:  number
  type:       string   // service-defined event type
  payload:    object   // service-defined body
}
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- Redis running on `localhost:6379`
- `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com/)

### Install

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais
```

Install each service individually (no root-level install):

```bash
# Turborepo services
cd xzawedOrchestrator && pnpm install
cd ../xzawedManager   && pnpm install

# Independent services
for svc in xzawedPlanner xzawedDeveloper xzawedDesigner \
           xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  (cd $svc && pnpm install)
done
```

### Configure

Copy `.env.example` to `.env` in every service directory and fill in your values:

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=<service port>
MODE=local
```

### Run

**Turborepo services** (Orchestrator, Manager):

```bash
cd xzawedOrchestrator && pnpm build && cd packages/server && pnpm dev
cd xzawedManager      && pnpm build && cd packages/server && pnpm dev
```

**Independent services** (all others):

```bash
cd xzawedPlanner   && pnpm dev   # port 3002
cd xzawedDeveloper && pnpm dev   # port 3003
cd xzawedDesigner  && pnpm dev   # port 3004
cd xzawedTester    && pnpm dev   # port 3005
cd xzawedBuilder   && pnpm dev   # port 3006
cd xzawedWatcher   && pnpm dev   # port 3007
cd xzawedSecurity  && pnpm dev   # port 3008
```

### Test

```bash
# Any service
cd <service-directory> && pnpm test

# Turborepo services — single file
cd xzawedManager/packages/server && pnpm test <file>

# Independent services — verbose output
cd xzawedDeveloper && pnpm test -- --reporter=verbose
```

---

## 🐳 Docker

Run the entire platform (Redis + all 9 services) with a single command:

```bash
# Copy .env files for each service first
cp xzawedOrchestrator/.env.example xzawedOrchestrator/.env
# ... (repeat for each service)

# Build and start everything
docker compose up --build

# Start only specific services
docker compose up redis planner developer security
```

All services share a `workspace` volume for file I/O, and Redis is health-checked before any service starts.

---

## ⚙️ CI/CD

Every push and pull request triggers [GitHub Actions](./.github/workflows/ci.yml):

| Check | Scope |
|---|---|
| `pnpm build` | All 9 services in parallel |
| `pnpm test` | 337+ tests across all services |
| `pnpm audit` | Zero moderate+ vulnerabilities enforced |

[Dependabot](./.github/dependabot.yml) opens weekly PRs for dependency updates across all 9 services.

---

## 📚 Documentation

**New to xzawedPAIS?** Start with the [Quick Start Guide](./QUICKSTART.md) — step-by-step instructions written for non-developers.

Full API references, service design specs, and guides live in [`docs/`](./docs/README.md).

---

## 📄 License

[MIT License](./LICENSE) © 2026 xzawed

---

<div align="center">

Built with ❤️ using [Claude Sonnet 4.6](https://anthropic.com/)

</div>
