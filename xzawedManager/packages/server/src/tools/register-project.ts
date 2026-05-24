import type { ToolHandler } from './handler.interface.js'

interface RegisterInput {
  name: string
  workspaceType: 'local' | 'github'
  localPath?: string
  repoUrl?: string
  branch?: string
  description?: string
}

interface RegisterOutput {
  projectId: string
  workspacePath: string | null
  status: 'registered' | 'cloning'
}

export function createRegisterProjectHandler(
  orchestratorUrl: string,
  serviceToken: string,
): ToolHandler<RegisterInput, RegisterOutput> {
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
      const url = new URL(`/api/internal/sessions/${sessionId}/register-project`, orchestratorUrl)
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
        throw new Error(`register_project failed (${res.status}): ${body}`)
      }
      return res.json() as Promise<RegisterOutput>
    },
  }
}
