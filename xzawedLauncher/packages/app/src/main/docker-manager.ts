import { spawn } from 'node:child_process'
import path from 'node:path'
import { app, shell } from 'electron'
import type { DockerInstallStatus, ServiceName, ServiceState, ServiceStatus } from '@xzawed/launcher-shared'
import { SERVICE_NAMES } from '@xzawed/launcher-shared'
import { spawnAsync } from './spawn-async.js'

const COMPOSE_FILE = path.join(process.resourcesPath ?? app.getAppPath(), 'docker-compose.prod.yml')


export async function checkDocker(): Promise<DockerInstallStatus> {
  try {
    const out = await spawnAsync('docker', ['info'])
    return out.includes('Server') ? 'running' : 'installed-stopped'
  } catch {
    try {
      await spawnAsync('docker', ['--version'])
      return 'installed-stopped'
    } catch {
      return 'not-installed'
    }
  }
}

export async function startDockerDesktop(): Promise<void> {
  const programFiles = process.env['PROGRAMFILES'] ?? 'C:\\Program Files'
  const dockerDesktopExe = path.join(programFiles, 'Docker', 'Docker', 'Docker Desktop.exe')
  const cmds: Record<string, [string, string[]]> = {
    win32: ['cmd', ['/c', 'start', '', dockerDesktopExe]],
    darwin: ['open', ['-a', 'Docker']],
    linux: ['systemctl', ['--user', 'start', 'docker-desktop']],
  }
  const [bin, args] = cmds[process.platform] ?? cmds.linux
  await spawnAsync(bin, args).catch((e: unknown) => { console.warn('[docker] startDockerDesktop failed:', e) })
}

export async function installDocker(): Promise<void> {
  const urls: Record<string, string> = {
    win32: 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
    darwin: 'https://desktop.docker.com/mac/main/arm64/Docker.dmg',
    linux: 'https://docs.docker.com/engine/install/',
  }
  await shell.openExternal(urls[process.platform] ?? urls.linux) // NOSONAR
}

export async function startAllServices(
  onLog: (line: string) => void,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d'], {
      shell: false,
      env: { ...process.env, ...extraEnv },
    })
    proc.stdout.on('data', (d: Buffer) => onLog(d.toString()))
    proc.stderr.on('data', (d: Buffer) => onLog(d.toString()))
    proc.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
    proc.on('error', reject)
  })
}

export async function stopAllServices(): Promise<void> {
  await spawnAsync('docker', ['compose', '-f', COMPOSE_FILE, 'down'])
}

export async function restartAllServices(
  onLog: (line: string) => void,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  await stopAllServices()
  await startAllServices(onLog, extraEnv)
}

export function validateServiceName(name: string): ServiceName {
  for (const safe of SERVICE_NAMES) {
    if (safe === name) return safe
  }
  throw new Error(`Invalid service name: ${name}`)
}

export async function restartService(name: string): Promise<void> {
  const safe = validateServiceName(name)
  await spawnAsync('docker', ['compose', '-f', COMPOSE_FILE, 'restart', safe])
}

export async function stopService(name: string): Promise<void> {
  const safe = validateServiceName(name)
  await spawnAsync('docker', ['compose', '-f', COMPOSE_FILE, 'stop', safe])
}

export async function getServiceStatuses(): Promise<ServiceState[]> {
  const PORT_MAP: Partial<Record<ServiceName, number>> = {
    orchestrator: 3000, manager: 3001, planner: 3002,
    developer: 3003, designer: 3004, tester: 3005,
    builder: 3006, watcher: 3007, security: 3008,
  }
  try {
    const out = await spawnAsync('docker', ['compose', '-f', COMPOSE_FILE, 'ps', '--format', 'json'])
    const rows = out.trim().split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l) as Record<string, unknown>] } catch { return [] }
    })
    return rows.map((r) => {
      // **`Name` 이 아니라 `Service` 를 읽는다.** `Name` 은 컨테이너 이름
      // `<project>-<service>-<index>` 이고 project 는 compose 파일이 있는 **디렉토리**에서
      // 온다 — 패키징된 앱에서는 `resources`, 저장소에서는 `xzawedpais` 다. 옛 코드는
      // `^xzawed[_-]` 로 접두사를 벗기려 했는데 그 정규식은 `xzawed` 뒤에 `_`·`-` 를
      // 요구하므로 **어느 경우에도 매치되지 않는다**.
      //
      // 실측(11개 컨테이너가 전부 healthy 인 스택):
      //   Name="pais-verify-builder-1" → 옛 코드 "pais-verify-builder" · 실제 "builder"
      // 서비스 이름이 어긋나면 모든 카드가 `stopped` 으로 남고, 마법사의 완료 조건
      // `states.every(s => s.status === 'running')` 이 **영영 참이 되지 않는다.**
      // `docker compose ps --format json` 은 `Service` 를 그대로 준다.
      const name = String(r['Service'] ?? '') as ServiceName
      let status: ServiceStatus = 'stopped'
      if (r['State'] === 'running' && r['Health'] === 'healthy') status = 'running'
      else if (r['State'] === 'running') status = 'starting'
      else if (r['State'] === 'restarting') status = 'restarting'
      else if (r.State === 'exited') status = 'error'
      return { name, status, port: PORT_MAP[name] }
    })
  } catch {
    return []
  }
}
