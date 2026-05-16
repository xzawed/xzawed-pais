# xzawedOrchestrator Electron App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `packages/app` Electron desktop application that lets users chat with Claude through a 3-panel UI, backed by the existing `packages/server` Fastify WebSocket server.

**Architecture:** The Electron main process manages app lifecycle and optionally spawns the server as a child process (local mode). A preload script exposes a typed `window.electronAPI` via `contextBridge` with `nodeIntegration: false` and `contextIsolation: true`. The renderer is a React 19 SPA built by electron-vite, using Zustand stores for chat and app state, communicating with the server via REST (create session, post messages) and WebSocket (receive streaming chunks).

**Tech Stack:** Electron 33+, electron-vite 2+, React 19, Zustand 5, TypeScript 5, Vitest 2, CSS Modules, pnpm workspaces, electron-builder

---

## File Map

### New files — `packages/app/`

| Path | Responsibility |
|---|---|
| `package.json` | Electron app package, scripts, deps |
| `tsconfig.json` | Renderer TypeScript config |
| `tsconfig.node.json` | Main + preload TypeScript config |
| `electron.vite.config.ts` | electron-vite build config (main/preload/renderer) |
| `electron-builder.yml` | Packaging config (current platform only) |
| `src/main/index.ts` | BrowserWindow creation, app lifecycle |
| `src/main/server-manager.ts` | Spawn `packages/server` child process in local mode |
| `src/preload/index.ts` | contextBridge: `getSettings` / `setSettings` IPC |
| `src/renderer/index.html` | HTML entry point |
| `src/renderer/src/main.tsx` | React root mount |
| `src/renderer/src/App.tsx` | 3-panel shell + SettingsModal |
| `src/renderer/src/App.css` | Global layout styles |
| `src/renderer/src/lib/api.ts` | REST fetch helpers + WS client class |
| `src/renderer/src/store/app.store.ts` | Zustand: settings, serverStatus, showSettings |
| `src/renderer/src/store/chat.store.ts` | Zustand: session, messages, streaming state |
| `src/renderer/src/components/Sidebar.tsx` | Left panel: new session button, status indicator |
| `src/renderer/src/components/ChatView.tsx` | Center panel: message list |
| `src/renderer/src/components/MessageBubble.tsx` | Single message row |
| `src/renderer/src/components/MessageInput.tsx` | Bottom input bar |
| `src/renderer/src/components/DynamicPanel.tsx` | Right panel: UISpec form / mockup / progress |
| `src/renderer/src/components/SettingsModal.tsx` | Overlay modal for AppSettings |
| `test/store/chat.store.test.ts` | Vitest unit tests for chat.store |

### Modified files — `packages/server/`

| Path | Change |
|---|---|
| `src/ws/session.ws.ts` | Track WS connections in shared `wsSessions` Map; register/deregister on connect/close |
| `src/api/sessions.route.ts` | Accept `runner` + `wsSessions` opts; invoke runner on POST message; stream chunks to WS |
| `src/server.ts` | Create `wsSessions` Map + `runner`; pass both to route plugins |

---

## Task 1: Update server — wire up Claude runner to WebSocket streaming

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/ws/session.ws.ts`
- Modify: `packages/server/src/api/sessions.route.ts`
- Test (keep passing): `packages/server/test/api/sessions.test.ts`

### Background

The POST `/sessions/:id/messages` endpoint currently stores the user message but never invokes Claude. We need to:

1. In `server.ts`: create a `wsSessions` map (`Map<string, WebSocket>`) and a `ClaudeRunner` instance, then pass both to the route plugins.
2. In `session.ws.ts`: register the socket in `wsSessions` on connect and delete it on close.
3. In `sessions.route.ts`: after storing the user message, invoke `runner.send(messages)` in a background async IIFE and send each chunk to the session's WebSocket.

The `WebSocket` type comes from the `ws` package which is a dependency of `@fastify/websocket`. Import it as `import type { WebSocket } from 'ws'`.

- [ ] **Step 1: Update `packages/server/src/ws/session.ws.ts`**

Replace the entire file with:

```typescript
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../sessions/session.store.js'

export async function sessionWsRoutes(
  app: FastifyInstance,
  {
    store,
    wsSessions,
  }: { store: SessionStore; wsSessions: Map<string, WebSocket> }
): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/ws/sessions/:id',
    { websocket: true },
    (socket, req) => {
      const sessionId = req.params.id
      const session = store.findById(sessionId)

      if (!session) {
        socket.send(JSON.stringify({ type: 'error', content: 'Session not found' }))
        socket.close()
        return
      }

      wsSessions.set(sessionId, socket)

      socket.on('close', () => {
        wsSessions.delete(sessionId)
      })

      socket.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString())
          socket.send(JSON.stringify({ type: 'ack', messageId: msg.id }))
        } catch {
          socket.send(JSON.stringify({ type: 'error', content: 'Invalid JSON' }))
        }
      })

      socket.send(JSON.stringify({ type: 'connected', sessionId }))
    }
  )
}
```

- [ ] **Step 2: Update `packages/server/src/api/sessions.route.ts`**

Replace the entire file with:

```typescript
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../sessions/session.store.js'
import type { ClaudeRunner } from '../claude/runner.interface.js'
import type { Message } from '@xzawed/shared'

const messageStore = new Map<string, Message[]>()

