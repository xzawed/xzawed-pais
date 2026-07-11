import { z } from 'zod'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { StreamConsumer } from '../streams/consumer.js'
import type { StreamProducer } from '../streams/producer.js'
import type { ClaudeRunner, RunnerOptions } from '../claude/runner.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { OrchestratorToManagerMessage } from '../types/streams.js'
import { ensureWorkspace } from '../workspace.js'
import type { WatcherEventConsumer } from '../streams/watcher-event-consumer.js'
import { handleDecomposeRequest } from '../decompose/trigger.js'
import type { ProduceDeps } from '../decompose/producer.js'
import type { RiskClassifyDeps } from '../decompose/risk-producer.js'

type RouteHook = (req: FastifyRequest, reply: FastifyReply) => Promise<void>

export interface SessionsRouteOptions {
  redisUrl: string
  runner: ClaudeRunner
  producer: StreamProducer
  sessionStore: SessionStore
  registry?: ToolRegistry
  activeConsumers?: Map<string, StreamConsumer>
  authHook?: RouteHook
  watcherEventConsumer?: WatcherEventConsumer
  /** P2-2: 주입되면(flag on) decompose_request를 단일 LLM 분해→발행으로 처리. 미주입이면 분기 무시. */
  decompose?: ProduceDeps
  /** P2r-3: 주입되면(flag on) decompose 완료 후 리스크 분류를 생산한다. 미주입이면 분기 무시. */
  riskClassify?: RiskClassifyDeps
  /** C7: 주입되면(MANAGER_DECISION_ROUTING) decompose escalation을 decompose_inconsistent DecisionRequest로도 발행. */
  decisionStore?: { createRequest(input: import('../streams/decision-brief.js').DecisionRequestInput): Promise<unknown> }
}

