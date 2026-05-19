# xzawedLauncher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비개발자가 xzawedPAIS 전체 플랫폼을 클릭 한 번으로 설치·실행할 수 있는 크로스플랫폼 Electron 런처 앱 구축

**Architecture:** 독립 Electron 앱(`xzawedLauncher/`)이 Docker 감지/설치 → Claude 인증 → 서비스 기동 마법사를 제공하고, 이후 실행부터는 대시보드로 직행하며 트레이에 상주한다. 서비스 이미지는 GHCR에 사전 배포하며 런처는 `docker-compose.prod.yml`로 컨테이너를 관리한다.

**Tech Stack:** Electron 33, React 19, electron-vite, electron-builder, electron-updater, Zustand, Tailwind CSS v4, shadcn/ui, Vitest 3, pnpm workspace

---

## 파일 구조

```
xzawedPAIS/
├── xzawedLauncher/
│   ├── package.json                        # pnpm workspace root
│   ├── pnpm-workspace.yaml
│   ├── tsconfig.json
│   ├── CLAUDE.md
│   └── packages/
│       ├── shared/
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   └── src/
│       │       ├── index.ts
│       │       └── types/
│       │           ├── service.ts          # ServiceName, ServiceStatus, ServiceState
│       │           └── wizard.ts           # WizardStep, ClaudeAuthMode, SetupConfig
│       └── app/
│           ├── package.json
│           ├── tsconfig.json
│           ├── tsconfig.node.json
│           ├── electron.vite.config.ts
│           ├── electron-builder.config.ts
│           ├── vitest.config.ts
│           ├── resources/
│           │   └── docker-compose.prod.yml # 번들 포함 compose 파일
│           └── src/
│               ├── main/
│               │   ├── index.ts            # 앱 진입점, IPC 등록, 생명주기
│               │   ├── setup-store.ts      # userData/setup-complete.json 관리
│               │   ├── docker-manager.ts   # Docker 감지/설치/compose 실행
│               │   ├── claude-detector.ts  # Claude CLI 감지/설치/로그인
│               │   ├── service-monitor.ts  # 서비스 헬스 폴링 → IPC 스트림
│               │   ├── tray-manager.ts     # 시스템 트레이 아이콘·메뉴
│               │   └── updater.ts          # electron-updater 자동 업데이트
│               ├── preload/
│               │   └── index.ts            # contextBridge IPC 계약
│               └── renderer/
│                   ├── index.html
│                   └── src/
│                       ├── main.tsx
│                       ├── App.tsx         # 마법사 vs 대시보드 라우팅
│                       ├── electron.d.ts
│                       ├── styles/globals.css
│                       ├── lib/utils.ts
│                       ├── stores/
│                       │   ├── wizard.store.ts    # 마법사 단계·상태
│                       │   └── services.store.ts  # 서비스 상태 맵
│                       └── components/
│                           ├── wizard/
│                           │   ├── WizardLayout.tsx
│                           │   ├── StepWelcome.tsx
│                           │   ├── StepDocker.tsx
│                           │   ├── StepClaude.tsx
│                           │   ├── StepServices.tsx
│                           │   └── StepComplete.tsx
│                           ├── dashboard/
│                           │   ├── Dashboard.tsx
│                           │   ├── ActionBar.tsx
│                           │   ├── ServiceRow.tsx
│                           │   └── LogStream.tsx
│                           ├── UpdateModal.tsx
│                           ├── SettingsModal.tsx
│                           └── ui/             # Button, Badge (shadcn)
├── docker-compose.prod.yml                 # GHCR 이미지 기반 compose
└── .github/workflows/
    ├── docker-publish.yml                  # 서비스 이미지 GHCR 배포
    └── launcher-release.yml               # 런처 앱 플랫폼 빌드·릴리스
```

---

## Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `xzawedLauncher/package.json`
- Create: `xzawedLauncher/pnpm-workspace.yaml`
- Create: `xzawedLauncher/tsconfig.json`
- Create: `xzawedLauncher/packages/shared/package.json`
- Create: `xzawedLauncher/packages/shared/tsconfig.json`
- Create: `xzawedLauncher/packages/app/package.json`
- Create: `xzawedLauncher/packages/app/tsconfig.json`
- Create: `xzawedLauncher/packages/app/tsconfig.node.json`
- Create: `xzawedLauncher/packages/app/electron.vite.config.ts`
- Create: `xzawedLauncher/packages/app/electron-builder.config.ts`

- [ ] **Step 1: xzawedLauncher/package.json 생성**

```json
{
  "name": "xzawed-launcher-root",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @xzawed/launcher-app dev",
    "build": "pnpm --filter @xzawed/launcher-shared build && pnpm --filter @xzawed/launcher-app build",
    "test": "pnpm --filter @xzawed/launcher-app test",
    "package": "pnpm --filter @xzawed/launcher-app package"
  }
}
```

- [ ] **Step 2: pnpm-workspace.yaml 생성**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: tsconfig.json (루트) 생성**

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ESNext",
    "lib": ["ESNext"],
    "skipLibCheck": true
  }
}
```

- [ ] **Step 4: packages/shared/package.json 생성**

```json
{
  "name": "@xzawed/launcher-shared",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 5: packages/shared/tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 6: packages/app/package.json 생성**

```json
{
  "name": "@xzawed/launcher-app",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package": "electron-vite build && electron-builder",
    "test": "vitest run"
  },
  "dependencies": {
    "@xzawed/launcher-shared": "workspace:*",
    "electron-updater": "^6.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.6.0",
    "class-variance-authority": "^0.7.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.0",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^20.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.3.0",
    "tailwindcss": "^4.3.0",
    "typescript": "^5.4.0",
    "vite": "^6.4.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 7: packages/app/tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "composite": true,
    "outDir": "out"
  },
  "include": ["src/renderer/src"]
}
```

- [ ] **Step 8: packages/app/tsconfig.node.json 생성**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "CommonJS",
    "moduleResolution": "Node16",
    "skipLibCheck": true,
    "outDir": "out"
  },
  "include": ["src/main", "src/preload", "electron.vite.config.ts"]
}
```

- [ ] **Step 9: packages/app/electron.vite.config.ts 생성**

```typescript
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
```

- [ ] **Step 10: packages/app/electron-builder.config.ts 생성**

```typescript
import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.xzawed.launcher',
  productName: 'xzawed Launcher',
  directories: { output: 'dist', buildResources: 'resources' },
  files: ['out/**/*', 'resources/docker-compose.prod.yml'],
  extraResources: [{ from: 'resources/docker-compose.prod.yml', to: 'docker-compose.prod.yml' }],
  publish: {
    provider: 'github',
    owner: 'xzawed',
    repo: 'xzawed-pais',
    releaseType: 'release',
  },
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  mac: { target: [{ target: 'dmg', arch: ['x64', 'arm64'] }], notarize: false },
  linux: { target: [{ target: 'AppImage', arch: ['x64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
}

export default config
```

- [ ] **Step 11: 의존성 설치**

```bash
cd xzawedLauncher
pnpm install
```

예상 출력: `node_modules` 생성, lock 파일 생성

- [ ] **Step 12: 커밋**

```bash
git add xzawedLauncher/
git commit -m "feat(launcher): 프로젝트 스캐폴딩 — pnpm workspace + electron-vite 설정"
```

---

## Task 2: 공유 타입 정의

**Files:**
- Create: `xzawedLauncher/packages/shared/src/types/service.ts`
- Create: `xzawedLauncher/packages/shared/src/types/wizard.ts`
- Create: `xzawedLauncher/packages/shared/src/index.ts`

- [ ] **Step 1: service.ts 작성**

```typescript
// packages/shared/src/types/service.ts

export const SERVICE_NAMES = [
  'postgres', 'redis',
  'orchestrator', 'manager', 'planner',
  'developer', 'designer', 'tester',
  'builder', 'watcher', 'security',
] as const

export type ServiceName = typeof SERVICE_NAMES[number]

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error' | 'restarting'

export interface ServiceState {
  name: ServiceName
  status: ServiceStatus
  port?: number
}

export type ServicesMap = Record<ServiceName, ServiceState>
```

- [ ] **Step 2: wizard.ts 작성**

```typescript
// packages/shared/src/types/wizard.ts

export type WizardStep = 'welcome' | 'docker' | 'claude' | 'services' | 'complete'

export type ClaudeAuthMode = 'cli' | 'api'

export interface SetupConfig {
  claudeMode: ClaudeAuthMode
  apiKey?: string
  githubToken?: string
  completedAt: string  // ISO 8601
}

export type DockerInstallStatus =
  | 'checking'
  | 'running'
  | 'installed-stopped'
  | 'not-installed'
  | 'installing'
  | 'error'

export type ClaudeDetectStatus =
  | 'checking'
  | 'logged-in'
  | 'not-logged-in'
  | 'not-installed'
  | 'installing'
  | 'error'
```

- [ ] **Step 3: index.ts 작성**

```typescript
// packages/shared/src/index.ts
export * from './types/service.js'
export * from './types/wizard.js'
```

- [ ] **Step 4: shared 빌드 확인**

```bash
cd xzawedLauncher/packages/shared
pnpm build
```

예상 출력: `dist/` 디렉터리 생성, 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add xzawedLauncher/packages/shared/
git commit -m "feat(launcher): shared 타입 — ServiceState, WizardStep, SetupConfig"
```

---

## Task 3: Preload IPC 계약 + electron.d.ts

**Files:**
- Create: `xzawedLauncher/packages/app/src/preload/index.ts`
- Create: `xzawedLauncher/packages/app/src/renderer/src/electron.d.ts`

- [ ] **Step 1: preload/index.ts 작성**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ServiceState, SetupConfig, DockerInstallStatus, ClaudeDetectStatus } from '@xzawed/launcher-shared'

contextBridge.exposeInMainWorld('launcherAPI', {
  // Setup
  isSetupComplete: (): Promise<boolean> =>
    ipcRenderer.invoke('setup:is-complete'),
  getSetupConfig: (): Promise<SetupConfig | null> =>
    ipcRenderer.invoke('setup:get-config'),
  saveSetupConfig: (config: SetupConfig): Promise<void> =>
    ipcRenderer.invoke('setup:save-config', config),

  // Docker
  checkDocker: (): Promise<DockerInstallStatus> =>
    ipcRenderer.invoke('docker:check'),
  installDocker: (): Promise<void> =>
    ipcRenderer.invoke('docker:install'),
  startDockerDesktop: (): Promise<void> =>
    ipcRenderer.invoke('docker:start-desktop'),

  // Claude
  checkClaude: (): Promise<ClaudeDetectStatus> =>
    ipcRenderer.invoke('claude:check'),
  installClaude: (): Promise<void> =>
    ipcRenderer.invoke('claude:install'),
  openClaudeLogin: (): Promise<void> =>
    ipcRenderer.invoke('claude:open-login'),
  waitClaudeLogin: (): Promise<boolean> =>
    ipcRenderer.invoke('claude:wait-login'),

  // Services
  startAllServices: (): Promise<void> =>
    ipcRenderer.invoke('services:start-all'),
  stopAllServices: (): Promise<void> =>
    ipcRenderer.invoke('services:stop-all'),
  restartAllServices: (): Promise<void> =>
    ipcRenderer.invoke('services:restart-all'),
  restartService: (name: string): Promise<void> =>
    ipcRenderer.invoke('services:restart', name),
  stopService: (name: string): Promise<void> =>
    ipcRenderer.invoke('services:stop', name),
  getServicesStatus: (): Promise<ServiceState[]> =>
    ipcRenderer.invoke('services:get-status'),
  onServicesUpdate: (cb: (states: ServiceState[]) => void) => {
    ipcRenderer.on('services:update', (_e, states) => cb(states))
    return (): void => { ipcRenderer.removeAllListeners('services:update') }
  },
  onLogLine: (cb: (line: string) => void) => {
    ipcRenderer.on('services:log', (_e, line) => cb(line))
    return (): void => { ipcRenderer.removeAllListeners('services:log') }
  },

  // Updater
  checkUpdate: (): Promise<void> =>
    ipcRenderer.invoke('updater:check'),
  installUpdate: (): Promise<void> =>
    ipcRenderer.invoke('updater:install'),
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes: string }) => void) => {
    ipcRenderer.on('updater:available', (_e, info) => cb(info))
    return (): void => { ipcRenderer.removeAllListeners('updater:available') }
  },

  // Tray
  minimizeToTray: (): Promise<void> =>
    ipcRenderer.invoke('tray:minimize'),
  openOrchestrator: (): Promise<void> =>
    ipcRenderer.invoke('orchestrator:open'),
})
```

- [ ] **Step 2: electron.d.ts 작성**

```typescript
// src/renderer/src/electron.d.ts
import type { ServiceState, SetupConfig, DockerInstallStatus, ClauteDetectStatus } from '@xzawed/launcher-shared'

