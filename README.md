<div align="center">

# 🤖 xzawedPAIS

### AI Multi-Agent Orchestration Platform

Describe what you want in plain language.

Seven specialized Claude agents plan, code, design, test, build, watch, and audit it —
coordinated by an orchestrator and a manager, talking only over Redis Streams.

<br/>

**🌐 Language:** English · [한국어](./README.ko.md)

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

## ✨ What it is

**xzawedPAIS** is a single-repository platform where a natural-language instruction flows through a pipeline of specialized Claude-powered services.

Each service owns one phase of the software lifecycle — planning, development, design, testing, building, watching, security.

Services never import each other. **Every message crosses a Redis Stream boundary**, which buys process-level isolation, independent failure domains, and a replayable audit trail by construction. A CI job (`module-boundaries`) enforces it.

---

## ⚠️ What actually runs by default

We keep this at the top on purpose.

**The default experience is an interactive chat with human approval gates.** You describe a goal, agents propose work, and you approve anything irreversible before it happens.

The fully autonomous arc — task-graph decomposition, verification channels, oracles, risk classification, release and deploy gates — is **real, merged, and tested, but sits behind feature flags that ship off**.

> 📖 **[`docs/LIVE_VS_FLAGGED.md`](./docs/LIVE_VS_FLAGGED.md) is the single source of truth** for what runs by default versus what is dormant.
>
> Turn the autonomous stack on with `PAIS_PROFILE=autonomous` (plus a JWT secret and a database).

---

## 🏗️ Architecture

```
👤 User
   │  HTTP · WebSocket · MCP
   ▼
🎯 Orchestrator  :3000   intent refinement · approval surface · Electron UI
   │
   │  Redis Streams
   ▼
🗂️ Manager       :3001   Claude tool-calling loop · agent dispatch
   │
   ├──▶ 📋 Planner    :3002   intent → executable Step[]
   ├──▶ 💻 Developer  :3003   code generation · file I/O
   ├──▶ 🎨 Designer   :3004   UI component specs
   ├──▶ 🧪 Tester     :3005   test execution · analysis
   ├──▶ 🔨 Builder    :3006   build detection · execution
   ├──▶ 👁️ Watcher    :3007   file-change streaming
   └──▶ 🔒 Security   :3008   OWASP security audit
```

---

## 📦 Services

| Service | Port | Role |
|---|---|---|
| [Orchestrator](./xzawedOrchestrator/CLAUDE.md) | 3000 | Instruction intake, intent refinement, approval & decision surfaces, Electron app |
| [Manager](./xzawedManager/CLAUDE.md) | 3001 | Claude tool-calling loop, agent dispatch, autonomous arc |
| [Planner](./xzawedPlanner/CLAUDE.md) | 3002 | Decomposes intent into executable steps |
| [Developer](./xzawedDeveloper/CLAUDE.md) | 3003 | Generates and modifies code |
| [Designer](./xzawedDesigner/CLAUDE.md) | 3004 | Designs UI component specifications |
| [Tester](./xzawedTester/CLAUDE.md) | 3005 | Runs tests and analyzes failures |
| [Builder](./xzawedBuilder/CLAUDE.md) | 3006 | Detects and runs project builds |
| [Watcher](./xzawedWatcher/CLAUDE.md) | 3007 | Streams file-change events |
| [Security](./xzawedSecurity/CLAUDE.md) | 3008 | Audits against OWASP Top 10 |

Two more pieces are not HTTP services:

- **[Shared](./xzawedShared/CLAUDE.md)** — `@xzawed/agent-streams`, the common library every agent and the Manager consume.
- **[Launcher](./xzawedLauncher/CLAUDE.md)** — an Electron installer that sets the stack up for non-developers.

> Each service's own `CLAUDE.md` holds its structure, contracts, and pitfalls. This table is an index, not a summary.

---

## ⚡ How services talk

One rule: **named Redis streams, never a direct import.**

```
Stream key:      {source}:to-{target}:{sessionId}
Consumer group:  {target}-consumers

orchestrator:to-manager:{sid}   →  manager-consumers
manager:to-planner:{sid}        →  planner-consumers
planner:to-manager:{sid}        →  manager-consumers
```

Every message carries the same envelope:

```typescript
{
  sessionId: string   // isolates concurrent sessions
  messageId: string
  timestamp: number
  type:      string   // service-defined event type
  payload:   object   // service-defined body
}
```

