import { describe, it, expect } from 'vitest'
import { TaskStore } from '../tasks/task.store.js'

describe('동시 메시지 저장 (messageStore race condition 회귀)', () => {
  it('두 메시지를 순차로 push하면 배열에 모두 포함된다', () => {
    const messageStore = new Map<string, unknown[]>()
    const sessionId = 'sess-concurrent'
    messageStore.set(sessionId, [])

    const pushMessage = (content: string) => {
      const history = messageStore.get(sessionId) ?? []
      history.push({ role: 'user', content })
      messageStore.set(sessionId, history)
      return [...history]
    }

    const snapshot1 = pushMessage('msg-1')
    const snapshot2 = pushMessage('msg-2')

    const final = messageStore.get(sessionId)!
    expect(final).toHaveLength(2)
    expect(final.map((m) => (m as { content: string }).content)).toContain('msg-1')
    expect(final.map((m) => (m as { content: string }).content)).toContain('msg-2')

    expect(snapshot1).toHaveLength(1)
    expect(snapshot2).toHaveLength(2)
  })

  it('TaskStore.findBySessionId는 여러 태스크를 순서대로 반환한다', () => {
    const taskStore = new TaskStore()
    taskStore.create('sess-1', 'intent-1')
    taskStore.create('sess-1', 'intent-2')
    const tasks = taskStore.findBySessionId('sess-1')
    expect(tasks).toHaveLength(2)
    const active = tasks.findLast(
      (t) => t.status === 'pending' || t.status === 'running',
    )
    expect(active?.intent).toBe('intent-2')
  })
})
