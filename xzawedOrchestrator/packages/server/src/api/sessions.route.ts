import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import { registerLocalRateLimit } from './rate-limit.js'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../sessions/session.store.js'
import type { ClaudeRunner, RunOptions } from '../claude/runner.interface.js'
import type { StreamProducer } from '../streams/producer.js'
import type { Message, Session, ManagerToOrchestratorMessage, Chunk, UserContext } from '@xzawed/shared'
import { StreamConsumer } from '../streams/consumer.js'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { resolve, parse } from 'node:path'
import { structureIntent } from '../claude/intent-structurer.js'
import { TaskStore } from '../tasks/task.store.js'
import { MessageRepo } from '../sessions/message.repo.js'
import { assertProjectOwner } from '../auth/ownership.js'
import { ProjectRepo, type Project } from '../projects/project.repo.js'
import { t, type ServerLocale, type LocalizedRequest } from '../i18n/server-i18n.js'

function assertNotFilesystemRoot(p: string): void {
  const resolved = resolve(p)
  const { root } = parse(resolved)
  if (resolved === root || resolved === root.replace(/[\\/]$/, '')) {
    throw new Error('WORKSPACE_ROOT must not be filesystem root')
  }
}

export function resolveSessionWorkspaceRoot(
  project: Project | null | undefined,
  envFallback: string,
): string {
  if (project?.workspace_path) return project.workspace_path
  return envFallback
}

interface ChunkProcessResult {
  fullContent: string
  aborted: boolean
}

async function processChunk(
  chunk: Chunk,
  assistantMsgId: string,
  getSocket: () => WebSocket | undefined,
  accumulator: { fullContent: string },
): Promise<'continue' | 'error' | 'done'> {
  if (chunk.type === 'text') {
    accumulator.fullContent += chunk.content
    getSocket()?.send(JSON.stringify({ type: 'chunk', messageId: assistantMsgId, content: chunk.content }))
    return 'continue'
  }
  if (chunk.type === 'error') {
    getSocket()?.send(JSON.stringify({ type: 'error', content: chunk.content }))
    return 'error'
  }
  if (chunk.type === 'done') return 'done'
  return 'continue'
}

async function processRunnerChunks(
  runner: ClaudeRunner,
  snapshot: Message[],
  runOptions: RunOptions,
  assistantMsgId: string,
  getSocket: () => WebSocket | undefined,
): Promise<ChunkProcessResult> {
  const acc = { fullContent: '' }
  for await (const chunk of runner.send(snapshot, runOptions)) {
    const result = await processChunk(chunk, assistantMsgId, getSocket, acc)
    if (result === 'error') return { fullContent: acc.fullContent, aborted: true }
    if (result === 'done') break
  }
  return { fullContent: acc.fullContent, aborted: false }
}

async function saveAssistantMessage(
  sessionId: string,
  assistantMsgId: string,
  fullContent: string,
  msgRepo: MessageRepo | undefined,
  messageStore: Map<string, Message[]>,
): Promise<void> {
  if (msgRepo) {
    await msgRepo.create(sessionId, 'assistant', fullContent)
    return
  }
  const history = messageStore.get(sessionId) ?? []
  history.push({ id: assistantMsgId, sessionId, role: 'assistant', content: fullContent, timestamp: Date.now() })
  messageStore.set(sessionId, history)
}

export async function buildUserContext(
  session: { userId: string; projectId?: string | null },
  pool?: Pool,
): Promise<UserContext> {
  const envFallback = process.env.WORKSPACE_ROOT ?? '/workspace'
  if (session.projectId) {
    let workspaceRoot = envFallback
    let tenantId: string | null = null
    if (pool) {
      const repo = new ProjectRepo(pool)
      const project = await repo.findByIdAndUser(session.projectId, session.userId)
      workspaceRoot = resolveSessionWorkspaceRoot(project, envFallback)
      tenantId = project?.orgId ?? null // G11 Slice 3: 프로젝트 소유 org를 테넌트로 전파(모델 C)
    }
    assertNotFilesystemRoot(workspaceRoot)
    return { userId: session.userId, projectId: session.projectId, workspaceRoot, ...(tenantId != null && { tenantId }) }
  }
  // AUTH=none 또는 프로젝트 미선택 시: 기본 workspace를 전달하여 Manager가 register_project를 호출하지 않도록 방지
  // G11 Slice 3: 프로젝트 미선택이면 사용자 org를 테넌트로 조회(pool 있을 때). 무DB/무org면 미설정(하위호환).
  let tenantId: string | null = null
  if (pool) {
    const { rows } = await pool.query<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [session.userId])
    tenantId = rows[0]?.org_id ?? null
  }
  assertNotFilesystemRoot(envFallback)
  return { userId: session.userId, projectId: 'default', workspaceRoot: envFallback, ...(tenantId != null && { tenantId }) }
}