export async function sessionsRoutes(
  app: FastifyInstance,
  {
    store,
    runner,
    wsSessions,
  }: { store: SessionStore; runner: ClaudeRunner; wsSessions: Map<string, WebSocket> }
): Promise<void> {
  app.post<{ Body: { userId: string } }>('/sessions', async (req, reply) => {
    const { userId } = req.body
    const session = store.create(userId ?? 'anonymous', 'cli')
    messageStore.set(session.id, [])
    return reply.status(201).send({ sessionId: session.id })
  })

  app.get<{ Params: { id: string } }>('/sessions/:id/messages', async (req, reply) => {
    const session = store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    return messageStore.get(req.params.id) ?? []
  })

  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/sessions/:id/messages',
    async (req, reply) => {
      const session = store.findById(req.params.id)
      if (!session) return reply.status(404).send({ error: 'Session not found' })

      const msg: Message = {
        id: crypto.randomUUID(),
        sessionId: req.params.id,
        role: 'user',
        content: req.body.content,
        timestamp: Date.now(),
      }

      const history = messageStore.get(req.params.id) ?? []
      history.push(msg)

      // Fire-and-forget: stream Claude response over WebSocket
      void (async () => {
        const socket = wsSessions.get(req.params.id)
        const assistantMsgId = crypto.randomUUID()

        try {
          let fullContent = ''
          for await (const chunk of runner.send(history)) {
            if (chunk.type === 'text') {
              fullContent += chunk.content
              socket?.send(
                JSON.stringify({ type: 'chunk', messageId: assistantMsgId, content: chunk.content })
              )
            } else if (chunk.type === 'error') {
              socket?.send(JSON.stringify({ type: 'error', content: chunk.content }))
              return
            }
          }

          // Store finalized assistant message
          const assistantMsg: Message = {
            id: assistantMsgId,
            sessionId: req.params.id,
            role: 'assistant',
            content: fullContent,
            timestamp: Date.now(),
          }
          history.push(assistantMsg)

          socket?.send(JSON.stringify({ type: 'done', messageId: assistantMsgId }))
        } catch (err) {
          const content = err instanceof Error ? err.message : String(err)
          socket?.send(JSON.stringify({ type: 'error', content }))
        }
      })()

      return reply.status(202).send({ messageId: msg.id, status: 'accepted' })
    }
  )

  app.get<{ Params: { id: string } }>('/sessions/:id/tasks', async (req, reply) => {
    const session = store.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    return { tasks: [] }
  })
}
```

- [ ] **Step 3: Update `packages/server/src/server.ts`**

Replace the entire file with:

```typescript
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import type { Config } from './config.js'
import { SessionStore } from './sessions/session.store.js'
import { createRunner } from './claude/runner.factory.js'
import { healthRoutes } from './api/health.route.js'
import { sessionsRoutes } from './api/sessions.route.js'
import { sessionWsRoutes } from './ws/session.ws.js'

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.mode !== 'local' })
  const store = new SessionStore()
  const runner = createRunner(config)
  const wsSessions = new Map<string, WebSocket>()

  await app.register(websocket)
  await app.register(healthRoutes)
  await app.register(sessionsRoutes, { store, runner, wsSessions })
  await app.register(sessionWsRoutes, { store, wsSessions })

  return app
}
```

- [ ] **Step 4: Run existing server tests to confirm they still pass**

```bash
cd packages/server && pnpm test
```

Expected output (all 4 tests green):

```
 PASS  test/api/sessions.test.ts
   Sessions API
     ✓ GET /health returns ok
     ✓ POST /sessions creates session and returns id
     ✓ GET /sessions/:id/messages returns empty array for new session
     ✓ GET /sessions/:id/messages returns 404 for unknown session
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/ws/session.ws.ts packages/server/src/api/sessions.route.ts
git commit -m "feat(server): wire ClaudeRunner streaming to WebSocket per session"
```

---

## Task 2: Scaffold `packages/app` — package.json and TypeScript configs

**Files:**
- Create: `packages/app/package.json`
- Create: `packages/app/tsconfig.json`
- Create: `packages/app/tsconfig.node.json`

### Background

electron-vite uses two tsconfig files. `tsconfig.node.json` covers `src/main` and `src/preload` (CommonJS-compatible, no DOM lib). `tsconfig.json` covers `src/renderer` (browser env, DOM lib). Both extend `../../tsconfig.base.json` but override `module`/`moduleResolution` to suit each context.

The `package.json` `"main"` field points at the compiled main process entry (`out/main/index.js`), which is where electron-vite outputs it by default.

- [ ] **Step 1: Create `packages/app/package.json`**

```json
{
  "name": "@xzawed/app",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-vite build && electron-builder",
    "test": "vitest run"
  },
  "dependencies": {
    "@xzawed/shared": "workspace:*",
    "electron-updater": "^6.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.3.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/app/tsconfig.node.json`** (for main + preload)

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["electron.vite.config.ts", "src/main/**/*", "src/preload/**/*"],
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "out"
  }
}
```

- [ ] **Step 3: Create `packages/app/tsconfig.json`** (for renderer)

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/renderer/src/**/*"],
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "outDir": "out/renderer",
    "baseUrl": "."
  }
}
```

- [ ] **Step 4: Create `packages/app/electron.vite.config.ts`**

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
```

- [ ] **Step 5: Create `packages/app/electron-builder.yml`**

```yaml
appId: com.xzawed.orchestrator
productName: xzawedOrchestrator
directories:
  buildResources: build
  output: dist
files:
  - out/**/*
  - node_modules/**/*
  - package.json
win:
  target: nsis
mac:
  target: dmg
linux:
  target: AppImage
```

- [ ] **Step 6: Install dependencies**

```bash
cd packages/app && pnpm install
```

Expected: dependencies installed, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/app/package.json packages/app/tsconfig.json packages/app/tsconfig.node.json packages/app/electron.vite.config.ts packages/app/electron-builder.yml
git commit -m "feat(app): scaffold Electron app package with electron-vite config"
```

---

## Task 3: Preload script — contextBridge IPC for settings

**Files:**
- Create: `packages/app/src/preload/index.ts`

### Background

The preload script runs in an isolated context with access to Node.js APIs. It bridges the main process (which can read/write files) and the renderer (which cannot). We expose exactly two functions: `getSettings()` and `setSettings()`. Settings are stored as JSON in `app.getPath('userData')/settings.json` — but the actual file I/O happens in the main process via `ipcMain`, not here. The preload just wraps `ipcRenderer.invoke`.

`contextBridge.exposeInMainWorld` is only called once; the key is `'electronAPI'`. This matches the `window.electronAPI` type used by the renderer.

- [ ] **Step 1: Create `packages/app/src/preload/index.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings } from '../main/index.js'

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke('settings:set', settings),
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/preload/index.ts
git commit -m "feat(app): add preload contextBridge for settings IPC"
```

---

## Task 4: Main process — BrowserWindow, IPC handlers, settings persistence

**Files:**
- Create: `packages/app/src/main/index.ts`
- Create: `packages/app/src/main/server-manager.ts`

### Background

`AppSettings` is defined here (in main) and re-exported so the preload can import its type. The main process:

1. Reads/writes `settings.json` from `app.getPath('userData')`.
2. Handles `ipcMain.handle('settings:get')` and `ipcMain.handle('settings:set', ...)`.
3. Creates a `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`, pointing at the renderer's `index.html`.
4. In local mode, calls `ServerManager.start()` before opening the window and `ServerManager.stop()` on `app.before-quit`.

`ServerManager` spawns `packages/server` via `node dist/index.js` (the compiled server). The server port defaults to 3000. We don't wait for the server to fully start before opening the window — the renderer polls `/health` and shows a spinner until ready.

- [ ] **Step 1: Create `packages/app/src/main/server-manager.ts`**

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'

export class ServerManager {
  private proc: ChildProcess | null = null

  start(): void {
    const serverDir = join(app.getAppPath(), '..', '..', 'server')
    const entry = join(serverDir, 'dist', 'index.js')

    this.proc = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        PORT: '3000',
        MODE: 'local',
        AUTH: 'none',
        CLAUDE_MODE: 'cli',
        CLAUDE_MODEL: 'claude-sonnet-4-6',
        REDIS_URL: 'redis://localhost:6379',
      },
      stdio: 'inherit',
    })

    this.proc.on('error', (err) => {
      console.error('[ServerManager] failed to start server:', err.message)
    })
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }
}
```

- [ ] **Step 2: Create `packages/app/src/main/index.ts`**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { ServerManager } from './server-manager.js'

export interface AppSettings {
  serverUrl: string
  mode: 'local' | 'remote'
  userId: string
}

const DEFAULT_SETTINGS: AppSettings = {
  serverUrl: 'http://localhost:3000',
  mode: 'local',
  userId: 'user',
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AppSettings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettings(settings: AppSettings): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

const serverManager = new ServerManager()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('settings:get', (): AppSettings => {
  return readSettings()
})

ipcMain.handle('settings:set', (_event, settings: AppSettings): void => {
  writeSettings(settings)
})

app.whenReady().then(() => {
  const settings = readSettings()
  if (settings.mode === 'local') {
    serverManager.start()
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  serverManager.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/src/main/server-manager.ts
git commit -m "feat(app): add Electron main process with IPC settings and server manager"
```

---

## Task 5: Renderer entry, global types, and CSS

**Files:**
- Create: `packages/app/src/renderer/index.html`
- Create: `packages/app/src/renderer/src/main.tsx`
- Create: `packages/app/src/renderer/src/App.css`

### Background

The renderer HTML file is the entry point Vite serves. It imports `src/main.tsx` which mounts React into `#root`. We also need a global TypeScript declaration so the renderer can reference `window.electronAPI` without type errors.

- [ ] **Step 1: Create `packages/app/src/renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>xzawedOrchestrator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `packages/app/src/renderer/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import { App } from './App.js'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 3: Create `packages/app/src/renderer/src/App.css`**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#root {
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  background: #1a1a2e;
  color: #e0e0e0;
}

.app-shell {
  display: flex;
  height: 100%;
  width: 100%;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: #16213e;
  border-right: 1px solid #2a2a4a;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
}

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dynamic-panel {
  width: 300px;
  flex-shrink: 0;
  background: #16213e;
  border-left: 1px solid #2a2a4a;
  padding: 16px;
  overflow-y: auto;
}

.message-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-bubble.user {
  align-self: flex-end;
  background: #0f3460;
  color: #e0e0e0;
}

.message-bubble.assistant {
  align-self: flex-start;
  background: #1a1a3e;
  color: #e0e0e0;
  border: 1px solid #2a2a5a;
}

.message-bubble.streaming {
  opacity: 0.85;
}

.message-input-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid #2a2a4a;
  background: #16213e;
}

.message-input-bar textarea {
  flex: 1;
  resize: none;
  background: #1a1a3e;
  color: #e0e0e0;
  border: 1px solid #2a2a5a;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  min-height: 40px;
  max-height: 120px;
}

.message-input-bar textarea:focus {
  border-color: #4a4aaa;
}

