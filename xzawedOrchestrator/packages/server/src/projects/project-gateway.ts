import { z } from 'zod'
import { getRedisClient } from '../streams/redis.client.js'

const REQUEST_STREAM = 'manager:to-orchestrator:projects'
const GROUP = 'orchestrator-project-gateway'

const ProjectRequestSchema = z.object({
  type: z.string(),
  sessionId: z.string().uuid(),
  messageId: z.string(),
  timestamp: z.number(),
  payload: z.unknown(),
})

interface RegisterPayload {
  name: string
  workspaceType: 'local' | 'github'
  localPath?: string
  repoUrl?: string
  branch?: string
  description?: string
}

interface SwitchPayload {
  projectId?: string
  name?: string
}

export type RegisterHandler = (
  sessionId: string,
  payload: RegisterPayload,
) => Promise<{ projectId: string; workspacePath: string | null; status: 'registered' | 'cloning' }>

export type SwitchHandler = (
  sessionId: string,
  payload: SwitchPayload,
) => Promise<{ projectId: string; name: string; workspacePath: string | null }>

export class ProjectGatewayConsumer {
  private running = false

  constructor(
    private readonly redisUrl: string,
    private readonly onRegister: RegisterHandler,
    private readonly onSwitch: SwitchHandler,
  ) {}

  async start(): Promise<void> {
    const redis = getRedisClient(this.redisUrl)
    try {
      await redis.xgroup('CREATE', REQUEST_STREAM, GROUP, '$', 'MKSTREAM')
    } catch (e: unknown) {
      if (!(e instanceof Error && e.message.includes('BUSYGROUP'))) throw e
    }

    this.running = true
    const consumerId = `orchestrator-project-gw-${process.pid}`

    while (this.running) {
      try {
        const results = await redis.xreadgroup(
          'GROUP', GROUP, consumerId,
          'COUNT', '10', 'BLOCK', '2000',
          'STREAMS', REQUEST_STREAM, '>',
        ) as [string, [string, string[]][]][] | null

        if (!results) continue

        for (const [, entries] of results) {
          for (const [msgId, fields] of entries) {
            try {
              await this.handleEntry(redis, fields)
            } catch (err) {
              console.error('[ProjectGateway] Error processing entry:', err)
            } finally {
              await redis.xack(REQUEST_STREAM, GROUP, msgId)
            }
          }
        }
      } catch (err: unknown) {
        if (!this.running) break
        console.error('[ProjectGateway] xreadgroup error, retrying in 1s:', err)
        await new Promise(r => setTimeout(r, 1_000))
      }
    }
  }

  private async handleEntry(redis: ReturnType<typeof getRedisClient>, fields: string[]): Promise<void> {
    const dataIdx = fields.indexOf('data')
    if (dataIdx === -1) return
    const raw = fields[dataIdx + 1]
    if (raw === undefined) return

    let msg: z.infer<typeof ProjectRequestSchema>
    try {
      const parseResult = ProjectRequestSchema.safeParse(JSON.parse(raw))
      if (!parseResult.success) {
        console.error('[ProjectGateway] invalid message schema:', parseResult.error.issues)
        return
      }
      msg = parseResult.data
    } catch {
      console.error('[ProjectGateway] JSON parse error, skipping')
      return
    }

    const responseStream = `orchestrator:to-manager:projects:${msg.sessionId}`

    try {
      let result: unknown
      if (msg.type === 'register_project_request') {
        result = await this.onRegister(msg.sessionId, msg.payload as RegisterPayload)
        await redis.xadd(responseStream, '*', 'data', JSON.stringify({
          type: 'register_project_response',
          sessionId: msg.sessionId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          payload: result,
        }))
      } else if (msg.type === 'switch_project_request') {
        result = await this.onSwitch(msg.sessionId, msg.payload as SwitchPayload)
        await redis.xadd(responseStream, '*', 'data', JSON.stringify({
          type: 'switch_project_response',
          sessionId: msg.sessionId,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          payload: result,
        }))
      } else {
        console.warn('[ProjectGateway] unrecognized message type:', msg.type)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await redis.xadd(responseStream, '*', 'data', JSON.stringify({
        type: 'project_error',
        sessionId: msg.sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        payload: { error: message, requestType: msg.type },
      }))
    }
  }

  stop(): void {
    this.running = false
  }
}
