import type { Task, TaskStatus } from './task.js'

export class TaskStore {
  private readonly tasks = new Map<string, Task>()
  private readonly bySession = new Map<string, Set<string>>()

  create(sessionId: string, intent: string): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      sessionId,
      status: 'pending',
      intent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.tasks.set(task.id, task)
    const ids = this.bySession.get(sessionId) ?? new Set<string>()
    ids.add(task.id)
    this.bySession.set(sessionId, ids)
    return task
  }

  update(taskId: string, status: TaskStatus, result?: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = status
    task.updatedAt = Date.now()
    if (result !== undefined) task.result = result
  }

  findBySessionId(sessionId: string): Task[] {
    const ids = this.bySession.get(sessionId) ?? new Set<string>()
    return Array.from(ids)
      .map(id => this.tasks.get(id))
      .filter((t): t is Task => t !== undefined)
  }

  deleteBySessionId(sessionId: string): void {
    const ids = this.bySession.get(sessionId) ?? new Set<string>()
    for (const id of ids) this.tasks.delete(id)
    this.bySession.delete(sessionId)
  }
}