.message-input-bar button {
  align-self: flex-end;
  padding: 8px 16px;
  background: #4a4aaa;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}

.message-input-bar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sidebar-btn {
  width: 100%;
  padding: 8px 12px;
  background: #0f3460;
  color: #e0e0e0;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.sidebar-btn:hover {
  background: #1a4a7a;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}

.status-dot.running { background: #4caf50; }
.status-dot.stopped { background: #f44336; }
.status-dot.unknown { background: #9e9e9e; }

.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.settings-modal {
  background: #16213e;
  border: 1px solid #2a2a4a;
  border-radius: 12px;
  padding: 24px;
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-modal h2 {
  font-size: 18px;
  font-weight: 600;
  color: #e0e0e0;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-field label {
  font-size: 12px;
  color: #9e9e9e;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.settings-field input,
.settings-field select {
  background: #1a1a3e;
  color: #e0e0e0;
  border: 1px solid #2a2a5a;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 14px;
  outline: none;
}

.settings-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.btn-primary {
  padding: 8px 20px;
  background: #4a4aaa;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-secondary {
  padding: 8px 20px;
  background: transparent;
  color: #9e9e9e;
  border: 1px solid #2a2a5a;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.dynamic-panel h3 {
  font-size: 14px;
  font-weight: 600;
  color: #9e9e9e;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}

.form-field label {
  font-size: 12px;
  color: #9e9e9e;
}

.form-field input[type='text'],
.form-field input[type='number'],
.form-field textarea,
.form-field select {
  background: #1a1a3e;
  color: #e0e0e0;
  border: 1px solid #2a2a5a;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
  width: 100%;
}

.form-field textarea {
  resize: vertical;
  min-height: 60px;
}

.form-submit-btn {
  width: 100%;
  padding: 8px;
  background: #4a4aaa;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  margin-top: 4px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #4a4a6a;
  font-size: 16px;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/renderer/index.html packages/app/src/renderer/src/main.tsx packages/app/src/renderer/src/App.css
git commit -m "feat(app): add renderer HTML entry, React root mount, global CSS"
```

---

## Task 6: API client library

**Files:**
- Create: `packages/app/src/renderer/src/lib/api.ts`

### Background

`api.ts` provides two things:

1. **REST helpers** — thin `fetch` wrappers for `POST /sessions` and `POST /sessions/:id/messages`. They accept a `baseUrl` so the renderer can use whatever server URL is in settings.
2. **`SessionWsClient` class** — wraps a native browser `WebSocket`. Its `connect(sessionId)` method opens a connection and returns a teardown function. It accepts a callback for each typed `WsMessage`.

`WsMessage` is a discriminated union defined here (not imported from shared — this is renderer-only).

- [ ] **Step 1: Create `packages/app/src/renderer/src/lib/api.ts`**

```typescript
export type WsMessage =
  | { type: 'connected'; sessionId: string }
  | { type: 'chunk'; messageId: string; content: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; content: string }

export interface CreateSessionResponse {
  sessionId: string
}

export interface PostMessageResponse {
  messageId: string
  status: 'accepted'
}

export async function createSession(baseUrl: string, userId: string): Promise<CreateSessionResponse> {
  const res = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`)
  return res.json() as Promise<CreateSessionResponse>
}

export async function postMessage(
  baseUrl: string,
  sessionId: string,
  content: string
): Promise<PostMessageResponse> {
  const res = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`postMessage failed: ${res.status}`)
  return res.json() as Promise<PostMessageResponse>
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

export class SessionWsClient {
  private ws: WebSocket | null = null

  connect(
    baseUrl: string,
    sessionId: string,
    onMessage: (msg: WsMessage) => void
  ): () => void {
    const wsUrl = baseUrl.replace(/^http/, 'ws') + `/ws/sessions/${sessionId}`
    this.ws = new WebSocket(wsUrl)

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage
        onMessage(msg)
      } catch {
        // ignore non-JSON frames
      }
    }

    this.ws.onerror = () => {
      onMessage({ type: 'error', content: 'WebSocket connection error' })
    }

    return () => {
      this.ws?.close()
      this.ws = null
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/renderer/src/lib/api.ts
git commit -m "feat(app): add REST + WebSocket API client helpers"
```

---

## Task 7: Zustand stores

**Files:**
- Create: `packages/app/src/renderer/src/store/app.store.ts`
- Create: `packages/app/src/renderer/src/store/chat.store.ts`

### Background

Two stores:

- **`app.store.ts`** holds `AppSettings`, `serverStatus`, and the boolean controlling SettingsModal visibility. `AppSettings` is imported from `../../main/index.js` — but since the renderer cannot import from main at runtime, we re-declare the interface here to keep the renderer self-contained.
- **`chat.store.ts`** holds all messaging state. It is pure state logic — no direct API calls. The component layer drives actions. `Message` is imported from `@xzawed/shared`.

Note: the renderer cannot directly import `AppSettings` from `src/main/index.ts` at runtime because that file uses Electron APIs not available in the renderer. We declare a local copy of the interface.

- [ ] **Step 1: Create `packages/app/src/renderer/src/store/app.store.ts`**

```typescript
import { create } from 'zustand'

export interface AppSettings {
  serverUrl: string
  mode: 'local' | 'remote'
  userId: string
}

interface AppState {
  settings: AppSettings
  serverStatus: 'unknown' | 'running' | 'stopped'
  showSettings: boolean
  updateSettings: (s: Partial<AppSettings>) => void
  setServerStatus: (s: 'unknown' | 'running' | 'stopped') => void
  toggleSettings: () => void
}

export const useAppStore = create<AppState>((set) => ({
  settings: {
    serverUrl: 'http://localhost:3000',
    mode: 'local',
    userId: 'user',
  },
  serverStatus: 'unknown',
  showSettings: false,
  updateSettings: (s) =>
    set((state) => ({ settings: { ...state.settings, ...s } })),
  setServerStatus: (serverStatus) => set({ serverStatus }),
  toggleSettings: () => set((state) => ({ showSettings: !state.showSettings })),
}))
```

- [ ] **Step 2: Create `packages/app/src/renderer/src/store/chat.store.ts`**

```typescript
import { create } from 'zustand'
import type { Message, UISpec } from '@xzawed/shared'

interface ChatState {
  sessionId: string | null
  messages: Message[]
  streamingContent: string
  streamingMsgId: string | null
  isStreaming: boolean
  uiSpec: UISpec | null
  initSession: (sessionId: string) => void
  addMessage: (msg: Message) => void
  startStream: (msgId: string) => void
  appendChunk: (content: string) => void
  finalizeStream: (msgId: string) => void
  setUiSpec: (spec: UISpec | null) => void
  reset: () => void
}

const initialState = {
  sessionId: null,
  messages: [] as Message[],
  streamingContent: '',
  streamingMsgId: null,
  isStreaming: false,
  uiSpec: null,
}

export const useChatStore = create<ChatState>((set) => ({
  ...initialState,

  initSession: (sessionId) =>
    set({ ...initialState, sessionId }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  startStream: (msgId) =>
    set({ streamingMsgId: msgId, streamingContent: '', isStreaming: true }),

  appendChunk: (content) =>
    set((state) => ({ streamingContent: state.streamingContent + content })),

  finalizeStream: (msgId) =>
    set((state) => {
      const assistantMsg: Message = {
        id: msgId,
        sessionId: state.sessionId ?? '',
        role: 'assistant',
        content: state.streamingContent,
        timestamp: Date.now(),
      }
      return {
        messages: [...state.messages, assistantMsg],
        streamingContent: '',
        streamingMsgId: null,
        isStreaming: false,
      }
    }),

  setUiSpec: (uiSpec) => set({ uiSpec }),

  reset: () => set({ ...initialState }),
}))
```

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/renderer/src/store/app.store.ts packages/app/src/renderer/src/store/chat.store.ts
git commit -m "feat(app): add Zustand app and chat stores"
```

---

## Task 8: Unit tests for chat.store

**Files:**
- Create: `packages/app/test/store/chat.store.test.ts`

### Background

We test pure state logic only — no mocking of Electron APIs or fetch. Vitest is configured via `packages/app/package.json`'s `"test": "vitest run"`. We need a `vitest.config.ts` since the renderer tsconfig uses `"moduleResolution": "Bundler"` which Vitest needs to know about.

- [ ] **Step 1: Create `packages/app/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    conditions: ['import', 'module', 'browser', 'default'],
  },
})
```

- [ ] **Step 2: Create `packages/app/test/store/chat.store.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../../src/renderer/src/store/chat.store.js'

describe('chat.store', () => {
  beforeEach(() => {
    useChatStore.getState().reset()
  })

  it('starts with null sessionId and empty messages', () => {
    const state = useChatStore.getState()
    expect(state.sessionId).toBeNull()
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
    expect(state.streamingContent).toBe('')
    expect(state.streamingMsgId).toBeNull()
    expect(state.uiSpec).toBeNull()
  })

  it('initSession sets sessionId and resets other state', () => {
    useChatStore.getState().addMessage({
      id: 'msg-1',
      sessionId: 'old-session',
      role: 'user',
      content: 'hello',
      timestamp: 1000,
    })
    useChatStore.getState().initSession('new-session')
    const state = useChatStore.getState()
    expect(state.sessionId).toBe('new-session')
    expect(state.messages).toEqual([])
  })

  it('addMessage appends to messages array', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().addMessage({
      id: 'msg-1',
      sessionId: 's1',
      role: 'user',
      content: 'hi',
      timestamp: 1000,
    })
    useChatStore.getState().addMessage({
      id: 'msg-2',
      sessionId: 's1',
      role: 'assistant',
      content: 'hello',
      timestamp: 2000,
    })
    expect(useChatStore.getState().messages).toHaveLength(2)
    expect(useChatStore.getState().messages[0].content).toBe('hi')
    expect(useChatStore.getState().messages[1].content).toBe('hello')
  })

  it('startStream sets isStreaming and clears content', () => {
    useChatStore.getState().initSession('s1')
    // Simulate leftover content
    useChatStore.getState().startStream('msg-stream-1')
    useChatStore.getState().appendChunk('some old ')
    // Start a new stream
    useChatStore.getState().startStream('msg-stream-2')
    const state = useChatStore.getState()
    expect(state.isStreaming).toBe(true)
    expect(state.streamingMsgId).toBe('msg-stream-2')
    expect(state.streamingContent).toBe('')
  })

  it('appendChunk accumulates content', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().startStream('msg-a')
    useChatStore.getState().appendChunk('Hello')
    useChatStore.getState().appendChunk(', world')
    useChatStore.getState().appendChunk('!')
    expect(useChatStore.getState().streamingContent).toBe('Hello, world!')
  })

  it('finalizeStream adds assistant message and clears streaming state', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().addMessage({
      id: 'user-msg',
      sessionId: 's1',
      role: 'user',
      content: 'question',
      timestamp: 1000,
    })
    useChatStore.getState().startStream('assistant-msg')
    useChatStore.getState().appendChunk('The answer is 42.')
    useChatStore.getState().finalizeStream('assistant-msg')

    const state = useChatStore.getState()
    expect(state.isStreaming).toBe(false)
    expect(state.streamingContent).toBe('')
    expect(state.streamingMsgId).toBeNull()
    expect(state.messages).toHaveLength(2)
    const last = state.messages[state.messages.length - 1]
    expect(last.id).toBe('assistant-msg')
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('The answer is 42.')
  })

  it('setUiSpec stores the spec', () => {
    useChatStore.getState().setUiSpec({
      type: 'form',
      title: 'Test Form',
      fields: [{ id: 'name', type: 'text', label: 'Name' }],
      submitAction: 'submit',
    })
    expect(useChatStore.getState().uiSpec).toMatchObject({ type: 'form', title: 'Test Form' })
  })

  it('setUiSpec(null) clears the spec', () => {
    useChatStore.getState().setUiSpec({ type: 'progress_board' })
    useChatStore.getState().setUiSpec(null)
    expect(useChatStore.getState().uiSpec).toBeNull()
  })

  it('reset restores initial state', () => {
    useChatStore.getState().initSession('s1')
    useChatStore.getState().addMessage({
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      content: 'hi',
      timestamp: 1000,
    })
    useChatStore.getState().startStream('m2')
    useChatStore.getState().appendChunk('streaming...')
    useChatStore.getState().reset()

    const state = useChatStore.getState()
    expect(state.sessionId).toBeNull()
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
    expect(state.streamingContent).toBe('')
  })
})
```

- [ ] **Step 3: Run tests and confirm they pass**

```bash
cd packages/app && pnpm test
```

Expected output:

```
 PASS  test/store/chat.store.test.ts
   chat.store
     ✓ starts with null sessionId and empty messages
     ✓ initSession sets sessionId and resets other state
     ✓ addMessage appends to messages array
     ✓ startStream sets isStreaming and clears content
     ✓ appendChunk accumulates content
     ✓ finalizeStream adds assistant message and clears streaming state
     ✓ setUiSpec stores the spec
     ✓ setUiSpec(null) clears the spec
     ✓ reset restores initial state
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/test/store/chat.store.test.ts packages/app/vitest.config.ts
git commit -m "test(app): add Vitest unit tests for chat.store"
```

---

## Task 9: React components

**Files:**
- Create: `packages/app/src/renderer/src/components/MessageBubble.tsx`
- Create: `packages/app/src/renderer/src/components/MessageInput.tsx`
- Create: `packages/app/src/renderer/src/components/ChatView.tsx`
- Create: `packages/app/src/renderer/src/components/DynamicPanel.tsx`
- Create: `packages/app/src/renderer/src/components/Sidebar.tsx`
- Create: `packages/app/src/renderer/src/components/SettingsModal.tsx`

### Background

All components use plain CSS class names from `App.css`. No CSS modules, no Tailwind. Components are stateless presentational units where possible — state lives in stores. The `ChatView` component is responsible for orchestrating the WebSocket connection lifecycle: it opens a WS connection when `sessionId` changes and tears it down on cleanup.

`DynamicPanel` renders a form when `uiSpec.type === 'form'`, a pre-formatted content block when `type === 'mockup_viewer'`, and a simple label list when `type === 'progress_board'`. Form submission sends a special user message containing the field values as JSON.

- [ ] **Step 1: Create `packages/app/src/renderer/src/components/MessageBubble.tsx`**

```tsx
import type { Message } from '@xzawed/shared'

interface Props {
  message: Message
  streaming?: boolean
}

export function MessageBubble({ message, streaming = false }: Props): JSX.Element {
  const classes = [
    'message-bubble',
    message.role,
    streaming ? 'streaming' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {message.content}
      {streaming && <span style={{ opacity: 0.5 }}>▍</span>}
    </div>
  )
}
```

- [ ] **Step 2: Create `packages/app/src/renderer/src/components/MessageInput.tsx`**

```tsx
import { useState, useRef, type KeyboardEvent } from 'react'

interface Props {
  onSend: (content: string) => void
  disabled: boolean
}

export function MessageInput({ onSend, disabled }: Props): JSX.Element {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSend(): void {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleInput(): void {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }

  return (
    <div className="message-input-bar">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
        rows={1}
        disabled={disabled}
      />
      <button onClick={handleSend} disabled={disabled || !value.trim()}>
        Send
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create `packages/app/src/renderer/src/components/ChatView.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import type { Message } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { MessageBubble } from './MessageBubble.js'
import { MessageInput } from './MessageInput.js'
import { postMessage, SessionWsClient } from '../lib/api.js'

export function ChatView(): JSX.Element {
  const { sessionId, messages, streamingContent, streamingMsgId, isStreaming } =
    useChatStore()
  const {
    initSession: _init,
    addMessage,
    startStream,
    appendChunk,
    finalizeStream,
  } = useChatStore.getState()
  const { settings } = useAppStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const wsClientRef = useRef<SessionWsClient | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Connect WebSocket when sessionId changes
  useEffect(() => {
    if (!sessionId) return

    const client = new SessionWsClient()
    wsClientRef.current = client

    const teardown = client.connect(settings.serverUrl, sessionId, (msg) => {
      if (msg.type === 'chunk') {
        const state = useChatStore.getState()
        if (state.streamingMsgId !== msg.messageId) {
          startStream(msg.messageId)
        }
        appendChunk(msg.content)
      } else if (msg.type === 'done') {
        finalizeStream(msg.messageId)
      } else if (msg.type === 'error') {
        // Show error as a system message
        const errMsg: Message = {
          id: crypto.randomUUID(),
          sessionId,
          role: 'assistant',
          content: `[Error] ${msg.content}`,
          timestamp: Date.now(),
        }
        addMessage(errMsg)
      }
    })

    teardownRef.current = teardown

    return () => {
      teardown()
      teardownRef.current = null
      wsClientRef.current = null
    }
  }, [sessionId, settings.serverUrl])

  async function handleSend(content: string): Promise<void> {
    if (!sessionId) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    addMessage(userMsg)

    try {
      await postMessage(settings.serverUrl, sessionId, content)
    } catch (err) {
      const errMsg: Message = {
        id: crypto.randomUUID(),
        sessionId,
        role: 'assistant',
        content: `[Error] ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }
      addMessage(errMsg)
    }
  }

  if (!sessionId) {
    return (
      <div className="chat-panel">
        <div className="empty-state">Start a new session from the sidebar</div>
      </div>
    )
  }

  const streamingMessage: Message | null =
    isStreaming && streamingMsgId
      ? {
          id: streamingMsgId,
          sessionId,
          role: 'assistant',
          content: streamingContent,
          timestamp: Date.now(),
        }
      : null

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMessage && (
          <MessageBubble key="streaming" message={streamingMessage} streaming />
        )}
        <div ref={messagesEndRef} />
      </div>
      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </div>
  )
}
```

- [ ] **Step 4: Create `packages/app/src/renderer/src/components/DynamicPanel.tsx`**

```tsx
import { useState } from 'react'
import type { UISpec, UIField } from '@xzawed/shared'
import { useChatStore } from '../store/chat.store.js'
import { useAppStore } from '../store/app.store.js'
import { postMessage } from '../lib/api.js'

interface FieldProps {
  field: UIField
  value: string
  onChange: (val: string) => void
}

function FormField({ field, value, onChange }: FieldProps): JSX.Element {
  if (field.type === 'textarea') {
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        <textarea
          value={value}
          placeholder={field.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'select' && field.options) {
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        <input
          type="number"
          value={value}
          placeholder={field.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'checkbox_group' && field.options) {
    const checked: string[] = value ? value.split(',') : []
    return (
      <div className="form-field">
        <label>{field.label}{field.required ? ' *' : ''}</label>
        {field.options.map((opt) => (
          <label key={opt.value} style={{ display: 'flex', gap: 6, marginTop: 4, fontWeight: 'normal', color: '#ccc' }}>
            <input
              type="checkbox"
              checked={checked.includes(opt.value)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...checked, opt.value]
                  : checked.filter((v) => v !== opt.value)
                onChange(next.join(','))
              }}
            />
            {opt.label}
          </label>
        ))}
      </div>
    )
  }

  // Default: text
  return (
    <div className="form-field">
      <label>{field.label}{field.required ? ' *' : ''}</label>
      <input
        type="text"
        value={value}
        placeholder={field.placeholder ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

interface FormPanelProps {
  spec: UISpec & { type: 'form' }
}

function FormPanel({ spec }: FormPanelProps): JSX.Element {
  const { sessionId } = useChatStore()
  const { settings } = useAppStore()
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  function setValue(id: string, val: string): void {
    setValues((prev) => ({ ...prev, [id]: val }))
  }

  async function handleSubmit(): Promise<void> {
    if (!sessionId || submitting) return
    setSubmitting(true)
    try {
      const content = JSON.stringify({ action: spec.submitAction ?? 'submit', values })
      await postMessage(settings.serverUrl, sessionId, content)
    } catch {
      // Swallow — ChatView WS will surface any error
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h3>{spec.title ?? 'Form'}</h3>
      {(spec.fields ?? []).map((field) => (
        <FormField
          key={field.id}
          field={field}
          value={values[field.id] ?? ''}
          onChange={(val) => setValue(field.id, val)}
        />
      ))}
      <button className="form-submit-btn" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Submitting…' : (spec.submitAction ?? 'Submit')}
      </button>
    </div>
  )
}

export function DynamicPanel(): JSX.Element {
  const { uiSpec } = useChatStore()

  if (!uiSpec) {
    return (
      <div className="dynamic-panel">
        <h3>Context</h3>
        <p style={{ color: '#4a4a6a', fontSize: 13 }}>
          No active context. Start chatting to see dynamic panels here.
        </p>
      </div>
    )
  }

  if (uiSpec.type === 'form') {
    return (
      <div className="dynamic-panel">
        <FormPanel spec={uiSpec as UISpec & { type: 'form' }} />
      </div>
    )
  }

  if (uiSpec.type === 'mockup_viewer') {
    return (
      <div className="dynamic-panel">
        <h3>{uiSpec.title ?? 'Mockup'}</h3>
        <pre style={{ fontSize: 12, color: '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {uiSpec.content ?? ''}
        </pre>
      </div>
    )
  }

  if (uiSpec.type === 'progress_board') {
    return (
      <div className="dynamic-panel">
        <h3>{uiSpec.title ?? 'Progress'}</h3>
        <p style={{ fontSize: 13, color: '#ccc' }}>{uiSpec.content ?? 'Working…'}</p>
      </div>
    )
  }

  return (
    <div className="dynamic-panel">
      <h3>Context</h3>
    </div>
  )
}
```

- [ ] **Step 5: Create `packages/app/src/renderer/src/components/Sidebar.tsx`**

```tsx
import { useAppStore } from '../store/app.store.js'
import { useChatStore } from '../store/chat.store.js'
import { createSession } from '../lib/api.js'

export function Sidebar(): JSX.Element {
  const { settings, serverStatus, toggleSettings } = useAppStore()
  const { initSession } = useChatStore()

  async function handleNewSession(): Promise<void> {
    try {
      const { sessionId } = await createSession(settings.serverUrl, settings.userId)
      initSession(sessionId)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  return (
    <div className="sidebar">
      <button className="sidebar-btn" onClick={handleNewSession}>
        + New Session
      </button>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ fontSize: 12, color: '#6a6a8a', marginBottom: 8 }}>
          <span
            className={`status-dot ${serverStatus}`}
          />
          Server: {serverStatus}
        </div>
        <button className="sidebar-btn" onClick={toggleSettings}>
          Settings
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create `packages/app/src/renderer/src/components/SettingsModal.tsx`**

```tsx
import { useState } from 'react'
import { useAppStore, type AppSettings } from '../store/app.store.js'

export function SettingsModal(): JSX.Element | null {
  const { settings, showSettings, toggleSettings, updateSettings } = useAppStore()
  const [draft, setDraft] = useState<AppSettings>({ ...settings })

  if (!showSettings) return null

  function handleSave(): void {
    updateSettings(draft)
    // Persist via IPC if electronAPI is available
    window.electronAPI?.setSettings(draft).catch(console.error)
    toggleSettings()
  }

  function handleCancel(): void {
    setDraft({ ...settings })
    toggleSettings()
  }

  return (
    <div className="settings-overlay" onClick={handleCancel}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-field">
          <label>Server URL</label>
          <input
            type="text"
            value={draft.serverUrl}
            onChange={(e) => setDraft((d) => ({ ...d, serverUrl: e.target.value }))}
            placeholder="http://localhost:3000"
          />
        </div>

        <div className="settings-field">
          <label>Mode</label>
          <select
            value={draft.mode}
            onChange={(e) =>
              setDraft((d) => ({ ...d, mode: e.target.value as 'local' | 'remote' }))
            }
          >
            <option value="local">Local (embedded server)</option>
            <option value="remote">Remote (external server)</option>
          </select>
        </div>

        <div className="settings-field">
          <label>User ID</label>
          <input
            type="text"
            value={draft.userId}
            onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value }))}
            placeholder="user"
          />
        </div>

        <div className="settings-modal-actions">
          <button className="btn-secondary" onClick={handleCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/renderer/src/components/
git commit -m "feat(app): add all React UI components"
```

---

## Task 10: App shell, global type declaration, and health polling

**Files:**
- Create: `packages/app/src/renderer/src/App.tsx`
- Create: `packages/app/src/renderer/src/electron.d.ts`

### Background

`App.tsx` is the root component. It:

1. On mount, calls `window.electronAPI?.getSettings()` to load persisted settings from the main process.
2. Polls `/health` every 3 seconds to update `serverStatus`.
3. Renders the 3-panel shell: `<Sidebar>` | `<ChatView>` | `<DynamicPanel>`, plus `<SettingsModal>` overlay.

`electron.d.ts` augments the global `Window` interface so TypeScript knows about `window.electronAPI`. Without this, calls to `window.electronAPI` in components will cause TypeScript errors.

- [ ] **Step 1: Create `packages/app/src/renderer/src/electron.d.ts`**

```typescript
import type { AppSettings } from './store/app.store.js'

interface ElectronAPI {
  getSettings(): Promise<AppSettings>
  setSettings(settings: AppSettings): Promise<void>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
```

- [ ] **Step 2: Create `packages/app/src/renderer/src/App.tsx`**

```tsx
import { useEffect } from 'react'
import { useAppStore } from './store/app.store.js'
import { checkHealth } from './lib/api.js'
import { Sidebar } from './components/Sidebar.js'
import { ChatView } from './components/ChatView.js'
import { DynamicPanel } from './components/DynamicPanel.js'
import { SettingsModal } from './components/SettingsModal.js'

export function App(): JSX.Element {
  const { settings, updateSettings, setServerStatus } = useAppStore()

  // Load persisted settings from Electron main on first render
  useEffect(() => {
    window.electronAPI
      ?.getSettings()
      .then((saved) => {
        updateSettings(saved)
      })
      .catch(() => {
        // Running in browser dev mode without Electron — use defaults
      })
  }, [])

  // Poll /health every 3 seconds
  useEffect(() => {
    let cancelled = false

    async function poll(): Promise<void> {
      if (cancelled) return
      const healthy = await checkHealth(settings.serverUrl)
      if (!cancelled) {
        setServerStatus(healthy ? 'running' : 'stopped')
      }
    }

    void poll()
    const id = setInterval(() => void poll(), 3000)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [settings.serverUrl])

  return (
    <div className="app-shell">
      <Sidebar />
      <ChatView />
      <DynamicPanel />
      <SettingsModal />
    </div>
  )
}
```

- [ ] **Step 3: Run the full test suite to verify everything still passes**

```bash
cd packages/app && pnpm test
```

Expected: all 9 chat.store tests pass.

Also verify the server tests still pass:

```bash
cd packages/server && pnpm test
```

Expected: all 4 sessions tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/renderer/src/App.tsx packages/app/src/renderer/src/electron.d.ts
git commit -m "feat(app): add App shell with settings loading and server health polling"
```

---

## Task 11: Development smoke test and workspace wiring

**Files:**
- Modify: `packages/app/package.json` (already created — add `@xzawed/shared` path reference)
- Verify: `pnpm-workspace.yaml` (already includes `packages/*`)

### Background

Before running `electron-vite dev`, we need the shared package built, the app dependencies installed, and we need to confirm the dev server starts without errors. This task is verification only — no new files.

- [ ] **Step 1: Build the shared package**

```bash
cd packages/shared && pnpm build
```

Expected: `packages/shared/dist/` created.

- [ ] **Step 2: Build the server package**

```bash
cd packages/server && pnpm build
```

Expected: `packages/server/dist/` created.

- [ ] **Step 3: Install app dependencies from workspace root**

```bash
cd f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedOrchestrator && pnpm install
```

Expected: `packages/app/node_modules` populated, no errors.

- [ ] **Step 4: Verify TypeScript compilation for the renderer**

```bash
cd packages/app && npx tsc --project tsconfig.json --noEmit
```

Expected: no errors.

- [ ] **Step 5: Verify TypeScript compilation for main + preload**

```bash
cd packages/app && npx tsc --project tsconfig.node.json --noEmit
```

Expected: no errors.

- [ ] **Step 6: Start the dev server (verify it launches without crashing)**

Run in a terminal and keep it open:

```bash
cd packages/app && pnpm dev
```

Expected: electron-vite prints the renderer dev URL (e.g. `http://localhost:5173`), Electron window opens showing the 3-panel UI with a dark background. The sidebar shows "Server: unknown" until the server is running.

- [ ] **Step 7: Manual smoke test**

With both dev server and the Fastify server running:

```bash
# Terminal 2
cd packages/server && pnpm dev
```

1. Click "+ New Session" in the sidebar. Expect a session to be created (no error toast, no console errors).
2. Type "Hello" in the input and press Enter. Expect the user bubble to appear immediately.
3. Expect the assistant response to stream in as a series of chunk updates in the streaming bubble, then finalize.
4. Click "Settings", change the userId to "test-user", click Save. Expect the modal to close.
5. Reopen Settings — the userId should still show "test-user".

- [ ] **Step 8: Final commit**

```bash
git add packages/app/
git commit -m "feat(app): complete Electron app implementation with smoke test verified"
```

---

## Self-Review

### 1. Spec Coverage

| Requirement | Task |
|---|---|
| Server: track WS connections per sessionId | Task 1 — `session.ws.ts` registers/deregisters in `wsSessions` map |
| Server: invoke ClaudeRunner on POST message | Task 1 — `sessions.route.ts` fire-and-forget async IIFE |
| Server: stream chunk/done/error WS messages | Task 1 — `sessions.route.ts` sends `{ type: 'chunk' }` / `{ type: 'done' }` / `{ type: 'error' }` |
| Server: all existing tests keep passing | Task 1 Step 4 — run `pnpm test` in `packages/server` |
| `packages/app` scaffolded with electron-vite | Task 2 |
| Preload: contextBridge with nodeIntegration:false, contextIsolation:true | Task 3 + Task 4 (BrowserWindow options) |
| Main: IPC `settings:get` / `settings:set` | Task 4 |
| Main: spawn server in local mode | Task 4 — `ServerManager.start()` |
| `AppSettings` interface (serverUrl, mode, userId) | Task 4 (main) + Task 7 (renderer copy) |
| `window.electronAPI` global type | Task 10 — `electron.d.ts` |
| `app.store.ts` with correct shape | Task 7 |
| `chat.store.ts` with correct shape | Task 7 |
| All `chat.store.ts` actions work correctly | Task 8 — 9 Vitest tests |
| `api.ts`: REST helpers + `SessionWsClient` | Task 6 |
| `WsMessage` discriminated union | Task 6 |
| 3-panel layout (Sidebar | Chat | DynamicPanel) | Task 9 + Task 10 |
| Sidebar: new session button, server status | Task 9 Step 5 |
| ChatView: WS lifecycle, message streaming | Task 9 Step 3 |
| MessageBubble: user/assistant/streaming states | Task 9 Step 1 |
| MessageInput: Enter-to-send, Shift+Enter for newline | Task 9 Step 2 |
| DynamicPanel: form/mockup_viewer/progress_board | Task 9 Step 4 |
| SettingsModal: edit and persist settings | Task 9 Step 6 |
| Health polling every 3s → serverStatus | Task 10 Step 2 |
| Load settings from Electron on mount | Task 10 Step 2 |
| CSS: no Tailwind, inline/single CSS file | Task 5 — `App.css` |
| electron-builder.yml: current platform only | Task 2 Step 5 |
| No E2E or component tests | Only `chat.store.test.ts` in Task 8 |
| `sessionsRoutes` accepts `runner` + `wsSessions` opts | Task 1 Step 2 |

### 2. Placeholder Scan

- No "TBD" or "TODO" in any code block.
- All CSS classes referenced in components are defined in `App.css` (Task 5).
- `window.electronAPI` is typed in `electron.d.ts` (Task 10) before it is called in `SettingsModal.tsx` (Task 9) and `App.tsx` (Task 10).
- `AppSettings` in the renderer (Task 7 `app.store.ts`) mirrors the `AppSettings` in main (Task 4) field-for-field; no mismatch.

### 3. Type Consistency

- `useChatStore.getState().initSession` called in `Sidebar.tsx` — matches `initSession: (sessionId: string) => void` in `chat.store.ts`.
- `useChatStore.getState().addMessage` / `startStream` / `appendChunk` / `finalizeStream` — all called in `ChatView.tsx`, all defined in `chat.store.ts`.
- `SessionWsClient.connect(baseUrl, sessionId, onMessage)` — used in `ChatView.tsx` with `(settings.serverUrl, sessionId, callback)` — matches signature in `api.ts`.
- `postMessage(baseUrl, sessionId, content)` — used in `ChatView.tsx` and `DynamicPanel.tsx` — matches signature in `api.ts`.
- `createSession(baseUrl, userId)` — used in `Sidebar.tsx` — matches signature in `api.ts`.
- `WsMessage` discriminated union in `api.ts` — branches `chunk`, `done`, `error`, `connected` all handled in `ChatView.tsx`.
- `UISpec` from `@xzawed/shared` — `uiSpec.type` checked as `'form'` | `'mockup_viewer'` | `'progress_board'` in `DynamicPanel.tsx` — matches `UISpecType` definition in shared.
- `runner` and `wsSessions` passed from `server.ts` to both plugins — types match plugin option interfaces defined in each route file.
- `wsSessions: Map<string, WebSocket>` — the same `Map` instance is passed to both `sessionsRoutes` and `sessionWsRoutes` so they share state correctly.
