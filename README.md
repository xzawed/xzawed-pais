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
| Package manager | pnpm 10 |
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

- Node.js **22+** and pnpm **10+** (`engines` enforces both)
- Docker, or a Redis reachable at `redis://localhost:6379`
- `ANTHROPIC_API_KEY` from [console.anthropic.com](https://console.anthropic.com/)

### Install

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais
```

There is no root `package.json` — install per service. **Build `xzawedShared` first:** the seven agent services depend on it through `file:../xzawedShared` and its `dist/` is not in git, so a fresh clone cannot start them until it is built.

```bash
cd xzawedShared && pnpm install && pnpm build && cd ..

cd xzawedOrchestrator && pnpm install && cd ..
cd xzawedManager      && pnpm install && cd ..

for svc in xzawedPlanner xzawedDeveloper xzawedDesigner \
           xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  (cd "$svc" && pnpm install)
done
```

### Configure

Two things bite here.

**`.env` is read by the seven agent services only.** Their `dev` script passes `--env-file=.env`. Orchestrator and Manager do not, and no service in this repo uses `dotenv` — so putting values in `xzawedManager/.env` has **no effect** when you run `pnpm dev`. Those two take their configuration from the shell.

**`docker compose` needs a root `.env`** holding `POSTGRES_PASSWORD`, and there is no root `.env.example` to copy from. Without it, even `docker compose up redis planner` aborts during interpolation.

### Run

The shortest working path is [Docker](#-docker).

From source:

```bash
# Agents — .env works here
cp xzawedPlanner/.env.example xzawedPlanner/.env    # repeat per agent
cd xzawedPlanner && pnpm dev                        # port 3002

# Orchestrator / Manager — put the values in the shell
cd xzawedManager/packages/server
ANTHROPIC_API_KEY=sk-ant-... REDIS_URL=redis://localhost:6379 pnpm dev
```

**`POST /sessions/:id/messages` returns 202 and nothing else** — the reply streams over WebSocket. The full procedure, including the Electron app and the autonomous profile, is in **[docs/operations/running.md](docs/operations/running.md)**.

### Test

```bash
cd xzawedManager/packages/server && pnpm test <file>    # single file
cd xzawedDeveloper && pnpm test -- --reporter=verbose   # verbose
```

Integration tests skip silently without `DATABASE_URL` — check the skip count. A local green is not a CI green.

---

## 🐳 Docker

```bash
# 1. Every service needs its own .env — a missing file aborts the run
for s in Orchestrator Manager Planner Developer Designer Tester Builder Watcher Security; do
  cp "xzawed$s/.env.example" "xzawed$s/.env"
done

# 2. Root .env — compose fails interpolation without it
echo 'POSTGRES_PASSWORD=choose-one' > .env

docker compose up --build
```

This starts 11 containers: `postgres`, `redis`, and the nine services. They share a `workspace` volume for file I/O, and Redis is health-checked before its dependents start.

**There is no browser UI in the images.** The Orchestrator Dockerfile does not ship `packages/web`, so use curl plus a WebSocket client, or run the Electron app from source.

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
