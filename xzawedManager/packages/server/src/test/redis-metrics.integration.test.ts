import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Redis } from 'ioredis'
import { collectDlqMetrics, collectPelMetrics } from '../observability/redis-metrics.js'

const url = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL']
const d = url ? describe : describe.skip

/**
 * **실 Redis 로 재는 것이 이 슬라이스의 핵심이다**(S3.3).
 *
 * 유닛은 목의 SCAN 흉내를 검증할 뿐이다. "고정 키 목록으로는 못 잰다"는 전제가 참인지는
 * 실제 키스페이스를 훑어야만 알 수 있다 — per-session 스트림을 여러 개 만들어 확인한다.
 */
d('Redis 지표 수집 (실 Redis)', () => {
  let redis: Redis
  let baseDlq = { streams: 0, total: 0 }
  let basePel = { groups: 0, total: 0 }
  const P = 'itest:metrics:'

  beforeAll(async () => {
    redis = new Redis(url!, { maxRetriesPerRequest: 2 })
    // **델타로 단언한다.** 이 Redis 는 다른 것과 공유될 수 있고(전 서비스가 한 Redis 를 쓴다)
    // `top` 은 상위 N 이라 바쁜 키스페이스에서는 내 스트림이 밀려난다 — 절대값으로 단언하면
    // 코드가 맞아도 깨진다. 씨딩 전 기준선을 잡아 증가분만 본다.
    const d0 = await collectDlqMetrics(redis)
    const p0 = await collectPelMetrics(redis)
    baseDlq = { streams: d0.streams, total: d0.total }
    basePel = { groups: p0.groups, total: p0.total }
    // per-session DLQ 3개 — 고정 목록이 없다는 것이 요점.
    await redis.xadd(`${P}to-designer:s1:dlq`, '*', 'f', 'v')
    await redis.xadd(`${P}to-designer:s1:dlq`, '*', 'f', 'v')
    await redis.xadd(`${P}to-designer:s1:dlq`, '*', 'f', 'v')
    await redis.xadd(`${P}to-planner:s2:dlq`, '*', 'f', 'v')
    await redis.xadd(`${P}decomposition:main:dlq`, '*', 'f', 'v')
    // PEL: 그룹을 만들고 읽되 ack 하지 않아 pending 으로 남긴다.
    await redis.xadd(`${P}decomposition:main`, '*', 'f', 'v')
    await redis.xadd(`${P}decomposition:main`, '*', 'f', 'v')
    await redis.xgroup('CREATE', `${P}decomposition:main`, `${P}grp`, '0')
    await redis.xreadgroup('GROUP', `${P}grp`, 'c1', 'COUNT', 2, 'STREAMS', `${P}decomposition:main`, '>')
    // 스트림이 아닌 키도 섞는다 — SCAN 의 TYPE 필터가 거르는지 본다.
    await redis.set(`${P}not-a-stream`, 'v')
  })

  afterAll(async () => {
    const keys = await redis.keys(`${P}*`)
    if (keys.length > 0) await redis.del(...keys)
    await redis.quit()
  })

  /** 세 스트림을 만들었으니 셋 다 세어야 한다 — 하나만 재던 시절이면 증가분이 3 이 아니라 3(깊이)뿐이다. */
  it('여러 세션의 DLQ 를 전부 센다(하나만 재지 않는다)', async () => {
    const m = await collectDlqMetrics(redis)
    expect(m.streams - baseDlq.streams, 'DLQ 스트림 3개가 다 세어져야 한다').toBe(3)
    expect(m.total - baseDlq.total, '3+1+1 = 5').toBe(5)
  })

  it('소비자 그룹 PEL 깊이를 읽는다', async () => {
    const m = await collectPelMetrics(redis)
    expect(m.groups - basePel.groups).toBe(1)
    expect(m.total - basePel.total).toBe(2)
  })

  /** 상위 N 안에 들면 스트림 이름과 깊이가 그대로 나온다(키스페이스가 한산할 때). */
  it('스트림별 깊이를 이름과 함께 노출한다', async () => {
    const m = await collectDlqMetrics(redis)
    const mine = m.top.find((t) => t.stream === `${P}to-designer:s1:dlq`)
    if (m.truncated || m.streams > 20) return // 바쁜 키스페이스면 상위 N 밖으로 밀린다 — 위 델타가 본체다
    expect(mine?.depth).toBe(3)
  })

  /**
   * **SCAN 과 XLEN 사이의 경쟁**(Grok 반증).
   *
   * `TYPE stream` 필터는 SCAN 시점의 타입만 보장한다. 그 사이 키가 다른 타입으로 바뀌면
   * `XLEN` 이 WRONGTYPE 으로 throw 하는데, 그것을 위로 던지면 라우트가 통째로 잡아
   * `pais_redis_up 0` — Redis 는 멀쩡한데 "못 읽었다"는 거짓 — 을 내고 나머지 스트림의
   * 숫자도 같이 사라진다. 실 Redis 로 그 경쟁을 만들어 고정한다.
   */
  it('SCAN 이후 타입이 바뀐 키는 건너뛰되 나머지를 유지한다', async () => {
    const victim = `${P}race:victim:dlq`
    await redis.xadd(victim, '*', 'f', 'v')
    let flipped = false
    const racing = {
      scan: async (...a: Parameters<Redis['scan']>) => {
        const out = await (redis.scan as (...x: never[]) => Promise<[string, string[]]>)(...(a as never[]))
        if (!flipped) {
          flipped = true
          await redis.del(victim)
          await redis.set(victim, 'now-a-string')
        }
        return out
      },
      xlen: (k: string) => redis.xlen(k),
      xinfo: (sub: 'GROUPS', k: string) => redis.xinfo(sub, k) as Promise<unknown>,
    }
    const m = await collectDlqMetrics(racing)
    expect(m.errors, 'WRONGTYPE 를 세지 못했다').toBeGreaterThanOrEqual(1)
    expect(m.truncated, '일부를 못 봤는데 완전한 값인 척한다').toBe(true)
    // 핵심: 한 키 실패가 나머지를 날리지 않는다 — 씨딩한 3개 스트림은 그대로 보인다.
    expect(m.streams - baseDlq.streams).toBeGreaterThanOrEqual(3)
    await redis.del(victim)
  })

  it('스트림이 아닌 키는 훑지 않는다', async () => {
    const m = await collectPelMetrics(redis)
    expect(m.top.some((t) => t.stream === `${P}not-a-stream`)).toBe(false)
  })

  it('ack 하면 PEL 이 줄어든다(살아 있는 지표다)', async () => {
    const pendingBefore = (await collectPelMetrics(redis)).top.find((t) => t.stream === `${P}decomposition:main`)
    expect(pendingBefore?.pending).toBe(2)
    const entries = await redis.xrange(`${P}decomposition:main`, '-', '+')
    await redis.xack(`${P}decomposition:main`, `${P}grp`, entries[0]![0])
    const after = (await collectPelMetrics(redis)).top.find((t) => t.stream === `${P}decomposition:main`)
    expect(after?.pending).toBe(1)
  })
})
