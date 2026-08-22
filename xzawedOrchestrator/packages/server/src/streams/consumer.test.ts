import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const xreadgroup = vi.fn()
const xgroup = vi.fn()
const xack = vi.fn()

vi.mock('./redis.client.js', () => ({
  getRedisClient: () => ({ xreadgroup, xgroup, xack }),
}))

const { StreamConsumer } = await import('./consumer.js')

/** 프로덕션 상수와 동일 — 어긋나면 이 테스트가 먼저 깨진다. */
const MAX_NOGROUP_RECOVERIES = 3

/** 블로킹 I/O mock은 macrotask를 양보해야 stop()이 관측된다(즉시 resolve는 이벤트 루프를 굶긴다). */
const yieldMacrotask = () => new Promise<void>((r) => setImmediate(r))

describe('StreamConsumer 소비 루프 복구', () => {
  beforeEach(() => {
    xreadgroup.mockReset()
    xgroup.mockReset().mockResolvedValue('OK')
    xack.mockReset().mockResolvedValue(1)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('읽기 실패가 반복되면 지수 백오프로 대기한다 — 백오프 없는 타이트 루프 금지', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => { delays.push(ms); await yieldMacrotask() }
    const consumer = new StreamConsumer('redis://x', sleep)

    let calls = 0
    xreadgroup.mockImplementation(async () => {
      await yieldMacrotask()
      if (++calls >= 4) consumer.stop()
      throw new Error('ECONNREFUSED')
    })

    await consumer.start('s1', async () => undefined)

    // 매 실패마다 대기가 끼어든다. stop()이 걸린 마지막 호출만 !running 가드로 즉시 반환한다.
    expect(delays.length).toBe(calls - 1)
    // 1s → 2s → 4s … 상한 30s. 단조 증가하며 상한을 넘지 않는다.
    expect(delays[0]).toBe(1_000)
    expect(delays[1]).toBe(2_000)
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_000)
  })

  it('백오프 상한은 30초를 넘지 않는다', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => { delays.push(ms); await yieldMacrotask() }
    const consumer = new StreamConsumer('redis://x', sleep)

    let calls = 0
    xreadgroup.mockImplementation(async () => {
      await yieldMacrotask()
      if (++calls >= 12) consumer.stop()
      throw new Error('boom')
    })

    await consumer.start('s1', async () => undefined)
    expect(Math.max(...delays)).toBe(30_000)
  })

  it('NOGROUP은 그룹을 재생성하고 대기 없이 재시도한다', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => { delays.push(ms); await yieldMacrotask() }
    const consumer = new StreamConsumer('redis://x', sleep)

    let calls = 0
    xreadgroup.mockImplementation(async () => {
      await yieldMacrotask()
      calls++
      if (calls === 1) throw new Error('NOGROUP No such consumer group')
      consumer.stop()
      return null
    })

    await consumer.start('s1', async () => undefined)

    // ensureGroup: start 진입 1회 + NOGROUP 복구 1회
    expect(xgroup).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([])
  })

  it('NOGROUP이 연속 상한을 넘으면 백오프로 강등된다 — 즉시재시도 무한루프 금지', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => { delays.push(ms); await yieldMacrotask() }
    const consumer = new StreamConsumer('redis://x', sleep)

    let calls = 0
    xreadgroup.mockImplementation(async () => {
      await yieldMacrotask()
      if (++calls >= 6) consumer.stop()
      throw new Error('NOGROUP No such consumer group')
    })

    await consumer.start('s1', async () => undefined)

    // 앞 3회는 즉시 재생성(대기 0), 이후는 백오프에 합류. 마지막 stop() 호출은 즉시 반환.
    expect(delays.length).toBe(calls - MAX_NOGROUP_RECOVERIES - 1)
    expect(delays[0]).toBe(1_000)
  })

  it('성공적으로 읽으면 백오프와 NOGROUP 카운터가 초기화된다', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => { delays.push(ms); await yieldMacrotask() }
    const consumer = new StreamConsumer('redis://x', sleep)

    let calls = 0
    xreadgroup.mockImplementation(async () => {
      await yieldMacrotask()
      calls++
      if (calls === 1 || calls === 2) throw new Error('boom')  // 1s, 2s
      if (calls === 3) return null                              // 성공 → 리셋
      if (calls === 4) throw new Error('boom')                  // 다시 1s여야 함
      consumer.stop()
      return null
    })

    await consumer.start('s1', async () => undefined)
    expect(delays).toEqual([1_000, 2_000, 1_000])
  })

  it('stop() 이후의 읽기 실패는 대기 없이 즉시 반환한다', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => { delays.push(ms); await yieldMacrotask() }
    const consumer = new StreamConsumer('redis://x', sleep)

    xreadgroup.mockImplementation(async () => {
      await yieldMacrotask()
      consumer.stop()
      throw new Error('shutdown')
    })

    await consumer.start('s1', async () => undefined)
    expect(delays).toEqual([])
  })
})