/** C6: build 모드 + 플래그면 분해 라우팅. 순수 결정. */
export function shouldDecompose(mode: string | undefined, decomposeEnabled: boolean): boolean {
  return mode === 'build' && decomposeEnabled
}

/** C6: 원 요청을 decompose_request로 Manager에 발행(자율 태스크그래프). 발행 실패는 비차단(log.warn). */
export async function publishDecomposeToManager(
  producer: StreamProducer,
  sessionId: string,
  intent: string,
  userContext: UserContext,
  getSocket: () => WebSocket | undefined,
  log: FastifyInstance['log'],
  locale: ServerLocale = 'ko',
): Promise<boolean> {
  try {
    await producer.publish({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'decompose_request',
      payload: { intent, userContext },
    })
    getSocket()?.send(JSON.stringify({ type: 'status', content: t('status.forwarding', locale) }))
    return true
  } catch (publishErr: unknown) {
    // 비차단(크래시 방지)이나 성공/실패를 반환해 호출부가 드롭을 'done'으로 위장하지 않게 한다.
    log.warn({ err: publishErr }, 'Redis publish failed — Manager unavailable, skipping decompose forwarding')
    return false
  }
}

export async function publishTaskToManager(
  producer: StreamProducer,
  sessionId: string,
  intent: string,
  snapshot: Message[],
  session: { userId: string; projectId?: string | null },
  getSocket: () => WebSocket | undefined,
  log: FastifyInstance['log'],
  pool?: Pool,
  locale: ServerLocale = 'ko',
  gateMode?: 'manual' | 'auto',
): Promise<void> {
  // chat(task) 경로는 로컬 러너가 이미 응답을 스트리밍한 뒤의 best-effort 다운스트림
  // 전달이다. Manager/Redis 미가용이 chat 턴 완료('done')를 막지 않도록 실패를 비차단으로
  // 삼킨다(로컬 chat 복원력). 전달이 유일 액션인 build 경로(publishDecomposeToManager)만
  // 실패를 error로 표면화한다.
  const userContext = await buildUserContext(session, pool)
  try {
    await producer.publish({
      sessionId,
      messageId: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'task_request',
      payload: {
        intent,
        context: { history: snapshot.map((m) => ({ role: m.role, content: m.content })) },
        priority: 'normal',
        userContext,
        ...(gateMode ? { gateMode } : {}),
      },
    })
    getSocket()?.send(JSON.stringify({ type: 'status', content: t('status.forwarding', locale) }))
  } catch (publishErr: unknown) {
    log.warn({ err: publishErr }, 'Redis publish failed — Manager unavailable, skipping forwarding')
  }
}

interface SessionsRoutesConfig {
  store: SessionStore
  runner: ClaudeRunner
  wsSessions: Map<string, WebSocket>
  redisUrl: string
  producer: StreamProducer
  sessionConsumers: Map<string, StreamConsumer>
  sessionCleanup: Map<string, () => void>
  anthropicClient?: Anthropic
  claudeModel?: string
  authHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  pool?: Pool
  userAuthHook?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  decomposeEnabled?: boolean
}

