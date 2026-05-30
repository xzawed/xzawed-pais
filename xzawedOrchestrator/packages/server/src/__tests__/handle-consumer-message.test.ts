import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebSocket } from 'ws'
import type { ManagerToOrchestratorMessage } from '@xzawed/shared'
import { handleConsumerMessage } from '../api/sessions.route.js'
import { TaskStore } from '../tasks/task.store.js'
import type { StreamConsumer } from '../streams/consumer.js'

function makeMockSocket(): { send: ReturnType<typeof vi.fn> } & WebSocket {
  return { send: vi.fn() } as unknown as { send: ReturnType<typeof vi.fn> } & WebSocket
}

function makeMockConsumer(): StreamConsumer {
  return { start: vi.fn(), stop: vi.fn() } as unknown as StreamConsumer
}

function makeMsg(
  type: ManagerToOrchestratorMessage['type'],
  agentId: string,
  content: string,
  uiSpec?: ManagerToOrchestratorMessage['payload']['uiSpec'],
): ManagerToOrchestratorMessage {
  return {
    sessionId: 'test-session',
    messageId: 'test-msg',
    timestamp: Date.now(),
    type,
    payload: uiSpec !== undefined ? { agentId, content, uiSpec } : { agentId, content },
  }
}

describe('handleConsumerMessage', () => {
  let taskStore: TaskStore
  let consumers: Map<string, StreamConsumer>

  beforeEach(() => {
    taskStore = new TaskStore()
    consumers = new Map()
  })

  describe('status_update', () => {
    it('pending 태스크를 running 상태로 전환한다', () => {
      taskStore.create('sess-1', 'do something')
      const tasks = taskStore.findBySessionId('sess-1')
      expect(tasks[0].status).toBe('pending')

      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('status_update', 'planner', '계획 중...'),
        'sess-1', socket, consumers, taskStore,
      )

      expect(taskStore.findBySessionId('sess-1')[0].status).toBe('running')
    })

    it('agent_status 메시지를 소켓으로 전송한다', () => {
      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('status_update', 'developer', '코딩 중...'),
        'sess-1', socket, consumers, taskStore,
      )

      expect(socket.send).toHaveBeenCalledOnce()
      const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect(sent.type).toBe('agent_status')
      expect(sent.agentId).toBe('developer')
      expect(sent.content).toBe('코딩 중...')
    })

    it('uiSpec이 있으면 agent_status 메시지에 포함된다', () => {
      const socket = makeMockSocket()
      const uiSpec = { component: 'form', fields: [] } as unknown as ManagerToOrchestratorMessage['payload']['uiSpec']
      handleConsumerMessage(
        makeMsg('status_update', 'designer', 'UI 설계', uiSpec),
        'sess-1', socket, consumers, taskStore,
      )

      const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect(sent.uiSpec).toEqual(uiSpec)
    })

    it('uiSpec이 없으면 agent_status 메시지에 uiSpec 키가 없다', () => {
      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('status_update', 'tester', '테스트 중...'),
        'sess-1', socket, consumers, taskStore,
      )

      const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect('uiSpec' in sent).toBe(false)
    })

    it('활성 태스크가 없어도 소켓 전송은 정상 동작한다', () => {
      const socket = makeMockSocket()
      // 태스크 없이 status_update 처리 → taskStore 업데이트 생략, 소켓 전송만
      handleConsumerMessage(
        makeMsg('status_update', 'planner', '시작'),
        'sess-no-task', socket, consumers, taskStore,
      )

      expect(socket.send).toHaveBeenCalledOnce()
    })
  })

  describe('task_complete', () => {
    it('활성 태스크를 completed 상태로 전환한다', () => {
      taskStore.create('sess-2', 'build feature')

      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('task_complete', 'builder', '빌드 완료'),
        'sess-2', socket, consumers, taskStore,
      )

      const tasks = taskStore.findBySessionId('sess-2')
      expect(tasks[0].status).toBe('completed')
    })

    it('agent_done 메시지를 소켓으로 전송한다', () => {
      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('task_complete', 'builder', '작업 완료'),
        'sess-2', socket, consumers, taskStore,
      )

      expect(socket.send).toHaveBeenCalledOnce()
      const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect(sent.type).toBe('agent_done')
      expect(sent.agentId).toBe('builder')
      expect(sent.content).toBe('작업 완료')
    })

    it('onTerminate 콜백이 있으면 cleanupSession이 호출된다', () => {
      const onTerminate = vi.fn()
      const socket = makeMockSocket()

      handleConsumerMessage(
        makeMsg('task_complete', 'builder', '완료'),
        'sess-cleanup', socket, consumers, taskStore, onTerminate,
      )

      expect(onTerminate).toHaveBeenCalledOnce()
      expect(onTerminate).toHaveBeenCalledWith('sess-cleanup')
    })

    it('onTerminate가 없으면 consumers에서 stop/delete 처리한다', () => {
      const consumer = makeMockConsumer()
      consumers.set('sess-3', consumer)

      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('task_complete', 'builder', '완료'),
        'sess-3', socket, consumers, taskStore,
      )

      expect(consumer.stop).toHaveBeenCalledOnce()
      expect(consumers.has('sess-3')).toBe(false)
    })

    it('running 상태 태스크도 task_complete로 completed 전환된다', () => {
      taskStore.create('sess-4', 'some intent')
      // status_update로 running 상태로 먼저 전환
      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('status_update', 'planner', '시작'),
        'sess-4', socket, consumers, taskStore,
      )
      expect(taskStore.findBySessionId('sess-4')[0].status).toBe('running')

      handleConsumerMessage(
        makeMsg('task_complete', 'builder', '완료'),
        'sess-4', socket, consumers, taskStore,
      )
      expect(taskStore.findBySessionId('sess-4')[0].status).toBe('completed')
    })
  })

  describe('error', () => {
    it('활성 태스크를 failed 상태로 전환한다', () => {
      taskStore.create('sess-5', 'risky task')

      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('error', 'tester', '빌드 실패'),
        'sess-5', socket, consumers, taskStore,
      )

      expect(taskStore.findBySessionId('sess-5')[0].status).toBe('failed')
    })

    it('agent_error 메시지를 소켓으로 전송한다', () => {
      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('error', 'tester', '테스트 실패'),
        'sess-5', socket, consumers, taskStore,
      )

      const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect(sent.type).toBe('agent_error')
      expect(sent.content).toBe('테스트 실패')
    })

    it('onTerminate 콜백이 있으면 error 시에도 cleanupSession이 호출된다', () => {
      const onTerminate = vi.fn()
      const socket = makeMockSocket()

      handleConsumerMessage(
        makeMsg('error', 'tester', '에러'),
        'sess-err', socket, consumers, taskStore, onTerminate,
      )

      expect(onTerminate).toHaveBeenCalledOnce()
      expect(onTerminate).toHaveBeenCalledWith('sess-err')
    })

    it('onTerminate가 없으면 consumers에서 stop/delete 처리한다', () => {
      const consumer = makeMockConsumer()
      consumers.set('sess-6', consumer)

      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('error', 'tester', '에러'),
        'sess-6', socket, consumers, taskStore,
      )

      expect(consumer.stop).toHaveBeenCalledOnce()
      expect(consumers.has('sess-6')).toBe(false)
    })
  })

  describe('info_request', () => {
    it('agent_info_request 메시지를 소켓으로 전송한다', () => {
      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('info_request', 'planner', '추가 정보 필요'),
        'sess-7', socket, consumers, taskStore,
      )

      const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect(sent.type).toBe('agent_info_request')
      expect(sent.agentId).toBe('planner')
      expect(sent.content).toBe('추가 정보 필요')
    })

    it('info_request의 uiSpec이 있으면 메시지에 포함된다', () => {
      const socket = makeMockSocket()
      const uiSpec = { component: 'select', options: ['A', 'B'] } as unknown as ManagerToOrchestratorMessage['payload']['uiSpec']
      handleConsumerMessage(
        makeMsg('info_request', 'designer', '선택하세요', uiSpec),
        'sess-7', socket, consumers, taskStore,
      )

      const sent = JSON.parse((socket.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string)
      expect(sent.uiSpec).toEqual(uiSpec)
    })

    it('info_request는 태스크 상태를 변경하지 않는다', () => {
      taskStore.create('sess-8', 'pending task')
      const socket = makeMockSocket()

      handleConsumerMessage(
        makeMsg('info_request', 'planner', '정보 요청'),
        'sess-8', socket, consumers, taskStore,
      )

      expect(taskStore.findBySessionId('sess-8')[0].status).toBe('pending')
    })

    it('info_request는 consumers를 정리하지 않는다', () => {
      const consumer = makeMockConsumer()
      consumers.set('sess-8', consumer)

      const socket = makeMockSocket()
      handleConsumerMessage(
        makeMsg('info_request', 'planner', '요청'),
        'sess-8', socket, consumers, taskStore,
      )

      expect(consumer.stop).not.toHaveBeenCalled()
      expect(consumers.has('sess-8')).toBe(true)
    })
  })
})