interface LauncherAPI {
  isSetupComplete(): Promise<boolean>
  getSetupConfig(): Promise<SetupConfig | null>
  saveSetupConfig(config: SetupConfig): Promise<void>
  checkDocker(): Promise<DockerInstallStatus>
  installDocker(): Promise<void>
  startDockerDesktop(): Promise<void>
  checkClaude(): Promise<ClaudeDetectStatus>
  installClaude(): Promise<void>
  openClaudeLogin(): Promise<void>
  waitClaudeLogin(): Promise<boolean>
  startAllServices(): Promise<void>
  stopAllServices(): Promise<void>
  restartAllServices(): Promise<void>
  restartService(name: string): Promise<void>
  stopService(name: string): Promise<void>
  getServicesStatus(): Promise<ServiceState[]>
  onServicesUpdate(cb: (states: ServiceState[]) => void): () => void
  onLogLine(cb: (line: string) => void): () => void
  checkUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateAvailable(cb: (info: { version: string; releaseNotes: string }) => void): () => void
  minimizeToTray(): Promise<void>
  openOrchestrator(): Promise<void>
}

declare global {
  interface Window { launcherAPI?: LauncherAPI }
  var launcherAPI: LauncherAPI | undefined
}
export {}
```

- [ ] **Step 3: 커밋**

```bash
git add xzawedLauncher/packages/app/src/preload/ xzawedLauncher/packages/app/src/renderer/src/electron.d.ts
git commit -m "feat(launcher): preload IPC 계약 + electron.d.ts"
```

---

## Task 4: SetupStore (main process)

**Files:**
- Create: `xzawedLauncher/packages/app/src/main/setup-store.ts`
- Create: `xzawedLauncher/packages/app/test/main/setup-store.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// test/main/setup-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/xzawed-launcher-test') }, // NOSONAR
}))

let setupStore: typeof import('../../src/main/setup-store.js')

beforeEach(async () => {
  vi.resetModules()
  setupStore = await import('../../src/main/setup-store.js')
})

describe('SetupStore', () => {
  it('isComplete returns false when file absent', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(await setupStore.isSetupComplete()).toBe(false)
  })

  it('isComplete returns true when file exists', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ claudeMode: 'cli', completedAt: '2026-01-01T00:00:00Z' })
    )
    expect(await setupStore.isSetupComplete()).toBe(true)
  })

  it('saveConfig writes JSON to userData path', async () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
    await setupStore.saveSetupConfig({ claudeMode: 'cli', completedAt: '2026-01-01T00:00:00Z' })
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('setup-complete.json'),
      expect.stringContaining('"claudeMode":"cli"')
    )
  })
})
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
cd xzawedLauncher/packages/app
pnpm test test/main/setup-store.test.ts
```

예상: FAIL — `setup-store.ts` 없음

- [ ] **Step 3: setup-store.ts 구현**

```typescript
// src/main/setup-store.ts
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { SetupConfig } from '@xzawed/launcher-shared'

function configPath(): string {
  return path.join(app.getPath('userData'), 'setup-complete.json')
}

export function isSetupComplete(): boolean {
  try {
    return fs.existsSync(configPath())
  } catch {
    return false
  }
}

export function getSetupConfig(): SetupConfig | null {
  try {
    if (!fs.existsSync(configPath())) return null
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as SetupConfig
  } catch {
    return null
  }
}

export function saveSetupConfig(config: SetupConfig): void {
  const p = configPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(config))
}
```

- [ ] **Step 4: 테스트 재실행 (통과 확인)**

```bash
pnpm test test/main/setup-store.test.ts
```

예상: PASS 3/3

- [ ] **Step 5: 커밋**

```bash
git add xzawedLauncher/packages/app/src/main/setup-store.ts xzawedLauncher/packages/app/test/
git commit -m "feat(launcher): SetupStore — userData setup-complete.json 관리"
```

---

## Task 5: DockerManager

**Files:**
- Create: `xzawedLauncher/packages/app/src/main/docker-manager.ts`
- Create: `xzawedLauncher/packages/app/test/main/docker-manager.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// test/main/docker-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const execMock = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (cmd: string, cb: (e: Error | null, r: { stdout: string }) => void) =>
    execMock(cmd, cb),
  spawn: vi.fn(() => ({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() })),
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, app: { getAppPath: vi.fn(() => '/app') } }))

let dm: typeof import('../../src/main/docker-manager.js')

beforeEach(async () => {
  vi.resetModules()
  dm = await import('../../src/main/docker-manager.js')
})

describe('DockerManager', () => {
  it('checkDocker returns running when docker info exits 0', async () => {
    execMock.mockImplementation((_cmd: string, cb: (e: Error | null, r: { stdout: string }) => void) =>
      cb(null, { stdout: 'Server: Docker Engine' })
    )
    const status = await dm.checkDocker()
    expect(status).toBe('running')
  })

  it('checkDocker returns not-installed when exec errors', async () => {
    execMock.mockImplementation((_cmd: string, cb: (e: Error | null) => void) =>
      cb(new Error('not found'))
    )
    const status = await dm.checkDocker()
    expect(status).toBe('not-installed')
  })
})
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
pnpm test test/main/docker-manager.test.ts
```

예상: FAIL

- [ ] **Step 3: docker-manager.ts 구현**

```typescript
// src/main/docker-manager.ts
import { exec, spawn } from 'node:child_process'
import path from 'node:path'
import { app, shell } from 'electron'
import type { DockerInstallStatus, ServiceName, ServiceState, ServiceStatus } from '@xzawed/launcher-shared'

