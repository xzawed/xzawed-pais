import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { PgSessionStore } from '../pg-session.store.js'

function makePool(rows: unknown[] = []): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pool
}

const BASE_ROW = {
  id: 'sess-1',
  user_id: 'user-1',
  project_id: 'proj-1',
  claude_mode: 'api',
  claude_session_id: null,
  state: 'active',
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
}

describe('PgSessionStore', () => {
  let pool: Pool
  let store: PgSessionStore

  beforeEach(() => {
    pool = makePool([BASE_ROW])
    store = new PgSessionStore(pool)
  })

  it('create() — Pool.query를 호출하고 Session을 반환한다', async () => {
    const session = await store.create('user-1', 'proj-1', 'api')
    expect(pool.query).toHaveBeenCalledOnce()
    expect(session.id).toBe('sess-1')
    expect(session.userId).toBe('user-1')
    expect(session.projectId).toBe('proj-1')
    expect(session.claudeMode).toBe('api')
    expect(session.state).toBe('active')
  })

  it('create() — rows가 비어있으면 throw한다', async () => {
    pool = makePool([])
    store = new PgSessionStore(pool)
    await expect(store.create('u', null, 'api')).rejects.toThrow('Failed to create session')
  })

  it('findById() — 존재하는 세션을 반환한다', async () => {
    const session = await store.findById('sess-1')
    expect(session).toBeDefined()
    expect(session!.id).toBe('sess-1')
  })

  it('findById() — 없는 세션에 undefined를 반환한다', async () => {
    pool = makePool([])
    store = new PgSessionStore(pool)
    const session = await store.findById('nonexistent')
    expect(session).toBeUndefined()
  })

  it('updateState() — Pool.query를 올바른 파라미터로 호출한다', async () => {
    pool = makePool([])
    store = new PgSessionStore(pool)
    await store.updateState('sess-1', 'completed')
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sessions'),
      ['sess-1', 'completed']
    )
  })

  it('updateClaudeSessionId() — Pool.query를 호출한다', async () => {
    pool = makePool([])
    store = new PgSessionStore(pool)
    await store.updateClaudeSessionId('sess-1', 'claude-sess-abc')
    expect(pool.query).toHaveBeenCalledOnce()
  })

  it('updateProject() — Pool.query를 호출한다', async () => {
    pool = makePool([])
    store = new PgSessionStore(pool)
    await store.updateProject('sess-1', 'proj-2')
    expect(pool.query).toHaveBeenCalledOnce()
  })

  it('delete() — Pool.query를 올바른 파라미터로 호출한다', async () => {
    pool = makePool([])
    store = new PgSessionStore(pool)
    await store.delete('sess-1')
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['sess-1']
    )
  })

  it('create() — projectId가 null이어도 정상 동작한다', async () => {
    const session = await store.create('user-x', null, 'cli')
    expect(session).toBeDefined()
  })

  it('create() — claudeMode가 Session에 정확히 매핑된다', async () => {
    const cliBASE_ROW = { ...BASE_ROW, claude_mode: 'cli' }
    pool = makePool([cliBASE_ROW])
    store = new PgSessionStore(pool)
    const session = await store.create('u', null, 'cli')
    expect(session.claudeMode).toBe('cli')
  })
})
