import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SESSION_STREAM_TTL_SEC,
  expireSessionStreams,
  persistSessionStreams,
  managerSessionStreamKeys,
} from './session-keys.js'

function fakeRedis() {
  return {
    expire: vi.fn().mockResolvedValue(1),
    persist: vi.fn().mockResolvedValue(1),
  }
}

describe('managerSessionStreamKeys', () => {
  it('세션마다 생기는 Manager 소유 키 3종을 준다', () => {
    expect(managerSessionStreamKeys('s1')).toEqual([
      'orchestrator:to-manager:s1',
      'manager:to-orchestrator:s1',
      'manager:events:s1',
    ])
  })
})

describe('expireSessionStreams', () => {
  let redis: ReturnType<typeof fakeRedis>
  beforeEach(() => { redis = fakeRedis() })

  it('모든 키에 기본 TTL 을 건다', async () => {
    await expireSessionStreams(redis, ['a', 'b'])
    expect(redis.expire).toHaveBeenCalledTimes(2)
    expect(redis.expire).toHaveBeenCalledWith('a', SESSION_STREAM_TTL_SEC)
    expect(redis.expire).toHaveBeenCalledWith('b', SESSION_STREAM_TTL_SEC)
  })

  it('TTL 을 명시하면 그 값을 쓴다', async () => {
    await expireSessionStreams(redis, ['a'], 42)
    expect(redis.expire).toHaveBeenCalledWith('a', 42)
  })

  /**
   * 정리 경로는 절대 throw 하지 않는다 — 저장소 관례. 회수가 실패하면 자원이 새지만
   * 세션 종료 자체는 계속돼야 한다(throw 하면 `finally` 밖으로 튀어 종료가 깨진다).
   */
  it('한 키가 실패해도 throw 하지 않고 나머지를 계속한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    redis.expire.mockRejectedValueOnce(new Error('redis down'))
    await expect(expireSessionStreams(redis, ['a', 'b'])).resolves.toBeUndefined()
    expect(redis.expire).toHaveBeenCalledTimes(2)
  })

  it('키가 없으면 아무것도 부르지 않는다', async () => {
    await expireSessionStreams(redis, [])
    expect(redis.expire).not.toHaveBeenCalled()
  })
})

describe('persistSessionStreams', () => {
  let redis: ReturnType<typeof fakeRedis>
  beforeEach(() => { redis = fakeRedis() })

  it('모든 키의 TTL 을 벗긴다', async () => {
    await persistSessionStreams(redis, ['a', 'b'])
    expect(redis.persist).toHaveBeenCalledTimes(2)
    expect(redis.persist).toHaveBeenCalledWith('a')
    expect(redis.persist).toHaveBeenCalledWith('b')
  })

  it('실패해도 throw 하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    redis.persist.mockRejectedValue(new Error('redis down'))
    await expect(persistSessionStreams(redis, ['a'])).resolves.toBeUndefined()
  })
})