const COMPOSE_FILE = path.join(process.resourcesPath ?? app.getAppPath(), 'docker-compose.prod.yml')

function execAsync(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, result) => {
      if (err) reject(err)
      else resolve(typeof result === 'string' ? result : result.stdout)
    })
  })
}

export async function checkDocker(): Promise<DockerInstallStatus> {
  try {
    const out = await execAsync('docker info')
    return out.includes('Server') ? 'running' : 'installed-stopped'
  } catch {
    try {
      await execAsync('docker --version')
      return 'installed-stopped'
    } catch {
      return 'not-installed'
    }
  }
}

export async function startDockerDesktop(): Promise<void> {
  const cmds: Record<string, string> = {
    win32: 'start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"',
    darwin: 'open -a Docker',
    linux: 'systemctl --user start docker-desktop',
  }
  const cmd = cmds[process.platform] ?? cmds.linux
  await execAsync(cmd).catch(() => {})
}

export async function installDocker(): Promise<void> {
  const urls: Record<string, string> = {
    win32: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
    darwin: 'https://desktop.docker.com/mac/main/arm64/Docker.dmg',
    linux: 'https://docs.docker.com/engine/install/',
  }
  await shell.openExternal(urls[process.platform] ?? urls.linux)
}

export async function startAllServices(onLog: (line: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d'], { shell: false })
    proc.stdout.on('data', (d: Buffer) => onLog(d.toString()))
    proc.stderr.on('data', (d: Buffer) => onLog(d.toString()))
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
  })
}

export async function stopAllServices(): Promise<void> {
  await execAsync(`docker compose -f "${COMPOSE_FILE}" down`)
}

export async function restartAllServices(onLog: (line: string) => void): Promise<void> {
  await stopAllServices()
  await startAllServices(onLog)
}

export async function restartService(name: string): Promise<void> {
  await execAsync(`docker compose -f "${COMPOSE_FILE}" restart ${name}`)
}

export async function stopService(name: string): Promise<void> {
  await execAsync(`docker compose -f "${COMPOSE_FILE}" stop ${name}`)
}

export async function getServiceStatuses(): Promise<ServiceState[]> {
  const PORT_MAP: Partial<Record<ServiceName, number>> = {
    orchestrator: 3000, manager: 3001, planner: 3002,
    developer: 3003, designer: 3004, tester: 3005,
    builder: 3006, watcher: 3007, security: 3008,
  }
  try {
    const out = await execAsync(`docker compose -f "${COMPOSE_FILE}" ps --format json`)
    const rows = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    return rows.map((r: { Name: string; State: string; Health: string }) => {
      const name = r.Name.replace(/^xzawed[_-]/, '').replace(/[_-]\d+$/, '') as ServiceName
      let status: ServiceStatus = 'stopped'
      if (r.State === 'running' && r.Health === 'healthy') status = 'running'
      else if (r.State === 'running') status = 'starting'
      else if (r.State === 'restarting') status = 'restarting'
      else if (r.State === 'exited') status = 'error'
      return { name, status, port: PORT_MAP[name] }
    })
  } catch {
    return []
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test test/main/docker-manager.test.ts
```

예상: PASS 2/2

- [ ] **Step 5: 커밋**

```bash
git add xzawedLauncher/packages/app/src/main/docker-manager.ts xzawedLauncher/packages/app/test/main/docker-manager.test.ts
git commit -m "feat(launcher): DockerManager — 감지/설치/compose 실행"
```

---

## Task 6: ClaudeDetector

**Files:**
- Create: `xzawedLauncher/packages/app/src/main/claude-detector.ts`
- Create: `xzawedLauncher/packages/app/test/main/claude-detector.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// test/main/claude-detector.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const execMock = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (cmd: string, cb: (e: Error | null, r: { stdout: string }) => void) => execMock(cmd, cb),
  spawn: vi.fn(() => ({ stdout: { on: vi.fn() }, on: vi.fn() })),
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

let cd: typeof import('../../src/main/claude-detector.js')

beforeEach(async () => {
  vi.resetModules()
  cd = await import('../../src/main/claude-detector.js')
})

describe('ClaudeDetector', () => {
  it('checkClaude returns logged-in when whoami succeeds', async () => {
    execMock.mockImplementation((_: string, cb: (e: null, r: { stdout: string }) => void) =>
      cb(null, { stdout: 'user@example.com' })
    )
    expect(await cd.checkClaude()).toBe('logged-in')
  })

  it('checkClaude returns not-logged-in when whoami says not logged in', async () => {
    execMock.mockImplementation((_: string, cb: (e: null, r: { stdout: string }) => void) =>
      cb(null, { stdout: 'Not logged in' })
    )
    expect(await cd.checkClaude()).toBe('not-logged-in')
  })

  it('checkClaude returns not-installed when claude not found', async () => {
    execMock.mockImplementation((_: string, cb: (e: Error) => void) =>
      cb(new Error('command not found'))
    )
    expect(await cd.checkClaude()).toBe('not-installed')
  })
})
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
pnpm test test/main/claude-detector.test.ts
```

예상: FAIL

- [ ] **Step 3: claude-detector.ts 구현**

```typescript
// src/main/claude-detector.ts
import { exec, spawn } from 'node:child_process'
import { shell } from 'electron'
import type { ClaudeDetectStatus } from '@xzawed/launcher-shared'

function execAsync(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, result) => {
      if (err) reject(err)
      else resolve(typeof result === 'string' ? result : result.stdout)
    })
  })
}

export async function checkClaude(): Promise<ClaudeDetectStatus> {
  try {
    const out = await execAsync('claude whoami')
    if (out.toLowerCase().includes('not logged in') || out.trim() === '') {
      return 'not-logged-in'
    }
    return 'logged-in'
  } catch {
    try {
      await execAsync('claude --version')
      return 'not-logged-in'
    } catch {
      return 'not-installed'
    }
  }
}

export async function getClaudeEmail(): Promise<string | null> {
  try {
    const out = await execAsync('claude whoami')
    const match = out.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export async function installClaude(onLog: (line: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('npm', ['install', '-g', '@anthropic-ai/claude-code'], { shell: false })
    proc.stdout.on('data', (d: Buffer) => onLog(d.toString()))
    proc.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(`npm exit ${code}`))))
  })
}

export async function openClaudeLogin(): Promise<void> {
  await shell.openExternal('https://claude.ai/login')
}

export async function waitClaudeLogin(timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await checkClaude()
    if (status === 'logged-in') return true
    await new Promise((r) => setTimeout(r, 2_000))
  }
  return false
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test test/main/claude-detector.test.ts
```

예상: PASS 3/3

- [ ] **Step 5: 커밋**

```bash
git add xzawedLauncher/packages/app/src/main/claude-detector.ts xzawedLauncher/packages/app/test/main/claude-detector.test.ts
git commit -m "feat(launcher): ClaudeDetector — CLI 감지/설치/로그인 대기"
```

---

## Task 7: ServiceMonitor + TrayManager + Updater

**Files:**
- Create: `xzawedLauncher/packages/app/src/main/service-monitor.ts`
- Create: `xzawedLauncher/packages/app/src/main/tray-manager.ts`
- Create: `xzawedLauncher/packages/app/src/main/updater.ts`

- [ ] **Step 1: service-monitor.ts 작성**

```typescript
// src/main/service-monitor.ts
import { BrowserWindow, ipcMain } from 'electron'
import { getServiceStatuses } from './docker-manager.js'

let interval: ReturnType<typeof setInterval> | null = null

export function startMonitoring(win: BrowserWindow): void {
  if (interval) return
  interval = setInterval(async () => {
    try {
      const states = await getServiceStatuses()
      if (!win.isDestroyed()) {
        win.webContents.send('services:update', states)
      }
    } catch { /* ignore */ }
  }, 3_000)
}

export function stopMonitoring(): void {
  if (interval) { clearInterval(interval); interval = null }
}

export function registerServiceIpc(win: BrowserWindow): void {
  ipcMain.handle('services:get-status', () => getServiceStatuses())
  ipcMain.handle('services:start-all', async () => {
    const { startAllServices } = await import('./docker-manager.js')
    await startAllServices((line) => {
      if (!win.isDestroyed()) win.webContents.send('services:log', line)
    })
  })
  ipcMain.handle('services:stop-all', async () => {
    const { stopAllServices } = await import('./docker-manager.js')
    await stopAllServices()
  })
  ipcMain.handle('services:restart-all', async () => {
    const { restartAllServices } = await import('./docker-manager.js')
    await restartAllServices((line) => {
      if (!win.isDestroyed()) win.webContents.send('services:log', line)
    })
  })
  ipcMain.handle('services:restart', (_e, name: string) => {
    const { restartService } = require('./docker-manager.js')
    return restartService(name)
  })
  ipcMain.handle('services:stop', (_e, name: string) => {
    const { stopService } = require('./docker-manager.js')
    return stopService(name)
  })
}
```

- [ ] **Step 2: tray-manager.ts 작성**

```typescript
// src/main/tray-manager.ts
import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import path from 'node:path'
import type { ServiceState } from '@xzawed/launcher-shared'

