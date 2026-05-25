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