export function handleConsumerMessage(
  msg: ManagerToOrchestratorMessage,
  sessionId: string,
  socket: WebSocket,
  consumers: Map<string, StreamConsumer>,
  taskStore: TaskStore,
  onTerminate?: (sessionId: string) => void,
): void {
  const activeTask = taskStore
    .findBySessionId(sessionId)
    .findLast(t => t.status === 'pending' || t.status === 'running')

  switch (msg.type) {
    case 'status_update':
      if (activeTask) taskStore.update(activeTask.id, 'running')
      socket.send(JSON.stringify({
        type: 'agent_status',
        agentId: msg.payload.agentId,
        content: msg.payload.content,
        ...(msg.payload.uiSpec !== undefined ? { uiSpec: msg.payload.uiSpec } : {}),
        // G5: 세션 누적 비용을 앱으로 릴레이(RightPanel이 실시간 지출 표시).
        ...(msg.payload.costUsd !== undefined ? { costUsd: msg.payload.costUsd } : {}),
        ...(msg.payload.tokensUsed !== undefined ? { tokensUsed: msg.payload.tokensUsed } : {}),
      }))
      break
    case 'task_complete':
      if (activeTask) taskStore.update(activeTask.id, 'completed', msg.payload.content)
      socket.send(JSON.stringify({
        type: 'agent_done',
        agentId: msg.payload.agentId,
        content: msg.payload.content,
      }))
      if (onTerminate) {
        onTerminate(sessionId)
      } else {
        consumers.get(sessionId)?.stop()
        consumers.delete(sessionId)
      }
      break
    case 'error':
      if (activeTask) taskStore.update(activeTask.id, 'failed', msg.payload.content)
      socket.send(JSON.stringify({
        type: 'agent_error',
        agentId: msg.payload.agentId,
        content: msg.payload.content,
      }))
      if (onTerminate) {
        onTerminate(sessionId)
      } else {
        consumers.get(sessionId)?.stop()
        consumers.delete(sessionId)
      }
      break
    case 'info_request':
      socket.send(JSON.stringify({
        type: 'agent_info_request',
        agentId: msg.payload.agentId,
        content: msg.payload.content,
        ...(msg.payload.uiSpec !== undefined ? { uiSpec: msg.payload.uiSpec } : {}),
        ...(msg.payload.approval !== undefined ? { approval: msg.payload.approval } : {}),
      }))
      break
    case 'knowledge_changed':
      // 위키 지식 변경 알림 — 진행상황/세션 종료와 무관(태스크·컨슈머 유지). WikiPanel 실시간 갱신용.
      socket.send(JSON.stringify({
        type: 'knowledge_changed',
        ...(msg.payload.projectId !== undefined ? { projectId: msg.payload.projectId } : {}),
      }))
      break
  }
}

