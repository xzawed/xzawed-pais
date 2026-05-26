import { z } from 'zod'
import { getRedisClient } from '../streams/redis.client.js'
import type { ToolHandler } from './handler.interface.js'

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

const ProjectResponseSchema = z.object({
  type: z.string(),
  sessionId: z.string(),
  payload: z.unknown(),
})

const TIMEOUT_MS = 30_000
const REQUEST_STREAM = 'manager:to-orchestrator:projects'

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

      const redis = getRedisClient(redisUrl)
      const responseStream = `orchestrator:to-manager:projects:${sessionId}`

      const tip = await redis.xrevrange(responseStream, '+', '-', 'COUNT', '1') as [string, string[]][]
      let lastId = tip[0]?.[0] ?? '0-0'

      await redis.xadd(REQUEST_STREAM, '*', 'data', JSON.stringify({
        type: 'switch_project_request',
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: input,
      }))

      const deadline = Date.now() + TIMEOUT_MS
      while (Date.now() < deadline) {
        const blockMs = Math.min(deadline - Date.now(), 5_000)
        if (blockMs <= 0) break

        const results = await redis.xread(
          'COUNT', '5', 'BLOCK', String(blockMs),
          'STREAMS', responseStream, lastId,
        ) as [string, [string, string[]][]][] | null

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
            if (msg.type === 'switch_project_response') {
              const outputParse = SwitchOutputSchema.safeParse(msg.payload)
              if (!outputParse.success) throw new Error(`switch_project: invalid response payload`)
              return outputParse.data
            }
            if (msg.type === 'project_error' && msg.sessionId === sessionId) {
              const err = (msg.payload as { error?: string }).error ?? 'unknown error'
              throw new Error(`switch_project failed: ${err}`)
            }
          }
        }
      }

      throw new Error('switch_project timed out after 30s')
    },
  }
}
