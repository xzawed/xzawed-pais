import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { requestProjectReply } from './project-rpc.js'

interface SwitchInput {
  projectId?: string
  name?: string
}

const SwitchOutputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  workspacePath: z.string().nullable(),
})

type SwitchOutput = z.infer<typeof SwitchOutputSchema>

export function createSwitchProjectHandler(redisUrl: string): ToolHandler<SwitchInput, SwitchOutput> {
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

      return requestProjectReply({
        redisUrl,
        sessionId,
        requestType: 'switch_project_request',
        responseType: 'switch_project_response',
        payload: input,
        label: 'switch_project',
        parseOutput: (payload) => {
          const parsed = SwitchOutputSchema.safeParse(payload)
          if (!parsed.success) throw new Error('switch_project: invalid response payload')
          return parsed.data
        },
      })
    },
  }
}
