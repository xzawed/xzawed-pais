import { describe, it, expect } from 'vitest'
import { TaskStore } from './task.store.js'

describe('TaskStore', () => {
  it('creates task with pending status', () => {
    const store = new TaskStore()
    const task = store.create('session-1', 'Build a REST API')
    expect(task.sessionId).toBe('session-1')
    expect(task.status).toBe('pending')
    expect(task.intent).toBe('Build a REST API')
    expect(typeof task.id).toBe('string')
    expect(task.createdAt).toBeGreaterThan(0)
  })

  it('findBySessionId returns only tasks for that session', () => {
    const store = new TaskStore()
    store.create('session-1', 'Task A')
    store.create('session-1', 'Task B')
    store.create('session-2', 'Task C')
    const tasks = store.findBySessionId('session-1')
    expect(tasks).toHaveLength(2)
    expect(tasks.every(t => t.sessionId === 'session-1')).toBe(true)
  })

  it('update changes status and result', () => {
    const store = new TaskStore()
    const task = store.create('session-1', 'intent text')
    store.update(task.id, 'completed', 'build succeeded')
    const updated = store.findBySessionId('session-1').find(t => t.id === task.id)!
    expect(updated.status).toBe('completed')
    expect(updated.result).toBe('build succeeded')
  })

  it('update sets running status without result', () => {
    const store = new TaskStore()
    const task = store.create('session-1', 'intent text')
    store.update(task.id, 'running')
    const updated = store.findBySessionId('session-1').find(t => t.id === task.id)!
    expect(updated.status).toBe('running')
    expect(updated.result).toBeUndefined()
  })

  it('update ignores unknown taskId', () => {
    const store = new TaskStore()
    expect(() => store.update('nonexistent', 'completed')).not.toThrow()
  })

  it('findBySessionId returns empty array for unknown session', () => {
    const store = new TaskStore()
    expect(store.findBySessionId('unknown')).toEqual([])
  })

  it('deleteBySessionId removes all tasks for session', () => {
    const store = new TaskStore()
    store.create('session-1', 'Task A')
    store.create('session-1', 'Task B')
    store.create('session-2', 'Task C')
    store.deleteBySessionId('session-1')
    expect(store.findBySessionId('session-1')).toHaveLength(0)
    expect(store.findBySessionId('session-2')).toHaveLength(1)
  })
})

describe('TaskStore 상태 전이 가드', () => {
  it('completed → running 전이를 무시한다', () => {
    const store = new TaskStore()
    const task = store.create('sess-1', 'intent')
    store.update(task.id, 'running')
    store.update(task.id, 'completed', 'done')
    store.update(task.id, 'running') // 무시되어야 함
    expect(store.findBySessionId('sess-1')[0]?.status).toBe('completed')
  })

  it('failed → pending 전이를 무시한다', () => {
    const store = new TaskStore()
    const task = store.create('sess-1', 'intent')
    store.update(task.id, 'failed')
    store.update(task.id, 'pending') // 무시되어야 함
    expect(store.findBySessionId('sess-1')[0]?.status).toBe('failed')
  })

  it('completed → failed 전이를 무시한다', () => {
    const store = new TaskStore()
    const task = store.create('sess-1', 'intent')
    store.update(task.id, 'completed')
    store.update(task.id, 'failed') // 무시되어야 함
    expect(store.findBySessionId('sess-1')[0]?.status).toBe('completed')
  })

  it('pending → completed 정방향은 허용된다', () => {
    const store = new TaskStore()
    const task = store.create('sess-1', 'intent')
    store.update(task.id, 'completed', 'result')
    expect(store.findBySessionId('sess-1')[0]?.status).toBe('completed')
    expect(store.findBySessionId('sess-1')[0]?.result).toBe('result')
  })
})