export async function sessionsRoutes(
  app: FastifyInstance,
  config: SessionsRoutesConfig
): Promise<void> {
  const {
    store, runner, wsSessions, redisUrl, producer,
    sessionConsumers, sessionCleanup, anthropicClient, claudeModel,
    authHook, pool, userAuthHook, decomposeEnabled = false,
  } = config

  const messageStore = new Map<string, Message[]>()
  const taskStore = new TaskStore()
  // Guard against concurrent message processing for the same session
  const processingSessionIds = new Set<string>()

  const msgRepo = pool ? new MessageRepo(pool) : undefined
  const effectiveAuthHook = userAuthHook ?? authHook
  const routeOpts = effectiveAuthHook ? { preHandler: effectiveAuthHook } : {}

  // W14: 비용 write 엔드포인트 rate-limit — POST messages는 LLM 호출/decompose_request를 트리거하므로 스팸 시
  // 비용 폭발·DoS. GET(읽기)은 무제한. auth 라우트와 공유 헬퍼(registerLocalRateLimit·CPD0).
  await registerLocalRateLimit(app)
  const withLimit = (max: number): Record<string, unknown> => ({
    ...routeOpts,
    config: { rateLimit: { max, timeWindow: '1 minute' } },
  })

  function cleanupSession(sessionId: string): void {
    sessionCleanup.get(sessionId)?.()
    sessionCleanup.delete(sessionId)
    sessionConsumers.get(sessionId)?.stop()
    sessionConsumers.delete(sessionId)
    wsSessions.delete(sessionId)
    taskStore.deleteBySessionId(sessionId)
    messageStore.delete(sessionId)
  }

  function locale(req: FastifyRequest): ServerLocale {
    return (req as FastifyRequest & Partial<LocalizedRequest>).locale ?? 'ko'
  }

  type ResolvedSession = { session: Session; loc: ServerLocale }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  async function resolveSession(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<ResolvedSession | null> {
    const loc = locale(req)
    if (!UUID_RE.test(req.params.id)) {
      await reply.status(400).send({ error: t('error.invalid_input', loc) })
      return null
    }
    const session = await store.findById(req.params.id)
    if (!session) {
      await reply.status(404).send({ error: t('error.session_not_found', loc) })
      return null
    }
    // When userAuthHook is configured, req.authUser must be set; absence means unauthenticated access
    if (userAuthHook && !req.authUser) {
      await reply.status(401).send({ error: t('error.unauthorized', loc) })
      return null
    }
    if (req.authUser && session.userId !== req.authUser.sub) {
      await reply.status(404).send({ error: t('error.session_not_found', loc) })
      return null
    }
    return { session, loc }
  }

  const CreateSessionBodySchema = z.object({
    userId: z.string().optional(),
    projectId: z.string().optional(),
  })

  app.post('/sessions', withLimit(10), async (req, reply) => {
    const bodyResult = CreateSessionBodySchema.safeParse(req.body ?? {})
    if (!bodyResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error.flatten() })
    }
    const body = bodyResult.data

    let userId: string
    let projectId: string | null = null

    if (userAuthHook) {
      if (!req.authUser) return reply.status(401).send({ error: 'Unauthorized' })
      if (!body.projectId) return reply.status(400).send({ error: 'projectId is required' })
      const project = await assertProjectOwner(req.authUser.sub, body.projectId, pool!, reply)
      if (!project) return
      userId = req.authUser.sub
      projectId = project.id
    } else {
      userId = body.userId ?? 'anonymous'
    }

    const session = await store.create(userId, projectId, 'cli')

    if (!msgRepo) messageStore.set(session.id, [])

    sessionCleanup.set(session.id, () => {
      taskStore.deleteBySessionId(session.id)
      messageStore.delete(session.id)
      void store.delete(session.id).catch(() => undefined)
    })

    void producer.publishSessionGateway(session.id).catch((err: unknown) => {
      req.log.warn({ err, sessionId: session.id }, 'Failed to publish session gateway init')
    })

    const consumer = new StreamConsumer(redisUrl)
    sessionConsumers.set(session.id, consumer)
    void consumer.start(session.id, async (msg) => {
      const socket = wsSessions.get(session.id)
      if (!socket) return
      try {
        handleConsumerMessage(msg, session.id, socket, sessionConsumers, taskStore, cleanupSession)
      } catch (err) {
        req.log.error({ err, sessionId: session.id }, 'handleConsumerMessage error')
      }
    }).catch((err: unknown) => {
      req.log.warn({ err, sessionId: session.id }, 'StreamConsumer error')
    })

    return reply.status(201).send({ sessionId: session.id })
  })

  app.get<{ Params: { id: string } }>('/sessions/:id/messages', routeOpts, async (req, reply) => {
    const resolved = await resolveSession(req, reply)
    if (!resolved) return
    if (msgRepo) return reply.send(await msgRepo.findBySession(req.params.id))
    return messageStore.get(req.params.id) ?? []
  })

  const MessageBodySchema = z.object({
    content: z.string().min(1),
    gateMode: z.enum(['manual', 'auto']).optional(),
    mode: z.enum(['chat', 'build']).optional(),
  })
  app.post<{ Params: { id: string }; Body: { content: string; gateMode?: 'manual' | 'auto'; mode?: 'chat' | 'build' } }>(
    '/sessions/:id/messages',
    withLimit(30),
    async (req, reply) => {
      const resolved = await resolveSession(req, reply)
      if (!resolved) return
      const { session } = resolved

      // 수신 표면 런타임 검증: Body 제네릭은 컴파일 타임 주석일 뿐이라 malformed 본문
      // (content 누락·비문자열·미지 mode/gateMode)이 400 없이 저장·실행되던 것을 봉합.
      const bodyResult = MessageBodySchema.safeParse(req.body ?? {})
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error.flatten() })
      }
      const body = bodyResult.data

      const sessionId = req.params.id
      // Guard against concurrent message processing for the same session
      if (processingSessionIds.has(sessionId)) {
        return reply.status(409).send({ error: 'Session is already processing a message' })
      }

      const userMsgId = crypto.randomUUID()
      let snapshot: Message[]

      if (msgRepo) {
        await msgRepo.create(req.params.id, 'user', body.content)
        snapshot = await msgRepo.findBySession(req.params.id)
      } else {
        const msg: Message = {
          id: userMsgId,
          sessionId: req.params.id,
          role: 'user',
          content: body.content,
          timestamp: Date.now(),
        }
        const history = messageStore.get(req.params.id) ?? []
        history.push(msg)
        snapshot = [...history]
      }

      const capturedProjectId = session.projectId
      const capturedUserId = session.userId
      const capturedLocale = resolved.loc
      const capturedGateMode = body.gateMode
      const capturedMode = body.mode
      const capturedContent = body.content

      processingSessionIds.add(sessionId)
      // Live socket lookup, not a captured reference: a WS reconnect during the grace window
      // swaps the socket in wsSessions, so chunks/done/error must resolve the current socket.
      const getSocket = (): WebSocket | undefined => wsSessions.get(sessionId)
      ;(async () => {
        const assistantMsgId = crypto.randomUUID()

        try {
          if (shouldDecompose(capturedMode, decomposeEnabled)) {
            const userContext = await buildUserContext({ userId: capturedUserId, projectId: capturedProjectId }, pool)
            taskStore.create(sessionId, capturedContent)
            // build 경로는 러너 스트리밍이 없고 Manager 전달이 유일 액션이다. 전달 실패 시
            // 'done'은 아무것도 안 됐는데 완료로 위장하는 사일런트 실패이므로 error로 표면화.
            const forwarded = await publishDecomposeToManager(producer, sessionId, capturedContent, userContext, getSocket, app.log, capturedLocale)
            getSocket()?.send(JSON.stringify(forwarded
              ? { type: 'done', messageId: assistantMsgId }
              : { type: 'error', content: t('error.processing_error', capturedLocale) }))
            return
          }

          const { fullContent, aborted } = await processRunnerChunks(
            runner, snapshot, {}, assistantMsgId, getSocket,
          )
          if (aborted) return

          await saveAssistantMessage(sessionId, assistantMsgId, fullContent, msgRepo, messageStore)

          const intent = (anthropicClient && claudeModel)
            ? await structureIntent(fullContent, anthropicClient, claudeModel)
            : fullContent

          taskStore.create(sessionId, intent)

          const capturedSession = { userId: capturedUserId, projectId: capturedProjectId }
          // 러너가 이미 응답을 스트리밍했으므로 chat 턴은 완료됨('done'). Manager 전달은
          // best-effort 다운스트림 트리거라 실패해도 턴을 error로 뒤집지 않는다.
          await publishTaskToManager(producer, sessionId, intent, snapshot, capturedSession, getSocket, app.log, pool, capturedLocale, capturedGateMode)

          getSocket()?.send(JSON.stringify({ type: 'done', messageId: assistantMsgId }))
        } catch (err) {
          req.log.error({ err, sessionId }, 'Session processing error')
          getSocket()?.send(JSON.stringify({ type: 'error', content: t('error.processing_error', capturedLocale) }))
        } finally {
          processingSessionIds.delete(sessionId)
        }
      })().catch((err: unknown) => {
        processingSessionIds.delete(sessionId)
        app.log.error({ err, sessionId }, 'Unhandled error in message processing')
      })

      return reply.status(202).send({ messageId: userMsgId, status: 'accepted' })
    }
  )

  app.get<{ Params: { id: string } }>('/sessions/:id/tasks', routeOpts, async (req, reply) => {
    const resolved = await resolveSession(req, reply)
    if (!resolved) return
    return reply.send({ tasks: taskStore.findBySessionId(req.params.id) })
  })

  app.post<{
    Params: { id: string }
    Body: { action: string; data: Record<string, unknown> }
  }>(
    '/sessions/:id/ui-actions',
    withLimit(60),
    async (req, reply) => {
      const resolved = await resolveSession(req, reply)
      if (!resolved) return
      const { loc } = resolved
      const { action } = req.body
      if (!action || typeof action !== 'string') {
        return reply.status(400).send({ error: t('error.invalid_input', loc) })
      }

      try {
        await producer.publish({
          sessionId: req.params.id,
          messageId: crypto.randomUUID(),
          timestamp: Date.now(),
          type: 'info_response',
          payload: { answer: action },
        })
      } catch (publishErr: unknown) {
        app.log.warn({ err: publishErr }, 'Redis publish failed for ui-action')
      }

      return reply.status(202).send({ status: 'accepted' })
    }
  )
}
