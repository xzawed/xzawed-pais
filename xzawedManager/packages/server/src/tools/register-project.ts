import { z } from 'zod'
import { RedisEventBus } from '@xzawed/agent-streams'
import { getRedisClient } from '../streams/redis.client.js'
import type { ToolHandler } from './handler.interface.js'

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

const ProjectResponseSchema = z.object({
  type: z.string(),
  sessionId: z.string(),
  payload: z.unknown(),
})

const TIMEOUT_MS = 30_000
const REQUEST_STREAM = 'manager:to-orchestrator:projects'

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

      const bus = new RedisEventBus(getRedisClient(redisUrl))
      const responseStream = `orchestrator:to-manager:projects:${sessionId}`

      // Capture stream tip before publishing to avoid missing responses
      let lastId = await bus.streamTip(responseStream)

      await bus.publish(REQUEST_STREAM, {
        type: 'register_project_request',
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: input,
      })

      const deadline = Date.now() + TIMEOUT_MS
      while (Date.now() < deadline) {
        const blockMs = Math.min(deadline - Date.now(), 5_000)
        if (blockMs <= 0) break

        const results = await bus.readFrom(responseStream, lastId, { count: 5, blockMs })

        if (!results) continue

        for (const [, messages] of results) {
          for (const [msgId, fields] of messages) {
            lastId = msgId
            const dataIdx = fields.indexOf('data')
            if (dataIdx === -1) continue
            const raw = fields[dataIdx + 1]
            if (!raw) continue

            let parseResult
            try {
              parseResult = ProjectResponseSchema.safeParse(JSON.parse(raw))
            } catch {
              continue  // malformed JSON, skip
            }
            if (!parseResult.success) continue

            const msg = parseResult.data
            if (msg.type === 'register_project_response') {
              const outputParse = RegisterOutputSchema.safeParse(msg.payload)
              if (!outputParse.success) throw new Error(`register_project: invalid response payload`)
              return outputParse.data
            }
            if (msg.type === 'project_error' && msg.sessionId === sessionId) {
              const err = (msg.payload as { error?: string }).error ?? 'unknown error'
              throw new Error(`register_project failed: ${err}`)
            }
          }
        }
      }

      throw new Error('register_project timed out after 30s')
    },
  }
}
