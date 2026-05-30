const SERVICES = [
  { name: 'xzawedOrchestrator', port: 3000 },
  { name: 'xzawedManager',      port: 3001 },
  { name: 'xzawedPlanner',      port: 3002 },
  { name: 'xzawedDeveloper',    port: 3003 },
  { name: 'xzawedDesigner',     port: 3004 },
  { name: 'xzawedTester',       port: 3005 },
  { name: 'xzawedBuilder',      port: 3006 },
  { name: 'xzawedWatcher',      port: 3007 },
  { name: 'xzawedSecurity',     port: 3008 },
]

export interface ServiceStatus {
  name: string
  port: number
  healthy: boolean
  responseMs: number
  error?: string
}

export async function checkAllServices(): Promise<ServiceStatus[]> {
  return Promise.all(
    SERVICES.map(async ({ name, port }) => {
      const start = Date.now()
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(3000),
        })
        return { name, port, healthy: res.ok, responseMs: Date.now() - start }
      } catch (err) {
        return {
          name, port, healthy: false,
          responseMs: Date.now() - start,
          error: String(err),
        }
      }
    })
  )
}

export function assertAllHealthy(statuses: ServiceStatus[]): void {
  const unhealthy = statuses.filter(s => !s.healthy)
  if (unhealthy.length > 0) {
    const list = unhealthy.map(s => `  - ${s.name} (port ${s.port}): ${s.error ?? 'not OK'}`).join('\n')
    throw new Error(
      `\n다음 서비스가 실행되지 않았습니다:\n${list}\n\n` +
      `각 서비스를 먼저 기동하세요:\n  cd xzawedOrchestrator/packages/server && pnpm dev\n` +
      `  cd xzawedManager/packages/server && pnpm dev  (... 등)\n`
    )
  }
}
