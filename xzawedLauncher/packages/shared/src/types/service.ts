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