Retries, dead-letter isolation, and idempotent consumption are handled once, in the shared `BaseConsumer`.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js ≥ 22** and **pnpm ≥ 10** — both enforced by `engines`
- **Docker**, or a Redis reachable at `redis://localhost:6379`
- An **`ANTHROPIC_API_KEY`** from [console.anthropic.com](https://console.anthropic.com/)

<br/>

### Option A — Docker (shortest path)

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais

# 1. Every service needs its own .env — a missing file aborts the run
for s in Orchestrator Manager Planner Developer Designer Tester Builder Watcher Security; do
  cp "xzawed$s/.env.example" "xzawed$s/.env"
done

# 2. Root .env — compose fails interpolation without it
echo 'POSTGRES_PASSWORD=choose-one' > .env

docker compose up --build
```

This starts **11 containers**: `postgres`, `redis`, and the nine services. They share a `workspace` volume for file I/O, and every app service is gated on a real `/health/ready` probe before its dependents start.

> **There is no browser UI in the images.** The Orchestrator image does not ship `packages/web` — use curl plus a WebSocket client, or run the Electron app from source.

<br/>

### Option B — From source

There is **no root `package.json`**. Install per service, and **build `xzawedShared` first** — the agents depend on it through `file:../xzawedShared`, and its `dist/` is not in git.

```bash
cd xzawedShared && pnpm install && pnpm build && cd ..

cd xzawedOrchestrator && pnpm install && cd ..
cd xzawedManager      && pnpm install && cd ..

for svc in xzawedPlanner xzawedDeveloper xzawedDesigner \
           xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  (cd "$svc" && pnpm install)
done
```

Then run:

```bash
# Agents read .env directly
cp xzawedPlanner/.env.example xzawedPlanner/.env    # repeat per agent
cd xzawedPlanner && pnpm dev                        # :3002

# Orchestrator and Manager take config from the shell
cd xzawedManager/packages/server
ANTHROPIC_API_KEY=sk-ant-... REDIS_URL=redis://localhost:6379 pnpm dev
```

<br/>

### Two things that bite

**`.env` is read by the seven agent services only.** Their `dev` script passes `--env-file=.env`. Orchestrator and Manager do not, and nothing in this repo uses `dotenv` — so values in `xzawedManager/.env` have **no effect**. Put them in the shell.

**`docker compose` needs a root `.env`** holding `POSTGRES_PASSWORD`, and there is no root `.env.example` to copy from. Without it even `docker compose up redis planner` aborts.

> `POST /sessions/:id/messages` returns **202 and nothing else** — the reply streams over WebSocket. Full procedure, including the Electron app and the autonomous profile: **[docs/operations/running.md](./docs/operations/running.md)**.

---

## 🧪 Testing

```bash
cd xzawedManager/packages/server && pnpm test <file>    # a single file
cd xzawedDeveloper && pnpm test                         # a whole service
```

Integration tests **skip silently without a database**. Always read the skip count — a local green is not a CI green.

> Sync the shared library into its consumers after changing it: `bash scripts/sync-shared.sh`. `file:` dependencies are *copied* at install time, so a rebuild alone leaves consumers stale.

---

## ⚙️ CI/CD

Every push and pull request runs [GitHub Actions](./.github/workflows/ci.yml) — build, test, and audit for every service, plus repo-wide gates for duplication, module boundaries, i18n key sync, documentation invariants, and SonarCloud.

`ci.yml` is the source of truth for the job list; we deliberately do not copy the count here.

[Dependabot](./.github/dependabot.yml) opens weekly dependency PRs across every package directory.

---

## 📚 Documentation

| Start here | For |
|---|---|
| **[QUICKSTART.md](./QUICKSTART.md)** | Step-by-step setup written for non-developers |
| **[docs/LIVE_VS_FLAGGED.md](./docs/LIVE_VS_FLAGGED.md)** | What runs by default vs. what is flag-gated |
| **[docs/README.md](./docs/README.md)** | Full index — architecture, operations, development |
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | Branching, PR checklist, review expectations |
| **[CLAUDE.md](./CLAUDE.md)** | Repo-wide conventions, security invariants, workflow |

---

## 📄 License

[MIT](./LICENSE) © 2026 xzawed

<div align="center">
<br/>

Built with [Claude](https://anthropic.com/)

</div>
