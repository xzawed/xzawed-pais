import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { StreamProducer } from '../streams/producer.js'
import { StreamConsumer } from '../streams/consumer.js'
import { closeRedisClient } from '../streams/redis.client.js'
import type { ManagerToOrchestratorMessage } from '@xzawed/shared'

const REDIS_URL = process.env['REDIS_URL'] ?? ''
const hasRedis = REDIS_URL !== ''

function parseData(fields: string[]): Record<string, unknown> | null {
  const idx = fields?.indexOf('data') ?? -1
  if (idx < 0) return null
  const raw = fields[idx + 1]
  if (raw === undefined) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

describe.skipIf(!hasRedis)('Redis Streams Integration', () => {
  let redis: Redis
  const usedKeys: string[] = []

  beforeAll(() => {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 })
  })

  afterAll(async () => {
    if (usedKeys.length > 0) await redis.del(...usedKeys)
    await redis.quit()
    await closeRedisClient()
  })

  // ── Scenario 1: StreamProducer publishes a task_request to real Redis ──────

  it('StreamProducer.publish() writes a task_request entry to the stream', async () => {
    const sessionId = randomUUID()
    const streamKeyName = `orchestrator:to-manager:${sessionId}`
    usedKeys.push(streamKeyName)

    const producer = new StreamProducer(REDIS_URL)
    const messageId = randomUUID()
    const id = await producer.publish({
      sessionId,
      messageId,
      timestamp: Date.now(),
      type: 'task_request',
      payload: { intent: 'test', context: {}, priority: 'normal' },
    })

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)

    const entries = await redis.xrange(streamKeyName, '-', '+')
    expect(entries).toHaveLength(1)

    const fields = entries[0][1]
    const parsed = parseData(fields)
    expect(parsed).not.toBeNull()
    expect(parsed!['type']).toBe('task_request')
    const payload = parsed!['payload'] as Record<string, unknown>
    expect(payload['intent']).toBe('test')
    expect(payload['context']).toEqual({})
    expect(payload['priority']).toBe('normal')
  })

  // ── Scenario 2: StreamConsumer receives a message and calls the handler ────

  it('StreamConsumer.start() calls handler with a valid status_update message', async () => {
    const sessionId = randomUUID()
    const inboundKey = `manager:to-orchestrator:${sessionId}`
    usedKeys.push(inboundKey)

    // Create consumer group on empty stream first so that '$' resolves to 0-0.
    // Messages added after group creation will have IDs > 0-0 and be visible to '>'.
    const consumer = new StreamConsumer(REDIS_URL)
    await consumer.ensureGroup(sessionId)

    const message: ManagerToOrchestratorMessage = {
      sessionId,
      messageId: randomUUID(),
      timestamp: Date.now(),
      type: 'status_update',
      payload: { agentId: 'planner', content: 'test content' },
    }

    await redis.xadd(inboundKey, '*', 'data', JSON.stringify(message))

    const received: ManagerToOrchestratorMessage[] = []

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        consumer.stop()
        reject(new Error('timed out waiting for handler call'))
      }, 12000)

      void consumer.start(sessionId, async (msg) => {
        received.push(msg)
        clearTimeout(timeout)
        consumer.stop()
        resolve()
      })
    })

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('status_update')
    expect(received[0].payload.content).toBe('test content')
  }, 15000)

  // ── Scenario 3: Round-trip — request/response via two stream directions ────

  it('round-trip: xadd plan_request → xread plan_complete response', async () => {
    const sessionId = randomUUID()
    const requestStream = `manager:to-planner:${sessionId}`
    const responseStream = `planner:to-manager:${sessionId}`
    usedKeys.push(requestStream, responseStream)

    const plannerClient = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 })
    let plannerDone = false

    const plannerLoop = (async () => {
      while (!plannerDone) {
        const results = (await plannerClient.xread(
          'COUNT', '1', 'BLOCK', '3000',
          'STREAMS', requestStream, '0-0'
        )) as [string, [string, string[]][]][] | null

        if (!results) continue

        for (const [, entries] of results) {
          for (const [, fields] of entries) {
            const req = parseData(fields)
            if (req === null || req['type'] !== 'plan_request') continue

            const response = {
              sessionId,
              messageId: randomUUID(),
              timestamp: Date.now(),
              type: 'plan_complete',
              payload: {
                steps: [
                  {
                    id: 'step-1',
                    title: 'Setup',
                    description: 'Initialize project',
                    agentType: 'developer',
                    dependencies: [],
                    estimatedMinutes: 5,
                  },
                ],
                estimatedTime: '5 minutes',
              },
            }
            await plannerClient.xadd(responseStream, '*', 'data', JSON.stringify(response))
            plannerDone = true
          }
        }
      }
    })()

    const tipEntries = await redis.xrevrange(requestStream, '+', '-', 'COUNT', '1')
    const tip = tipEntries.length > 0 ? (tipEntries[0][0] as string) : '0-0'

    await redis.xadd(requestStream, '*', 'data', JSON.stringify({
      sessionId,
      messageId: randomUUID(),
      timestamp: Date.now(),
      type: 'plan_request',
      payload: { intent: 'build a feature', context: {}, priority: 'normal' },
    }))

    const deadline = Date.now() + 10_000
    let result: Record<string, unknown> | null = null

    while (Date.now() < deadline && result === null) {
      const pollResults = (await redis.xread(
        'COUNT', '10', 'BLOCK', '1000',
        'STREAMS', responseStream, tip
      )) as [string, [string, string[]][]][] | null

      if (!pollResults) continue

      for (const [, entries] of pollResults) {
        for (const [, fields] of entries) {
          const msg = parseData(fields)
          if (msg?.['type'] === 'plan_complete') {
            result = (msg['payload'] as Record<string, unknown>) ?? null
          }
        }
      }
    }

    plannerDone = true
    await plannerLoop.catch(() => undefined)

    try {
      expect(result).not.toBeNull()
      expect(Array.isArray((result as Record<string, unknown>)['steps'])).toBe(true)
      expect(typeof (result as Record<string, unknown>)['estimatedTime']).toBe('string')
    } finally {
      await plannerClient.quit()
    }
  })

  // ── Scenario 4: Timeout — throws when no response arrives ─────────────────

  it('polling with short timeout throws when no response arrives', async () => {
    const sessionId = randomUUID()
    const requestStream = `manager:to-planner:${sessionId}`
    const responseStream = `planner:to-manager:${sessionId}`
    usedKeys.push(requestStream, responseStream)

    const timeoutMs = 200

    await redis.xadd(requestStream, '*', 'data', JSON.stringify({
      sessionId,
      messageId: randomUUID(),
      timestamp: Date.now(),
      type: 'plan_request',
      payload: { intent: 'should timeout', context: {}, priority: 'normal' },
    }))

    const deadline = Date.now() + timeoutMs

    async function pollWithTimeout(): Promise<void> {
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) break

        const results = (await redis.xread(
          'COUNT', '10',
          'STREAMS', responseStream, '0-0'
        )) as [string, [string, string[]][]][] | null

        if (results) {
          for (const [, entries] of results) {
            for (const [, fields] of entries) {
              const msg = parseData(fields)
              if (msg?.['type'] === 'plan_complete') return
            }
          }
        }

        await new Promise((r) => setTimeout(r, 20))
      }
      throw new Error(`planner timed out after ${timeoutMs}ms`)
    }

    await expect(pollWithTimeout()).rejects.toThrow(`timed out after ${timeoutMs}ms`)
  })

  // ── Scenario 5: Multi-session isolation ───────────────────────────────────

  it('messages are isolated per session — sessionA and sessionB do not cross', async () => {
    const sessionA = randomUUID()
    const sessionB = randomUUID()
    const keyA = `orchestrator:to-manager:${sessionA}`
    const keyB = `orchestrator:to-manager:${sessionB}`
    usedKeys.push(keyA, keyB)

    const producerA = new StreamProducer(REDIS_URL)
    const producerB = new StreamProducer(REDIS_URL)

    await producerA.publish({
      sessionId: sessionA,
      messageId: randomUUID(),
      timestamp: Date.now(),
      type: 'task_request',
      payload: { intent: 'task for A', context: {}, priority: 'normal' },
    })

    await producerB.publish({
      sessionId: sessionB,
      messageId: randomUUID(),
      timestamp: Date.now(),
      type: 'task_request',
      payload: { intent: 'task for B', context: {}, priority: 'normal' },
    })

    const entriesA = await redis.xrange(keyA, '-', '+')
    const entriesB = await redis.xrange(keyB, '-', '+')

    expect(entriesA).toHaveLength(1)
    expect(entriesB).toHaveLength(1)

    const msgA = parseData(entriesA[0][1]) as { payload: { intent: string } } | null
    const msgB = parseData(entriesB[0][1]) as { payload: { intent: string } } | null

    expect(msgA).not.toBeNull()
    expect(msgB).not.toBeNull()
    expect(msgA!.payload.intent).toContain('task for A')
    expect(msgB!.payload.intent).toContain('task for B')

    expect(msgA!.payload.intent).not.toContain('task for B')
    expect(msgB!.payload.intent).not.toContain('task for A')
  })
})