let tray: Tray | null = null

function getIconPath(status: 'ok' | 'warn' | 'error'): string {
  const name = `tray-${status}.png`
  return path.join(process.resourcesPath ?? __dirname, name)
}

export function createTray(win: BrowserWindow): Tray {
  tray = new Tray(nativeImage.createEmpty())
  updateTrayIcon([])
  tray.setToolTip('xzawed Launcher')
  tray.on('click', () => {
    win.show()
    win.focus()
  })
  updateTrayMenu(win)
  return tray
}

export function updateTrayIcon(states: ServiceState[]): void {
  if (!tray) return
  const hasError = states.some((s) => s.status === 'error')
  const hasWarn = states.some((s) => s.status === 'starting' || s.status === 'restarting')
  const status = hasError ? 'error' : hasWarn ? 'warn' : 'ok'
  try {
    tray.setImage(nativeImage.createFromPath(getIconPath(status)))
  } catch { /* icon file absent in dev */ }
}

function updateTrayMenu(win: BrowserWindow): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '🎯 Orchestrator 열기', click: () => { require('./docker-manager.js').openOrchestrator?.() } },
      { label: '📊 대시보드 표시', click: () => { win.show(); win.focus() } },
      { type: 'separator' },
      { label: '▶️ 전체 시작', click: () => { require('./docker-manager.js').startAllServices(() => {}).catch(() => {}) } },
      { label: '⏹ 전체 중지', click: () => { require('./docker-manager.js').stopAllServices().catch(() => {}) } },
      { label: '↺ 전체 재시작', click: () => { require('./docker-manager.js').restartAllServices(() => {}).catch(() => {}) } },
      { type: 'separator' },
      { label: '🔄 업데이트 확인', click: () => { require('./updater.js').checkForUpdates() } },
      { label: '⚙️ 설정', click: () => { win.show(); win.webContents.send('open-settings') } },
      { type: 'separator' },
      { label: '✕ 완전 종료', click: () => { app.quit() } },
    ])
  )
}
```

- [ ] **Step 3: updater.ts 작성**

```typescript
// src/main/updater.ts
import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

export function initUpdater(win: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    const notes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note ?? '')).join('\n')
        : ''
    if (!win.isDestroyed()) {
      win.webContents.send('updater:available', { version: info.version, releaseNotes: notes })
    }
  })

  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates())
  ipcMain.handle('updater:install', async () => {
    await autoUpdater.downloadUpdate()
    autoUpdater.quitAndInstall()
  })
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {})
}
```

- [ ] **Step 4: 커밋**

```bash
git add xzawedLauncher/packages/app/src/main/
git commit -m "feat(launcher): ServiceMonitor + TrayManager + Updater"
```

---

## Task 8: Main Process 진입점

**Files:**
- Create: `xzawedLauncher/packages/app/src/main/index.ts`

- [ ] **Step 1: index.ts 작성**

```typescript
// src/main/index.ts
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import path from 'node:path'
import { isSetupComplete, getSetupConfig, saveSetupConfig } from './setup-store.js'
import { checkDocker, startDockerDesktop, installDocker } from './docker-manager.js'
import { checkClaude, installClaude, openClaudeLogin, waitClaudeLogin, getClaudeEmail } from './claude-detector.js'
import { startMonitoring, stopMonitoring, registerServiceIpc } from './service-monitor.js'
import { createTray, updateTrayIcon } from './tray-manager.js'
import { initUpdater, checkForUpdates } from './updater.js'
import type { SetupConfig } from '@xzawed/launcher-shared'

