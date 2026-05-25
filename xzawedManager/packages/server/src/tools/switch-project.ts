import type { ToolHandler } from './handler.interface.js'

interface SwitchInput {
  projectId?: string
  name?: string
}

interface SwitchOutput {
  projectId: string
  name: string
  workspacePath: string | null
}

export function createSwitchProjectHandler(
  orchestratorUrl: string,
  serviceToken: string,
): ToolHandler<SwitchInput, SwitchOutput> {
  return {
    name: 'switch_project',
    description: '이름 또는 ID로 현재 세션의 활성 프로젝트를 전환합니다',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: '프로젝트 ID (우선)' },
        name: { type: 'string', description: '프로젝트 이름 또는 slug' },
      },
    },
    async execute(input, sessionId): Promise<SwitchOutput> {
      if (!input.projectId && !input.name) {
        throw new Error('switch_project: projectId 또는 name 중 하나는 필수입니다')
      }
      const url = new URL(`/internal/sessions/${sessionId}/switch-project`, orchestratorUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Invalid orchestrator URL protocol')
      }
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`switch_project failed (${res.status}): ${body}`)
      }
      return res.json() as Promise<SwitchOutput>
    },
  }
}