export function makeSessionStarter(
  opts: Pick<SessionsRouteOptions, 'redisUrl' | 'runner' | 'producer' | 'sessionStore'> & {
    activeConsumers: Map<string, StreamConsumer>
    registry?: ToolRegistry
    watcherEventConsumer?: WatcherEventConsumer
    decompose?: ProduceDeps
    riskClassify?: RiskClassifyDeps
    decisionStore?: SessionsRouteOptions['decisionStore']
    log: { error: (obj: unknown, msg: string) => void }
  },
) {
  return async function startManagedSession(sessionId: string): Promise<void> {
    if (opts.activeConsumers.has(sessionId)) return

    await opts.sessionStore.create(sessionId)
    opts.watcherEventConsumer?.watchSession(sessionId)
    const consumer = new StreamConsumer(opts.redisUrl)
    opts.activeConsumers.set(sessionId, consumer)

    // 세션 종료 정리(누수 방지) — 정상 완료·decompose 완료·M8 에러 분기 공통.
    const cleanupSession = async (): Promise<void> => {
      opts.watcherEventConsumer?.unwatchSession(sessionId)
      consumer.stop()
      await opts.sessionStore.delete(sessionId)
      opts.activeConsumers.delete(sessionId)
      opts.registry?.releaseAll(sessionId)
    }
    // 요청자에게 error 메시지 발행(무음 drop 금지·M8).
    const publishError = async (content: string): Promise<void> => {
      await opts.producer.publish({
        sessionId,
        messageId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'error',
        payload: { agentId: 'manager', content },
      })
    }

    void consumer.start(sessionId, async (msg: OrchestratorToManagerMessage) => {
      if (msg.type === 'task_request') {
        void (async () => {
          try {
            const { userContext } = msg.payload
            if (userContext !== undefined) {
              await ensureWorkspace(userContext)
            }
            const sig = opts.sessionStore.getAbortSignal(sessionId)
            const result = await opts.runner.run({
              sessionId,
              intent: msg.payload.intent,
              context: msg.payload.context,
              producer: opts.producer,
              sessionStore: opts.sessionStore,
              ...(sig !== undefined && { signal: sig }),
              ...(userContext !== undefined && { userContext }),
              ...(msg.payload.gateMode !== undefined && { gateMode: msg.payload.gateMode }),
            } satisfies RunnerOptions)

            await opts.producer.publish({
              sessionId,
              messageId: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'task_complete',
              payload: { agentId: 'manager', content: result },
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            // Do NOT publish an error for intentional aborts
            if (message === 'Session aborted') return
            await publishError(message)
          } finally {
            await cleanupSession()
          }
        })().catch((err: unknown) => {
          opts.log.error({ err, sessionId }, 'Unexpected task runner error')
        })
      } else if (msg.type === 'info_response') {
        await opts.sessionStore.resolveInfo(sessionId, msg.payload.answer)
      } else if (msg.type === 'decompose_request') {
        if (!opts.decompose) {
          // M8(무음 통과 금지): decompose 비활성(MANAGER_DECOMPOSE_ENABLED off)인데 요청이 도착했다.
          // 무음 drop하면 요청자가 응답 없이 무한 대기하고 세션 consumer가 누수된다 — 명시 에러 + 정리.
          opts.log.error({ sessionId }, 'decompose_request received but decomposition is disabled')
          await publishError('decompose_request를 받았으나 분해 기능이 비활성화되어 있습니다(MANAGER_DECOMPOSE_ENABLED off).')
          await cleanupSession()
          return
        }
        void handleDecomposeRequest(
          sessionId,
          msg.payload.intent,
          opts.decompose,
          opts.producer,
          cleanupSession,
          msg.payload.userContext, // P4a-2: 워크스페이스 컨텍스트 — 그래프 영속→실행 워커 주입
          opts.riskClassify, // P2r-3
          opts.decisionStore, // C7 arm2
        ).catch((err: unknown) => {
          opts.log.error({ err, sessionId }, 'decompose_request handler error')
        })
      } else if (msg.type === 'abort') {
        opts.watcherEventConsumer?.unwatchSession(sessionId)
        await opts.sessionStore.abort(sessionId)
        consumer.stop()
        opts.activeConsumers.delete(sessionId)
        await opts.sessionStore.delete(sessionId)
        opts.registry?.releaseAll(sessionId)
      } else {
        // M8(무음 통과 금지·방어): 스키마는 통과했으나 처리 분기가 없는 타입. 닫힌 union이라 정상 경로엔
        // 미도달하지만, 향후 union 확장 시 무음 drop·세션 누수를 막는다(에러 발행 + 정리).
        const unknownType = (msg as unknown as { type?: unknown }).type
        opts.log.error({ sessionId, type: unknownType }, 'Unhandled message type — publishing error')
        await publishError(`Unsupported message type: ${String(unknownType)}`)
        await cleanupSession()
      }
    }).catch(async (err: unknown) => {
      opts.log.error({ err, sessionId }, 'StreamConsumer error')
      opts.watcherEventConsumer?.unwatchSession(sessionId)
      await opts.sessionStore.delete(sessionId)
      opts.activeConsumers.delete(sessionId)
    })
  }
}

export async function sessionsRoute(
  app: FastifyInstance,
  opts: SessionsRouteOptions,
): Promise<void> {
  const { redisUrl, runner, producer, sessionStore, registry } = opts
  const activeConsumers = opts.activeConsumers ?? new Map<string, StreamConsumer>()
  const preHandler = opts.authHook ? [opts.authHook] : []

  const startManagedSession = makeSessionStarter({
    redisUrl, runner, producer, sessionStore, activeConsumers,
    ...(registry !== undefined && { registry }),
    ...(opts.watcherEventConsumer !== undefined && { watcherEventConsumer: opts.watcherEventConsumer }),
    ...(opts.decompose !== undefined && { decompose: opts.decompose }),
    ...(opts.riskClassify !== undefined && { riskClassify: opts.riskClassify }),
    ...(opts.decisionStore !== undefined && { decisionStore: opts.decisionStore }),
    log: { error: (obj, msg) => app.log.error(obj, msg) },
  })

  app.post<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/start',
    { preHandler },
    async (req, reply) => {
      const uuidResult = z.string().uuid().safeParse(req.params.sessionId)
      if (!uuidResult.success) {
        return reply.status(400).send({ error: 'Invalid sessionId format' })
      }
      const { sessionId } = req.params

      if (activeConsumers.has(sessionId)) {
        return reply.status(409).send({ error: 'Session already active' })
      }

      startManagedSession(sessionId)
      return reply.status(202).send({ sessionId, status: 'started' })
    },
  )
}
