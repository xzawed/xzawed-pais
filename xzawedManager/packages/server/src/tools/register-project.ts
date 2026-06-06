import { z } from 'zod'
import type { ToolHandler } from './handler.interface.js'
import { requestProjectReply } from './project-rpc.js'

interface RegisterInput {
  name: string
  workspaceType: 'local' | 'github'
  localPath?: string
  repoUrl?: string
  branch?: string
  description?: string
}

const RegisterOutputSchema = z.object({
  projectId: z.string(),
  workspacePath: z.string().nullable(),
  status: z.enum(['registered', 'cloning']),
})

type RegisterOutput = z.infer<typeof RegisterOutputSchema>

export function createRegisterProjectHandler(redisUrl: string): ToolHandler<RegisterInput, RegisterOutput> {
  return {
    name: 'register_project',
    description: '외부 서비스(로컬 디렉토리 또는 GitHub 리포)를 프로젝트로 등록하고 현재 세션에 연결합니다',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: '프로젝트 이름' },
        workspaceType: { type: 'string', enum: ['local', 'github'], description: '워크스페이스 유형' },
        localPath: { type: 'string', description: '로컬 경로 (workspaceType=local 시 필수)' },
        repoUrl: { type: 'string', description: 'GitHub URL (workspaceType=github 시 필수)' },
        branch: { type: 'string', description: 'Git 브랜치 (기본값: main)' },
        description: { type: 'string', description: '프로젝트 설명' },
      },
      required: ['name', 'workspaceType'],
    },
    async execute(input, sessionId): Promise<RegisterOutput> {
      if (input.workspaceType === 'local' && !input.localPath) {
        throw new Error('register_project: workspaceType=local 시 localPath는 필수입니다')
      }

      return requestProjectReply({
        redisUrl,
        sessionId,
        requestType: 'register_project_request',
        responseType: 'register_project_response',
        payload: input,
        label: 'register_project',
        parseOutput: (payload) => {
          const parsed = RegisterOutputSchema.safeParse(payload)
          if (!parsed.success) throw new Error('register_project: invalid response payload')
          return parsed.data
        },
      })
    },
  }
}
