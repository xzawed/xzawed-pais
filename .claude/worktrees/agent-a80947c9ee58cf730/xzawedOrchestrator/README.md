<div align="center">

# 🎯 xzawedOrchestrator

### Project Conductor — AI Multi-Agent Orchestration Platform

> Tell it what you want to build in plain language, and a team of specialized AI agents will make it happen.

<br/>

**🌐 Language:** English | [한국어](./README.ko.md)

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
[![Docs](https://img.shields.io/badge/docs-latest-blue)](./docs/index.md)

</div>

---

## ✨ Overview

**xzawedOrchestrator (the Conductor)** is the top-level entry point of the xzawed multi-agent system.

When a user says _"Build me an e-commerce site"_, the Conductor interprets the intent, refines it into structured instructions, and dispatches them to a team of specialized AI agents — Planner, Developer, Designer, Tester, and more — then relays progress back to the user in real time.

```
👤 User  →  🎯 Conductor  →  🗂️ Manager  →  💻 Developer / 🎨 Designer / 🧪 Tester ...
```

---

## 🚀 Quick Start

```bash
# 1. Clone and install dependencies
git clone https://github.com/xzawed/xzawedOrchestrator.git
cd xzawedOrchestrator
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Start the server
cd packages/server && pnpm dev
# → Running at http://localhost:3000
```

Create your first session in under 5 minutes → [📖 Quickstart Guide](docs/quickstart.md)

---

## 🎁 Features

| Feature | Description |
|---------|-------------|
| 💬 **Natural Language Commands** | Describe the service you want — no technical specs required |
| ⚡ **Real-time Streaming** | Watch Claude's responses stream in a messenger-style chat |
| 🖥️ **Dynamic UI Panels** | Forms, mockup viewers, and progress boards rendered on demand |
| 🤖 **3 Claude Execution Modes** | CLI subscription / API key / Remote server CLI |
| 🔄 **Redis Streams Messaging** | Zero task loss even when services restart mid-job |
| 📦 **Flexible Deployment** | Personal PC, private cloud, or team server — same codebase |
| 🔌 **Built-in MCP Server** | Native integration with Claude Code and other MCP clients |
| 🔐 **Session Isolation** | Multi-window and multi-user sessions run fully independently |

---

## 🏗️ Architecture

### xzawed Suite Overview

```
👤 User
   ↕  Electron App (IPC / WebSocket)
🎯 xzawedOrchestrator   ← this project
   ↕  Redis Streams
🗂️ xzawedManager        ← separate service (upcoming)
   ↕  Redis Streams
   ├── 📋 xzawedPlanner    (Planner)
   ├── 💻 xzawedDeveloper  (Developer)
   ├── 🎨 xzawedDesigner   (Designer)
   ├── 🧪 xzawedTester     (Tester)
   ├── 🔨 xzawedBuilder    (Build Manager)
   ├── 👁️  xzawedWatcher   (Issue Manager)
   └── 🔐 xzawedSecurity   (Security Manager)
```

### Monorepo Package Layout

```
xzawedOrchestrator/
┌────────────────────────────────────────────────────────────────┐
│   packages/app (Electron)        packages/server (Fastify)     │
│  ┌──────────────────────┐        ┌───────────────────────┐     │
│  │  🖥️  React UI         │◄──WS──►│  🌐 REST API          │     │
│  │  💬 Chat Channel      │        │  🔌 WebSocket         │     │
│  │  🎛️  Dynamic UI Panel │        │  🤖 MCP Server        │     │
│  │  ⚙️  Settings         │        │  ⚡ Claude Runner     │     │
│  └──────────────────────┘        │  📮 Redis Streams     │     │
│                                  │  🗃️  Session Manager  │     │
│                                  └──────────┬────────────┘     │
│                       packages/shared (Common TypeScript Types) │
└──────────────────────────────────────────────┼─────────────────┘
                                               │ Redis Streams
                                               ▼
                                     🗂️ xzawedManager (upcoming)
```

---

## 🚢 Deployment Modes

| Mode | Description | Config |
|------|-------------|--------|
| 🏠 **Local** | Everything runs on your machine. Multiple windows supported. | `MODE=local` |
| ☁️ **Personal Server** | Backend deployed to your private cloud. | `MODE=remote` |
| 👥 **Team Server** | Shared server with JWT authentication. | `MODE=remote` + `AUTH=jwt` |

---

## 🤖 Claude Execution Modes

| Mode | How It Works | Cost |
|------|-------------|------|
| 🖥️ **CLI Subscription** _(default)_ | Spawns local Claude Code CLI as subprocess | Claude subscription only |
| 🔑 **API Key** | Direct Anthropic SDK calls | Per-token billing |
| 🌐 **Remote Server CLI** | SSH or HTTP proxy to a remote Claude CLI | Server hosting only |

---

## 🛠️ Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Language | TypeScript (strict) | 5.x |
| Package Manager | pnpm workspaces | 9.x |
| Monorepo Build | Turborepo | 2.x |
| Desktop App | Electron | latest stable |
| UI Library | React + Zustand | 19.x |
| Backend Framework | Fastify | 5.x |
| Real-time | @fastify/websocket | — |
| AI Protocol | @modelcontextprotocol/sdk | 1.x |
| AI SDK | @anthropic-ai/sdk | 0.27+ |
| Message Queue | ioredis (Redis Streams) | 5.x |
| Testing | Vitest + Playwright | 2.x |
| Packaging | electron-builder | — |

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📖 Quickstart](docs/quickstart.md) | Run the server in 5 minutes |
| [🔧 Installation Guide](docs/guides/installation.md) | Environment setup |
| [⚙️ Configuration Guide](docs/guides/configuration.md) | All configuration options |
| [🏗️ Architecture Overview](docs/concepts/architecture.md) | System structure |
| [🤖 Claude Runners](docs/concepts/claude-runners.md) | 3 execution modes explained |
| [📮 Redis Streams](docs/concepts/redis-streams.md) | Async messaging design |
| [🌐 REST API Reference](docs/reference/rest-api.md) | API endpoints |
| [🔌 MCP Tools Reference](docs/reference/mcp-tools.md) | MCP integration |
| [🔑 Environment Variables](docs/reference/environment-variables.md) | All env vars |
| [📋 Docs Home](docs/index.md) | Full documentation navigation |

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

```bash
# Start development
pnpm install
cd packages/server && pnpm dev
```

---

## 📄 License

[MIT License](./LICENSE) © 2026 xzawed