let win: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  })

  win.once('ready-to-show', () => win?.show())

  win.on('close', (e) => {
    e.preventDefault()
    win?.hide()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(w: BrowserWindow): void {
  // Setup
  ipcMain.handle('setup:is-complete', () => isSetupComplete())
  ipcMain.handle('setup:get-config', () => getSetupConfig())
  ipcMain.handle('setup:save-config', (_e, config: SetupConfig) => saveSetupConfig(config))

  // Docker
  ipcMain.handle('docker:check', () => checkDocker())
  ipcMain.handle('docker:install', () => installDocker())
  ipcMain.handle('docker:start-desktop', () => startDockerDesktop())

  // Claude
  ipcMain.handle('claude:check', () => checkClaude())
  ipcMain.handle('claude:get-email', () => getClaudeEmail())
  ipcMain.handle('claude:install', () => installClaude((line) => {
    if (!w.isDestroyed()) w.webContents.send('services:log', line)
  }))
  ipcMain.handle('claude:open-login', () => openClaudeLogin())
  ipcMain.handle('claude:wait-login', () => waitClaudeLogin())

  // Token (safeStorage)
  ipcMain.handle('token:get', () => {
    try {
      const raw = require('node:fs').readFileSync(
        require('node:path').join(app.getPath('userData'), 'api-key.enc')
      ) as Buffer
      return safeStorage.decryptString(raw)
    } catch { return null }
  })
  ipcMain.handle('token:set', (_e, key: string) => {
    const enc = safeStorage.encryptString(key)
    const p = require('node:path').join(app.getPath('userData'), 'api-key.enc')
    require('node:fs').mkdirSync(require('node:path').dirname(p), { recursive: true })
    require('node:fs').writeFileSync(p, enc)
  })
  ipcMain.handle('token:clear', () => {
    try {
      require('node:fs').unlinkSync(
        require('node:path').join(app.getPath('userData'), 'api-key.enc')
      )
    } catch { /* ignore */ }
  })

  // Tray
  ipcMain.handle('tray:minimize', () => w.hide())
  ipcMain.handle('orchestrator:open', () =>
    require('electron').shell.openExternal('http://localhost:3000')
  )

  registerServiceIpc(w)
}

app.whenReady().then(() => {
  const w = createWindow()
  registerIpc(w)
  createTray(w)
  initUpdater(w)

  // 서비스 상태 구독 → 트레이 아이콘 갱신
  w.webContents.on('ipc-message', () => {})
  setInterval(async () => {
    try {
      const { getServiceStatuses } = await import('./docker-manager.js')
      const states = await getServiceStatuses()
      updateTrayIcon(states)
    } catch { /* ignore */ }
  }, 5_000)

  startMonitoring(w)

  // 앱 시작 후 업데이트 확인
  setTimeout(() => checkForUpdates(), 5_000)

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => {
  stopMonitoring()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: 커밋**

```bash
git add xzawedLauncher/packages/app/src/main/index.ts
git commit -m "feat(launcher): main process 진입점 — IPC 등록, 트레이, 업데이터 초기화"
```

---

## Task 9: Renderer 기반 (App.tsx + stores + styles)

**Files:**
- Create: `xzawedLauncher/packages/app/src/renderer/index.html`
- Create: `xzawedLauncher/packages/app/src/renderer/src/main.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/App.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/styles/globals.css`
- Create: `xzawedLauncher/packages/app/src/renderer/src/lib/utils.ts`
- Create: `xzawedLauncher/packages/app/src/renderer/src/stores/wizard.store.ts`
- Create: `xzawedLauncher/packages/app/src/renderer/src/stores/services.store.ts`

- [ ] **Step 1: index.html 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>xzawed Launcher</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: main.tsx 작성**

```tsx
// src/renderer/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

- [ ] **Step 3: globals.css 작성**

```css
/* src/renderer/src/styles/globals.css */
@import "tailwindcss";

:root {
  --bg: #0f0f10;
  --surface: #18181b;
  --surface-raised: #27272a;
  --border: #3f3f46;
  --fg: #fafafa;
  --fg-muted: #a1a1aa;
  --accent: #6366f1;
  --accent-hover: #4f46e5;
  color-scheme: dark;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  margin: 0;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 4: lib/utils.ts 작성**

```typescript
// src/renderer/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: stores/wizard.store.ts 작성**

```typescript
// src/renderer/src/stores/wizard.store.ts
import { create } from 'zustand'
import type { WizardStep, DockerInstallStatus, ClaudeDetectStatus } from '@xzawed/launcher-shared'

interface WizardState {
  step: WizardStep
  dockerStatus: DockerInstallStatus
  claudeStatus: ClaudeDetectStatus
  claudeEmail: string | null
  isLoading: boolean
  error: string | null
  setStep: (step: WizardStep) => void
  setDockerStatus: (s: DockerInstallStatus) => void
  setClaudeStatus: (s: ClaudeDetectStatus) => void
  setClaudeEmail: (email: string | null) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
}

export const useWizardStore = create<WizardState>((set) => ({
  step: 'welcome',
  dockerStatus: 'checking',
  claudeStatus: 'checking',
  claudeEmail: null,
  isLoading: false,
  error: null,
  setStep: (step) => set({ step }),
  setDockerStatus: (dockerStatus) => set({ dockerStatus }),
  setClaudeStatus: (claudeStatus) => set({ claudeStatus }),
  setClaudeEmail: (claudeEmail) => set({ claudeEmail }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}))
```

- [ ] **Step 6: stores/services.store.ts 작성**

```typescript
// src/renderer/src/stores/services.store.ts
import { create } from 'zustand'
import type { ServiceState } from '@xzawed/launcher-shared'

interface ServicesState {
  services: ServiceState[]
  logs: string[]
  setServices: (s: ServiceState[]) => void
  appendLog: (line: string) => void
  clearLogs: () => void
}

export const useServicesStore = create<ServicesState>((set) => ({
  services: [],
  logs: [],
  setServices: (services) => set({ services }),
  appendLog: (line) => set((s) => ({ logs: [...s.logs.slice(-200), line] })),
  clearLogs: () => set({ logs: [] }),
}))
```

- [ ] **Step 7: App.tsx 작성**

```tsx
// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'
import WizardLayout from './components/wizard/WizardLayout.js'
import Dashboard from './components/dashboard/Dashboard.js'
import UpdateModal from './components/UpdateModal.js'
import { useServicesStore } from './stores/services.store.js'
import type { ServiceState } from '@xzawed/launcher-shared'

export default function App(): JSX.Element {
  const [isSetupDone, setIsSetupDone] = useState<boolean | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; releaseNotes: string } | null>(null)
  const setServices = useServicesStore((s) => s.setServices)
  const appendLog = useServicesStore((s) => s.appendLog)

  useEffect(() => {
    void globalThis.launcherAPI?.isSetupComplete().then(setIsSetupDone)

    const unsubServices = globalThis.launcherAPI?.onServicesUpdate((states: ServiceState[]) => setServices(states))
    const unsubLog = globalThis.launcherAPI?.onLogLine((line: string) => appendLog(line))
    const unsubUpdate = globalThis.launcherAPI?.onUpdateAvailable(setUpdateInfo)

    return () => {
      unsubServices?.()
      unsubLog?.()
      unsubUpdate?.()
    }
  }, [setServices, appendLog])

  if (isSetupDone === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-[var(--fg-muted)] text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <>
      {isSetupDone ? <Dashboard /> : <WizardLayout onComplete={() => setIsSetupDone(true)} />}
      {updateInfo && <UpdateModal info={updateInfo} onClose={() => setUpdateInfo(null)} />}
    </>
  )
}
```

- [ ] **Step 8: 커밋**

```bash
git add xzawedLauncher/packages/app/src/renderer/
git commit -m "feat(launcher): renderer 기반 — App.tsx 라우팅, Zustand stores, 글로벌 CSS"
```

---

## Task 10: 마법사 UI 컴포넌트

**Files:**
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/wizard/WizardLayout.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/wizard/StepWelcome.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/wizard/StepDocker.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/wizard/StepClaude.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/wizard/StepServices.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/wizard/StepComplete.tsx`

- [ ] **Step 1: WizardLayout.tsx 작성**

```tsx
// src/renderer/src/components/wizard/WizardLayout.tsx
import { useWizardStore } from '../../stores/wizard.store.js'
import StepWelcome from './StepWelcome.js'
import StepDocker from './StepDocker.js'
import StepClaude from './StepClaude.js'
import StepServices from './StepServices.js'
import StepComplete from './StepComplete.js'
import type { WizardStep } from '@xzawed/launcher-shared'

const STEPS: WizardStep[] = ['welcome', 'docker', 'claude', 'services', 'complete']
const STEP_LABELS = ['환영', 'Docker', 'Claude', '서비스 기동', '완료']

interface Props { onComplete: () => void }

export default function WizardLayout({ onComplete }: Readonly<Props>): JSX.Element {
  const step = useWizardStore((s) => s.step)
  const idx = STEPS.indexOf(step)

  const StepComponent = {
    welcome: StepWelcome,
    docker: StepDocker,
    claude: StepClaude,
    services: StepServices,
    complete: () => <StepComplete onComplete={onComplete} />,
  }[step]

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[var(--bg)] p-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-10">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              i < idx ? 'bg-[var(--accent)] text-white' :
              i === idx ? 'bg-[var(--accent)] text-white ring-2 ring-[var(--accent)]/40' :
              'bg-[var(--surface-raised)] text-[var(--fg-muted)]'
            }`}>
              {i < idx ? '✓' : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-8 transition-colors ${i < idx ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        ))}
      </div>
      <div className="w-full max-w-md">
        <StepComponent />
      </div>
      <div className="mt-4 text-xs text-[var(--fg-muted)]">{STEP_LABELS[idx]}</div>
    </div>
  )
}
```

- [ ] **Step 2: StepWelcome.tsx 작성**

```tsx
// src/renderer/src/components/wizard/StepWelcome.tsx
import { useWizardStore } from '../../stores/wizard.store.js'

export default function StepWelcome(): JSX.Element {
  const setStep = useWizardStore((s) => s.setStep)
  return (
    <div className="flex flex-col items-center text-center gap-4">
      <div className="text-6xl">🤖</div>
      <h1 className="text-2xl font-bold text-[var(--fg)]">xzawed에 오신 것을 환영합니다</h1>
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        AI 멀티 에이전트가 여러분의 지시를 실제 소프트웨어로 만들어드립니다.<br />
        지금부터 5단계로 환경을 설정합니다.
      </p>
      <button
        onClick={() => setStep('docker')}
        className="mt-4 rounded-lg bg-[var(--accent)] px-8 py-3 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] transition-colors"
      >
        시작하기 →
      </button>
    </div>
  )
}
```

- [ ] **Step 3: StepDocker.tsx 작성**

```tsx
// src/renderer/src/components/wizard/StepDocker.tsx
import { useEffect } from 'react'
import { useWizardStore } from '../../stores/wizard.store.js'

export default function StepDocker(): JSX.Element {
  const { dockerStatus, isLoading, error, setDockerStatus, setLoading, setError, setStep } = useWizardStore()

  useEffect(() => {
    void (async () => {
      setLoading(true)
      const status = await globalThis.launcherAPI!.checkDocker()
      setDockerStatus(status)
      setLoading(false)
      if (status === 'running') setTimeout(() => setStep('claude'), 800)
    })()
  }, [setDockerStatus, setLoading, setStep])

  async function handleInstall(): Promise<void> {
    setDockerStatus('installing')
    await globalThis.launcherAPI!.installDocker()
    setDockerStatus('checking')
    setError('Docker 설치 파일을 다운로드했습니다. 설치 완료 후 다시 확인하세요.')
  }

  async function handleStartDesktop(): Promise<void> {
    setLoading(true)
    await globalThis.launcherAPI!.startDockerDesktop()
    const status = await globalThis.launcherAPI!.checkDocker()
    setDockerStatus(status)
    setLoading(false)
    if (status === 'running') setStep('claude')
  }

  const statusMap = {
    checking: { icon: '🔍', text: 'Docker 확인 중...', color: 'text-[var(--fg-muted)]' },
    running: { icon: '✅', text: 'Docker 실행 중', color: 'text-green-400' },
    'installed-stopped': { icon: '⚠️', text: 'Docker가 중지되어 있습니다', color: 'text-yellow-400' },
    'not-installed': { icon: '❌', text: 'Docker가 설치되지 않았습니다', color: 'text-red-400' },
    installing: { icon: '⬇️', text: '설치 파일 다운로드 중...', color: 'text-[var(--accent)]' },
    error: { icon: '❌', text: '오류 발생', color: 'text-red-400' },
  }

  const s = statusMap[dockerStatus] ?? statusMap.checking

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-5xl">🐳</div>
      <h2 className="text-xl font-bold">Docker 확인</h2>
      <div className={`text-sm font-medium ${s.color}`}>{s.icon} {s.text}</div>
      {error && <p className="text-xs text-yellow-400 text-center">{error}</p>}
      {dockerStatus === 'not-installed' && (
        <button onClick={() => void handleInstall()} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
          ⬇️ Docker 자동 설치
        </button>
      )}
      {dockerStatus === 'installed-stopped' && (
        <button onClick={() => void handleStartDesktop()} disabled={isLoading} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">
          ▶️ Docker Desktop 시작
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: StepClaude.tsx 작성**

```tsx
// src/renderer/src/components/wizard/StepClaude.tsx
import { useEffect, useState } from 'react'
import { useWizardStore } from '../../stores/wizard.store.js'

export default function StepClaude(): JSX.Element {
  const { claudeStatus, claudeEmail, setClaudeStatus, setClaudeEmail, setStep } = useWizardStore()
  const [showApiForm, setShowApiForm] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    void (async () => {
      const status = await globalThis.launcherAPI!.checkClaude()
      setClaudeStatus(status)
      if (status === 'logged-in') {
        const email = await globalThis.launcherAPI!.checkClaude()
        setClaudeEmail(email === 'logged-in' ? null : null)
        setTimeout(() => setStep('services'), 800)
      }
    })()
  }, [setClaudeStatus, setClaudeEmail, setStep])

  async function handleBrowserLogin(): Promise<void> {
    await globalThis.launcherAPI!.openClaudeLogin()
    setWaiting(true)
    const ok = await globalThis.launcherAPI!.waitClaudeLogin()
    setWaiting(false)
    if (ok) { setClaudeStatus('logged-in'); setStep('services') }
    else setClaudeStatus('not-logged-in')
  }

  async function handleInstall(): Promise<void> {
    setClaudeStatus('installing')
    await globalThis.launcherAPI!.installClaude()
    setClaudeStatus('not-logged-in')
  }

  async function handleSaveApiKey(): Promise<void> {
    await globalThis.launcherAPI!.saveSetupConfig({ claudeMode: 'api', apiKey, completedAt: new Date().toISOString() })
    setStep('services')
  }

  if (showApiForm) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
          ⚠️ Claude CLI 구독이 없을 경우에만 사용합니다. API 사용량에 따라 요금이 부과됩니다.
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-api03-..."
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex gap-2">
          <button onClick={() => setShowApiForm(false)} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-sm text-[var(--fg-muted)]">← CLI로 돌아가기</button>
          <button onClick={() => void handleSaveApiKey()} disabled={!apiKey} className="flex-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">저장하고 계속 →</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-5xl">🔐</div>
      <h2 className="text-xl font-bold">Claude 인증</h2>
      {claudeStatus === 'logged-in' && (
        <div className="text-sm text-green-400">✅ 로그인됨{claudeEmail ? ` (${claudeEmail})` : ''}</div>
      )}
      {claudeStatus === 'not-logged-in' && (
        <>
          <p className="text-sm text-[var(--fg-muted)] text-center">Claude CLI가 설치되어 있지만 로그인이 필요합니다.</p>
          <button onClick={() => void handleBrowserLogin()} disabled={waiting} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {waiting ? '로그인 대기 중...' : '🌐 브라우저로 로그인'}
          </button>
        </>
      )}
      {claudeStatus === 'not-installed' && (
        <>
          <p className="text-sm text-[var(--fg-muted)] text-center">Claude CLI가 설치되어 있지 않습니다.</p>
          <button onClick={() => void handleInstall()} className="rounded-lg bg-[var(--accent)] px-6 py-2 text-sm font-semibold text-white">⬇️ Claude CLI 자동 설치</button>
        </>
      )}
      {claudeStatus === 'installing' && <div className="text-sm text-[var(--accent)]">◌ 설치 중...</div>}
      <button onClick={() => setShowApiForm(true)} className="text-xs text-[var(--accent)] underline mt-2">구독이 없으신가요? API 키로 대신 사용하기</button>
    </div>
  )
}
```

- [ ] **Step 5: StepServices.tsx 작성**

```tsx
// src/renderer/src/components/wizard/StepServices.tsx
import { useEffect, useState } from 'react'
import { useWizardStore } from '../../stores/wizard.store.js'
import { useServicesStore } from '../../stores/services.store.js'
import { SERVICE_NAMES } from '@xzawed/launcher-shared'

export default function StepServices(): JSX.Element {
  const setStep = useWizardStore((s) => s.setStep)
  const { services, logs, setServices, appendLog } = useServicesStore()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setStarting(true)
      try {
        await globalThis.launcherAPI!.startAllServices()
        const states = await globalThis.launcherAPI!.getServicesStatus()
        setServices(states)
        const allOk = states.every((s) => s.status === 'running')
        if (allOk) setTimeout(() => setStep('complete'), 600)
      } catch (e) {
        setError(String(e))
      } finally {
        setStarting(false)
      }
    })()
  }, [setServices, setStep])

  useEffect(() => {
    const unsub = globalThis.launcherAPI?.onLogLine(appendLog)
    return () => unsub?.()
  }, [appendLog])

  function statusIcon(name: string): string {
    const s = services.find((x) => x.name === name)
    if (!s) return '○'
    return { running: '●', starting: '◌', restarting: '◌', error: '✕', stopped: '○' }[s.status] ?? '○'
  }

  function statusColor(name: string): string {
    const s = services.find((x) => x.name === name)
    if (!s) return 'text-[var(--fg-muted)]'
    return { running: 'text-green-400', starting: 'text-yellow-400', restarting: 'text-yellow-400', error: 'text-red-400', stopped: 'text-[var(--fg-muted)]' }[s.status] ?? 'text-[var(--fg-muted)]'
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-center">서비스 기동</h2>
      <div className="flex flex-col gap-1.5">
        {SERVICE_NAMES.map((name) => (
          <div key={name} className="flex items-center justify-between rounded-md bg-[var(--surface-raised)] px-3 py-2">
            <span className="text-sm capitalize">{name}</span>
            <span className={`text-xs font-mono ${statusColor(name)}`}>{statusIcon(name)}</span>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="rounded-md bg-black/60 p-2 font-mono text-[10px] text-green-400 h-16 overflow-hidden">
        {logs.slice(-5).map((l, i) => <div key={i}>{l}</div>)}
      </div>
      {!starting && error && (
        <button onClick={() => { setError(null); void globalThis.launcherAPI!.startAllServices() }}
          className="rounded-lg border border-[var(--border)] py-2 text-sm text-[var(--fg-muted)]">
          재시도
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 6: StepComplete.tsx 작성**

```tsx
// src/renderer/src/components/wizard/StepComplete.tsx
interface Props { onComplete: () => void }

export default function StepComplete({ onComplete }: Readonly<Props>): JSX.Element {
  async function handleOpen(): Promise<void> {
    await globalThis.launcherAPI!.saveSetupConfig({
      claudeMode: 'cli',
      completedAt: new Date().toISOString(),
    }).catch(() => {})
    await globalThis.launcherAPI!.openOrchestrator()
    await globalThis.launcherAPI!.minimizeToTray()
    onComplete()
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="text-6xl">🎉</div>
      <h2 className="text-2xl font-bold">모든 준비가 완료되었습니다!</h2>
      <p className="text-sm text-[var(--fg-muted)] leading-relaxed">
        11개 서비스가 모두 실행 중입니다.<br />
        런처는 백그라운드에서 계속 실행됩니다.
      </p>
      <button
        onClick={() => void handleOpen()}
        className="rounded-xl bg-green-500 px-8 py-3 text-sm font-bold text-white hover:bg-green-600 transition-colors"
      >
        🎯 xzawed 열기
      </button>
      <p className="text-xs text-[var(--fg-muted)]">런처는 시스템 트레이에서 계속 실행됩니다</p>
    </div>
  )
}
```

- [ ] **Step 7: 커밋**

```bash
git add xzawedLauncher/packages/app/src/renderer/src/components/wizard/
git commit -m "feat(launcher): 마법사 5단계 UI 컴포넌트"
```

---

## Task 11: 대시보드 UI 컴포넌트

**Files:**
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/dashboard/Dashboard.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/dashboard/ActionBar.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/dashboard/ServiceRow.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/dashboard/LogStream.tsx`

- [ ] **Step 1: ActionBar.tsx 작성**

```tsx
// src/renderer/src/components/dashboard/ActionBar.tsx
interface Props {
  onOpen: () => void
  onStopAll: () => void
  onRestartAll: () => void
  onSettings: () => void
}

export default function ActionBar({ onOpen, onStopAll, onRestartAll, onSettings }: Readonly<Props>): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
      <button onClick={onOpen}
        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]">
        🎯 Orchestrator 열기
      </button>
      <button onClick={onStopAll}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]">
        ⏹ 전체 중지
      </button>
      <button onClick={onRestartAll}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]">
        ↺ 전체 재시작
      </button>
      <div className="ml-auto">
        <button onClick={onSettings}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]">
          ⚙️ 설정
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: ServiceRow.tsx 작성**

```tsx
// src/renderer/src/components/dashboard/ServiceRow.tsx
import type { ServiceState, ServiceStatus } from '@xzawed/launcher-shared'

interface Props { service: ServiceState; onRestart: () => void; onStop: () => void }

const STATUS_STYLE: Record<ServiceStatus, { dot: string; label: string; border: string }> = {
  running:    { dot: 'bg-green-400',  label: '실행 중',    border: 'border-green-500/40' },
  starting:   { dot: 'bg-yellow-400', label: '시작 중...', border: 'border-yellow-500/40' },
  restarting: { dot: 'bg-yellow-400', label: '재시작 중',  border: 'border-yellow-500/40' },
  error:      { dot: 'bg-red-400',    label: '오류',       border: 'border-red-500/40' },
  stopped:    { dot: 'bg-zinc-500',   label: '중지됨',     border: 'border-zinc-700' },
}

export default function ServiceRow({ service, onRestart, onStop }: Readonly<Props>): JSX.Element {
  const st = STATUS_STYLE[service.status]
  return (
    <div className={`flex items-center justify-between rounded-md border-l-2 ${st.border} bg-[var(--surface-raised)] px-3 py-1.5`}>
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${st.dot}`} />
        <span className="text-xs font-medium capitalize">{service.name}</span>
        {service.port && <span className="text-[10px] text-[var(--fg-muted)]">:{service.port}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--fg-muted)]">{st.label}</span>
        <button onClick={onRestart} className="text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)]" title="재시작">↺</button>
        <button onClick={onStop} className="text-[11px] text-[var(--fg-muted)] hover:text-red-400" title="중지">⏹</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: LogStream.tsx 작성**

```tsx
// src/renderer/src/components/dashboard/LogStream.tsx
import { useEffect, useRef } from 'react'

interface Props { logs: string[] }

export default function LogStream({ logs }: Readonly<Props>): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs])

  return (
    <div ref={ref}
      className="h-32 overflow-y-auto rounded-md bg-black/70 p-2 font-mono text-[10px] text-green-400 border border-[var(--border)]">
      {logs.length === 0
        ? <span className="text-[var(--fg-muted)]">로그 없음</span>
        : logs.map((l, i) => <div key={i} className="leading-relaxed whitespace-pre-wrap">{l}</div>)
      }
    </div>
  )
}
```

- [ ] **Step 4: Dashboard.tsx 작성**

```tsx
// src/renderer/src/components/dashboard/Dashboard.tsx
import { useState } from 'react'
import ActionBar from './ActionBar.js'
import ServiceRow from './ServiceRow.js'
import LogStream from './LogStream.js'
import SettingsModal from '../SettingsModal.js'
import { useServicesStore } from '../../stores/services.store.js'
import { SERVICE_NAMES } from '@xzawed/launcher-shared'

const INFRA = ['postgres', 'redis'] as const
const AGENTS = SERVICE_NAMES.filter((n) => !INFRA.includes(n as typeof INFRA[number]))

export default function Dashboard(): JSX.Element {
  const { services, logs } = useServicesStore()
  const [showSettings, setShowSettings] = useState(false)

  function getService(name: string) {
    return services.find((s) => s.name === name) ?? { name: name as any, status: 'stopped' as const }
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)]">
      <ActionBar
        onOpen={() => void globalThis.launcherAPI!.openOrchestrator()}
        onStopAll={() => void globalThis.launcherAPI!.stopAllServices()}
        onRestartAll={() => void globalThis.launcherAPI!.restartAllServices()}
        onSettings={() => setShowSettings(true)}
      />
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Infra */}
        <section>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">인프라</p>
          <div className="grid grid-cols-2 gap-2">
            {INFRA.map((name) => (
              <ServiceRow key={name} service={getService(name)}
                onRestart={() => void globalThis.launcherAPI!.restartService(name)}
                onStop={() => void globalThis.launcherAPI!.stopService(name)} />
            ))}
          </div>
        </section>
        {/* Agents */}
        <section>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">에이전트 서비스</p>
          <div className="flex flex-col gap-1.5">
            {AGENTS.map((name) => (
              <ServiceRow key={name} service={getService(name)}
                onRestart={() => void globalThis.launcherAPI!.restartService(name)}
                onStop={() => void globalThis.launcherAPI!.stopService(name)} />
            ))}
          </div>
        </section>
        {/* Logs */}
        <section>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--fg-muted)]">실시간 로그</p>
          <LogStream logs={logs} />
        </section>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
```

- [ ] **Step 5: 커밋**

```bash
git add xzawedLauncher/packages/app/src/renderer/src/components/dashboard/
git commit -m "feat(launcher): 대시보드 UI — ActionBar, ServiceRow, LogStream, Dashboard"
```

---

## Task 12: 모달 컴포넌트 (UpdateModal + SettingsModal)

**Files:**
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/UpdateModal.tsx`
- Create: `xzawedLauncher/packages/app/src/renderer/src/components/SettingsModal.tsx`

- [ ] **Step 1: UpdateModal.tsx 작성**

```tsx
// src/renderer/src/components/UpdateModal.tsx
interface Props {
  info: { version: string; releaseNotes: string }
  onClose: () => void
}

export default function UpdateModal({ info, onClose }: Readonly<Props>): JSX.Element {
  async function handleUpdate(): Promise<void> {
    await globalThis.launcherAPI!.installUpdate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-4 text-center text-3xl">🆕</div>
        <h3 className="mb-1 text-center text-base font-bold">새 버전 출시</h3>
        <p className="mb-4 text-center text-xs text-[var(--accent)]">v{info.version}</p>
        {info.releaseNotes && (
          <div className="mb-4 rounded-md bg-[var(--surface-raised)] p-3 text-[11px] text-[var(--fg-muted)] leading-relaxed max-h-28 overflow-y-auto">
            {info.releaseNotes}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 rounded-lg border border-[var(--border)] py-2 text-xs text-[var(--fg-muted)]">
            나중에
          </button>
          <button onClick={() => void handleUpdate()}
            className="flex-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]">
            지금 업데이트
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: SettingsModal.tsx 작성**

```tsx
// src/renderer/src/components/SettingsModal.tsx
import { useState, useEffect } from 'react'

interface Props { onClose: () => void }

export default function SettingsModal({ onClose }: Readonly<Props>): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void globalThis.launcherAPI!.tokenGet().then((k) => { if (k) setApiKey(k) })
  }, [])

  async function handleSave(): Promise<void> {
    if (apiKey) await globalThis.launcherAPI!.tokenSet(apiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-96 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">⚙️ 설정</h3>
          <button onClick={onClose} className="text-[var(--fg-muted)] hover:text-[var(--fg)]">✕</button>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--fg-muted)]">Anthropic API 키 (선택)</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-..."
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)] outline-none focus:border-[var(--accent)]" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-[var(--fg-muted)]">GitHub 토큰 (선택)</label>
            <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-muted)] outline-none focus:border-[var(--accent)]" />
          </div>
        </div>
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-[var(--border)] py-2 text-xs text-[var(--fg-muted)]">취소</button>
          <button onClick={() => void handleSave()} className="flex-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white">
            {saved ? '저장됨 ✓' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 커밋**

```bash
git add xzawedLauncher/packages/app/src/renderer/src/components/UpdateModal.tsx xzawedLauncher/packages/app/src/renderer/src/components/SettingsModal.tsx
git commit -m "feat(launcher): UpdateModal + SettingsModal"
```

---

## Task 13: Vitest 설정 + 렌더러 테스트

**Files:**
- Create: `xzawedLauncher/packages/app/vitest.config.ts`
- Create: `xzawedLauncher/packages/app/test/renderer/stores.test.ts`

- [ ] **Step 1: vitest.config.ts 작성**

```typescript
// packages/app/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/main/**/*.test.ts'],
    pool: 'forks',
  },
})
```

- [ ] **Step 2: 스토어 유닛 테스트 작성**

```typescript
// test/renderer/stores.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useServicesStore } from '../../src/renderer/src/stores/services.store.js'

describe('ServicesStore', () => {
  beforeEach(() => {
    useServicesStore.setState({ services: [], logs: [] })
  })

  it('appendLog adds line and caps at 200', () => {
    const { appendLog } = useServicesStore.getState()
    for (let i = 0; i < 210; i++) appendLog(`line ${i}`)
    expect(useServicesStore.getState().logs.length).toBe(200)
  })

  it('setServices updates services list', () => {
    useServicesStore.getState().setServices([{ name: 'redis', status: 'running' }])
    expect(useServicesStore.getState().services[0].status).toBe('running')
  })

  it('clearLogs empties log array', () => {
    useServicesStore.getState().appendLog('line')
    useServicesStore.getState().clearLogs()
    expect(useServicesStore.getState().logs).toHaveLength(0)
  })
})
```

- [ ] **Step 3: 전체 테스트 실행**

```bash
cd xzawedLauncher/packages/app
pnpm test
```

예상: 모든 테스트 PASS

- [ ] **Step 4: 커밋**

```bash
git add xzawedLauncher/packages/app/vitest.config.ts xzawedLauncher/packages/app/test/
git commit -m "feat(launcher): Vitest 설정 + store 유닛 테스트"
```

---

## Task 14: docker-compose.prod.yml

**Files:**
- Create: `xzawedPAIS/docker-compose.prod.yml`
- Create: `xzawedLauncher/packages/app/resources/docker-compose.prod.yml` (동일 내용 복사)

- [ ] **Step 1: docker-compose.prod.yml 작성 (리포 루트)**

```yaml
# docker-compose.prod.yml — GHCR 사전 빌드 이미지 기반 (비개발자 배포용)
name: xzawed-pais

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: xzawed
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-xzawed_secret}
      POSTGRES_DB: xzawed_orchestrator
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U xzawed"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  orchestrator:
    image: ghcr.io/xzawed/xzawed-orchestrator:latest
    ports: ["3000:3000"]
    environment:
      REDIS_URL: redis://redis:6379
      DATABASE_URL: postgresql://xzawed:${POSTGRES_PASSWORD:-xzawed_secret}@postgres:5432/xzawed_orchestrator
      PORT: "3000"
      MODE: local
      CLAUDE_MODE: ${CLAUDE_MODE:-cli}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
    depends_on:
      redis: { condition: service_healthy }
      postgres: { condition: service_healthy }
    restart: unless-stopped

  manager:
    image: ghcr.io/xzawed/xzawed-manager:latest
    ports: ["3001:3001"]
    environment:
      REDIS_URL: redis://redis:6379
      PORT: "3001"
      CLAUDE_MODEL: ${CLAUDE_MODEL:-claude-sonnet-4-6}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
    depends_on:
      redis: { condition: service_healthy }
    restart: unless-stopped

  planner:
    image: ghcr.io/xzawed/xzawed-planner:latest
    ports: ["3002:3002"]
    environment: { REDIS_URL: redis://redis:6379, PORT: "3002", ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}" }
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

  developer:
    image: ghcr.io/xzawed/xzawed-developer:latest
    ports: ["3003:3003"]
    environment: { REDIS_URL: redis://redis:6379, PORT: "3003", ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}" }
    volumes: [workspace:/workspace]
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

  designer:
    image: ghcr.io/xzawed/xzawed-designer:latest
    ports: ["3004:3004"]
    environment: { REDIS_URL: redis://redis:6379, PORT: "3004", ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}" }
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

  tester:
    image: ghcr.io/xzawed/xzawed-tester:latest
    ports: ["3005:3005"]
    environment: { REDIS_URL: redis://redis:6379, PORT: "3005", ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}" }
    volumes: [workspace:/workspace]
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

  builder:
    image: ghcr.io/xzawed/xzawed-builder:latest
    ports: ["3006:3006"]
    environment: { REDIS_URL: redis://redis:6379, PORT: "3006", ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}" }
    volumes: [workspace:/workspace]
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

  watcher:
    image: ghcr.io/xzawed/xzawed-watcher:latest
    ports: ["3007:3007"]
    environment: { REDIS_URL: redis://redis:6379, PORT: "3007" }
    volumes: [workspace:/workspace]
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

  security:
    image: ghcr.io/xzawed/xzawed-security:latest
    ports: ["3008:3008"]
    environment: { REDIS_URL: redis://redis:6379, PORT: "3008", ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}" }
    volumes: [workspace:/workspace:ro]
    depends_on: { redis: { condition: service_healthy } }
    restart: unless-stopped

volumes:
  redis-data:
  postgres-data:
  workspace:
```

- [ ] **Step 2: resources 디렉터리에 복사**

```bash
cp xzawedPAIS/docker-compose.prod.yml xzawedLauncher/packages/app/resources/docker-compose.prod.yml
```

- [ ] **Step 3: 커밋**

```bash
git add docker-compose.prod.yml xzawedLauncher/packages/app/resources/
git commit -m "feat(launcher): docker-compose.prod.yml — GHCR 이미지 기반 프로덕션 compose"
```

---

## Task 15: GitHub Actions CI — Docker 이미지 배포

**Files:**
- Create: `.github/workflows/docker-publish.yml`

- [ ] **Step 1: docker-publish.yml 작성**

```yaml
# .github/workflows/docker-publish.yml
name: Docker Publish

on:
  push:
    branches: [master]
    paths:
      - 'xzawed*/src/**'
      - 'xzawed*/Dockerfile'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        service:
          - { name: orchestrator, context: xzawedOrchestrator }
          - { name: manager,      context: xzawedManager }
          - { name: planner,      context: xzawedPlanner }
          - { name: developer,    context: xzawedDeveloper }
          - { name: designer,     context: xzawedDesigner }
          - { name: tester,       context: xzawedTester }
          - { name: builder,      context: xzawedBuilder }
          - { name: watcher,      context: xzawedWatcher }
          - { name: security,     context: xzawedSecurity }

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push ${{ matrix.service.name }}
        uses: docker/build-push-action@v5
        with:
          context: ${{ matrix.service.context }}
          push: true
          tags: |
            ghcr.io/xzawed/xzawed-${{ matrix.service.name }}:latest
            ghcr.io/xzawed/xzawed-${{ matrix.service.name }}:${{ github.sha }}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/docker-publish.yml
git commit -m "feat(ci): Docker 이미지 GHCR 자동 배포 워크플로우"
```

---

## Task 16: GitHub Actions CI — 런처 릴리스 빌드

**Files:**
- Create: `.github/workflows/launcher-release.yml`

- [ ] **Step 1: launcher-release.yml 작성**

```yaml
# .github/workflows/launcher-release.yml
name: Launcher Release

on:
  push:
    tags: ['launcher-v*']

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - name: Install dependencies
        working-directory: xzawedLauncher
        run: pnpm install --frozen-lockfile
      - name: Build shared
        working-directory: xzawedLauncher/packages/shared
        run: pnpm build
      - name: Package app
        working-directory: xzawedLauncher/packages/app
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm package
      - uses: actions/upload-artifact@v4
        with:
          name: launcher-windows
          path: xzawedLauncher/packages/app/dist/*.exe

  build-macos:
    runs-on: macos-13
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - name: Install dependencies
        working-directory: xzawedLauncher
        run: pnpm install --frozen-lockfile
      - name: Build shared
        working-directory: xzawedLauncher/packages/shared
        run: pnpm build
      - name: Package app
        working-directory: xzawedLauncher/packages/app
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm package
      - uses: actions/upload-artifact@v4
        with:
          name: launcher-macos
          path: xzawedLauncher/packages/app/dist/*.dmg

  build-linux:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - name: Install dependencies
        working-directory: xzawedLauncher
        run: pnpm install --frozen-lockfile
      - name: Build shared
        working-directory: xzawedLauncher/packages/shared
        run: pnpm build
      - name: Package app
        working-directory: xzawedLauncher/packages/app
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm package
      - uses: actions/upload-artifact@v4
        with:
          name: launcher-linux
          path: xzawedLauncher/packages/app/dist/*.AppImage

  release:
    needs: [build-windows, build-macos, build-linux]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with: { path: artifacts }
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
```

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/launcher-release.yml
git commit -m "feat(ci): 런처 앱 크로스플랫폼 릴리스 빌드 워크플로우"
```

---

## Task 17: CLAUDE.md 작성

**Files:**
- Create: `xzawedLauncher/CLAUDE.md`

- [ ] **Step 1: CLAUDE.md 작성**

```markdown
# CLAUDE.md — xzawedLauncher

비개발자 대상 xzawedPAIS 설치·실행 런처 앱.

## 핵심 명령어

```bash
# 의존성 설치
cd xzawedLauncher && pnpm install

# shared 타입 빌드 (앱 실행 전 필수)
cd packages/shared && pnpm build && cd ..

# 개발 모드 실행
pnpm dev

# 테스트
pnpm test

# 빌드 + 패키징 (설치 파일 생성)
pnpm package
```

## 아키텍처

`packages/shared/` — 공유 TypeScript 타입 (ServiceState, WizardStep 등)  
`packages/app/src/main/` — Electron 메인 프로세스 (Docker/Claude 감지, 서비스 제어)  
`packages/app/src/preload/` — contextBridge IPC 계약  
`packages/app/src/renderer/` — React 19 UI (마법사 + 대시보드)

## 첫 실행 vs 이후 실행

- 첫 실행: `userData/setup-complete.json` 없음 → 마법사 5단계
- 이후 실행: 파일 있음 → 대시보드 직행 → 트레이 최소화

## Claude 인증 우선순위

1. `claude whoami` 성공 → CLI 모드 (구독 사용)
2. CLI 미로그인 → 브라우저 로그인 안내
3. CLI 미설치 → npm 자동 설치
4. 폴백 → Anthropic API 키 입력 (선택)

## 보안

- API 키: `electron.safeStorage`로 OS 키체인 암호화
- docker compose 경로: `process.resourcesPath` 내 고정 경로만 허용
- IPC: contextBridge 최소 노출
```

- [ ] **Step 2: 커밋**

```bash
git add xzawedLauncher/CLAUDE.md
git commit -m "docs(launcher): CLAUDE.md 작성"
```

---

## Task 18: 빌드 검증 + .gitignore 업데이트

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: .gitignore에 launcher 관련 항목 추가**

`.gitignore` 파일에 다음 항목이 없으면 추가:
```
# xzawedLauncher
xzawedLauncher/packages/app/out/
xzawedLauncher/packages/app/dist/
xzawedLauncher/packages/shared/dist/

# Visual brainstorm sessions
.superpowers/
```

- [ ] **Step 2: shared 빌드 후 앱 빌드 확인**

```bash
cd xzawedLauncher
pnpm --filter @xzawed/launcher-shared build
pnpm --filter @xzawed/launcher-app build
```

예상: TypeScript 오류 없이 `out/` 디렉터리 생성

- [ ] **Step 3: 전체 테스트 최종 실행**

```bash
pnpm test
```

예상: 전체 테스트 PASS

- [ ] **Step 4: 최종 커밋**

```bash
git add .gitignore
git commit -m "chore(launcher): .gitignore 업데이트 — out/dist/.superpowers 제외"
```

---

## 구현 완료 체크리스트

- [ ] Task 1: 프로젝트 스캐폴딩
- [ ] Task 2: 공유 타입
- [ ] Task 3: Preload IPC 계약
- [ ] Task 4: SetupStore (TDD)
- [ ] Task 5: DockerManager (TDD)
- [ ] Task 6: ClaudeDetector (TDD)
- [ ] Task 7: ServiceMonitor + TrayManager + Updater
- [ ] Task 8: Main Process 진입점
- [ ] Task 9: Renderer 기반 (App, stores, CSS)
- [ ] Task 10: 마법사 5단계 UI
- [ ] Task 11: 대시보드 UI
- [ ] Task 12: UpdateModal + SettingsModal
- [ ] Task 13: Vitest 설정 + 테스트
- [ ] Task 14: docker-compose.prod.yml
- [ ] Task 15: Docker 이미지 배포 CI
- [ ] Task 16: 런처 릴리스 CI
- [ ] Task 17: CLAUDE.md
- [ ] Task 18: 빌드 검증
