import { describe, it, expect, vi } from 'vitest'
import { handleConsumerMessage } from '../sessions.route.js'
import { TaskStore } from '../../tasks/task.store.js'
import type { ManagerToOrchestratorMessage } from '@xzawed/shared'
import type { StreamConsumer } from '../../streams/consumer.js'

const SID = 'sess-1'

function makeMsg(
  type: ManagerToOrchestratorMessage['type'],
  extras: Partial<ManagerToOrchestratorMessage['payload']> = {},
): ManagerToOrchestratorMessage {
  return {
    sessionId: SID,
    messageId: 'msg-1',
    timestamp: Date.now(),
    type,
    payload: { agentId: 'agent-1', content: 'test-content', ...extras },
  }
}

function makeSocket() {
  return { send: vi.fn() } as unknown as import('ws').WebSocket
}

function makeConsumers() {
  const consumer = { stop: vi.fn() } as unknown as StreamConsumer
  const map = new Map<string, StreamConsumer>([[SID, consumer]])
  return { map, consumer }
}

type SentPayload = { type: string; agentId: string; content: string; uiSpec?: unknown }

describe('handleConsumerMessage — status_update', () => {
  it('소켓에 agent_status 전송', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()

    handleConsumerMessage(makeMsg('status_update'), SID, socket, map, taskStore)

    expect(socket.send).toHaveBeenCalledOnce()
    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as SentPayload
    expect(sent.type).toBe('agent_status')
    expect(sent.content).toBe('test-content')
    expect(sent.agentId).toBe('agent-1')
  })

  it('활성 태스크가 있으면 running으로 업데이트', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    taskStore.create(SID, 'some intent')
    const { map } = makeConsumers()

    handleConsumerMessage(makeMsg('status_update'), SID, socket, map, taskStore)

    expect(taskStore.findBySessionId(SID)[0]?.status).toBe('running')
  })

  it('활성 태스크 없으면 상태 업데이트 없음', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()

    handleConsumerMessage(makeMsg('status_update'), SID, socket, map, taskStore)

    expect(taskStore.findBySessionId(SID)).toHaveLength(0)
    expect(socket.send).toHaveBeenCalledOnce()
  })
})

describe('handleConsumerMessage — task_complete', () => {
  it('소켓에 agent_done 전송 및 컨슈머 정리', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map, consumer } = makeConsumers()

    handleConsumerMessage(makeMsg('task_complete'), SID, socket, map, taskStore)

    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as SentPayload
    expect(sent.type).toBe('agent_done')
    expect(consumer.stop).toHaveBeenCalled()
    expect(map.has(SID)).toBe(false)
  })

  it('활성 태스크가 있으면 completed로 업데이트', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    taskStore.create(SID, 'some intent')
    const { map } = makeConsumers()

    handleConsumerMessage(makeMsg('task_complete', { content: 'done!' }), SID, socket, map, taskStore)

    const task = taskStore.findBySessionId(SID)[0]
    expect(task?.status).toBe('completed')
    expect(task?.result).toBe('done!')
  })
})

describe('handleConsumerMessage — error', () => {
  it('소켓에 agent_error 전송 및 컨슈머 정리', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map, consumer } = makeConsumers()

    handleConsumerMessage(makeMsg('error'), SID, socket, map, taskStore)

    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as SentPayload
    expect(sent.type).toBe('agent_error')
    expect(consumer.stop).toHaveBeenCalled()
    expect(map.has(SID)).toBe(false)
  })

  it('활성 태스크가 있으면 failed로 업데이트', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    taskStore.create(SID, 'some intent')
    const { map } = makeConsumers()

    handleConsumerMessage(makeMsg('error', { content: 'oops!' }), SID, socket, map, taskStore)

    const task = taskStore.findBySessionId(SID)[0]
    expect(task?.status).toBe('failed')
    expect(task?.result).toBe('oops!')
  })
})

describe('handleConsumerMessage — info_request', () => {
  it('uiSpec 없이 agent_info_request 전송', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()

    handleConsumerMessage(makeMsg('info_request'), SID, socket, map, taskStore)

    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as SentPayload
    expect(sent.type).toBe('agent_info_request')
    expect('uiSpec' in sent).toBe(false)
  })

  it('uiSpec이 있으면 포함하여 전송', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()
    const uiSpec = { type: 'form' as const, title: 'Input', fields: [] } as NonNullable<ManagerToOrchestratorMessage['payload']['uiSpec']>

    handleConsumerMessage(makeMsg('info_request', { uiSpec }), SID, socket, map, taskStore)

    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as SentPayload
    expect(sent.type).toBe('agent_info_request')
    expect(sent.uiSpec).toEqual(uiSpec)
  })
})

describe('handleConsumerMessage — onTerminate 콜백', () => {
  it('task_complete 수신 시 onTerminate가 sessionId와 함께 호출됨', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()
    const onTerminate = vi.fn()

    handleConsumerMessage(makeMsg('task_complete'), SID, socket, map, taskStore, onTerminate)

    expect(onTerminate).toHaveBeenCalledOnce()
    expect(onTerminate).toHaveBeenCalledWith(SID)
  })

  it('error 수신 시 onTerminate가 sessionId와 함께 호출됨', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()
    const onTerminate = vi.fn()

    handleConsumerMessage(makeMsg('error'), SID, socket, map, taskStore, onTerminate)

    expect(onTerminate).toHaveBeenCalledOnce()
    expect(onTerminate).toHaveBeenCalledWith(SID)
  })

  it('onTerminate가 제공되면 consumers Map을 직접 수정하지 않음', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map, consumer } = makeConsumers()
    const onTerminate = vi.fn()

    handleConsumerMessage(makeMsg('task_complete'), SID, socket, map, taskStore, onTerminate)

    expect(consumer.stop).not.toHaveBeenCalled()
    expect(map.has(SID)).toBe(true)
  })
})

describe('handleConsumerMessage — status_update with uiSpec', () => {
  it('status_update 메시지에 uiSpec이 있으면 agent_status 소켓 메시지에 uiSpec 포함', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()
    const uiSpec = { type: 'mockup_viewer' as const, title: 'UI 미리보기', content: 'preview' } as NonNullable<ManagerToOrchestratorMessage['payload']['uiSpec']>

    handleConsumerMessage(makeMsg('status_update', { uiSpec }), SID, socket, map, taskStore)

    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as SentPayload
    expect(sent.type).toBe('agent_status')
    expect(sent.uiSpec).toEqual(uiSpec)
  })

  it('status_update 메시지에 uiSpec이 없으면 agent_status 소켓 메시지에 uiSpec 미포함', () => {
    const socket = makeSocket()
    const taskStore = new TaskStore()
    const { map } = makeConsumers()

    handleConsumerMessage(makeMsg('status_update'), SID, socket, map, taskStore)

    const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string) as SentPayload
    expect(sent.type).toBe('agent_status')
    expect('uiSpec' in sent).toBe(false)
  })
})
