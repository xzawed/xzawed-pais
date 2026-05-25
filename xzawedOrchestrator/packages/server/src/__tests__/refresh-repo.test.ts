import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { RefreshRepo } from '../auth/refresh.repo.js'

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const mockPoolQuery = vi.fn()
const mockPool = { query: mockPoolQuery } as unknown as Pool

const mockClientQuery = vi.fn()
const mockClient = { query: mockClientQuery } as unknown as PoolClient

describe('RefreshRepo', () => {
  let repo: RefreshRepo

  beforeEach(() => {
    repo = new RefreshRepo(mockPool)
    mockPoolQuery.mockReset()
    mockClientQuery.mockReset()
  })

  describe('create', () => {
    it('user-agent 포함하여 INSERT 실행', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })
      await repo.create('user-1', 'hash123', new Date('2030-01-01'), 'Mozilla/5.0')
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        ['user-1', 'hash123', expect.any(Date), 'Mozilla/5.0'],
      )
    })

    it('user-agent 없으면 null로 INSERT', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })
      await repo.create('user-1', 'hash123', new Date('2030-01-01'))
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO refresh_tokens'),
        ['user-1', 'hash123', expect.any(Date), null],
      )
    })
  })

  describe('findValid', () => {
    it('txClient 없이 pool 사용 — FOR UPDATE 없음', async () => {
      const token = 'plain-token'
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 'rt-1', user_id: 'user-1' }] })
      const result = await repo.findValid(token)
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.not.stringContaining('FOR UPDATE'),
        [sha256(token)],
      )
      expect(result).toEqual({ id: 'rt-1', userId: 'user-1' })
    })

    it('txClient 전달 시 client.query 사용 — FOR UPDATE 포함', async () => {
      const token = 'tx-token'
      mockClientQuery.mockResolvedValueOnce({ rows: [{ id: 'rt-2', user_id: 'user-2' }] })
      const result = await repo.findValid(token, mockClient)
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE'),
        [sha256(token)],
      )
      expect(mockPoolQuery).not.toHaveBeenCalled()
      expect(result).toEqual({ id: 'rt-2', userId: 'user-2' })
    })

    it('일치하는 토큰 없으면 undefined 반환 (pool)', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })
      const result = await repo.findValid('no-match')
      expect(result).toBeUndefined()
    })

    it('일치하는 토큰 없으면 undefined 반환 (txClient)', async () => {
      mockClientQuery.mockResolvedValueOnce({ rows: [] })
      const result = await repo.findValid('no-match', mockClient)
      expect(result).toBeUndefined()
    })
  })

  describe('revoke', () => {
    it('id로 단건 revoke', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })
      await repo.revoke('rt-1')
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('revoked_at = NOW()'),
        ['rt-1'],
      )
    })
  })

  describe('revokeAllForUser', () => {
    it('userId로 전체 revoke', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] })
      await repo.revokeAllForUser('user-1')
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('user_id = $1'),
        ['user-1'],
      )
    })
  })
})
