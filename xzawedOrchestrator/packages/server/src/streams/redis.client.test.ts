import { describe, it, expect, vi, afterEach } from 'vitest'
import { getRedisClient, getProbeRedisClient, closeRedisClients } from './redis.client.js'

/**
 * **probe 연결은 공유 연결과 섞이면 안 된다**(S4.3 실측 — Manager 와 같은 결함이 여기에도 있었다).
 *
 * 공유 클라이언트는 `StreamConsumer` 가 `XREADGROUP ... BLOCK 2000`(`consumer.ts:114`)으로
 * 점유한다. ioredis 는 한 연결에서 명령을 직렬화하므로 그 위의 `ping()` 은 블록이 풀릴 때까지
 * 큐에 서고, readiness 예산(1000ms)보다 블록(2000ms)이 길어 **항상** 초과한다.
 *
 * 실 compose 스택 실측: 세션 0개일 때 `/health/ready` 200 → 첫 세션 이후 영구 503.
 */
describe('redis.client — probe 연결 분리', () => {
  afterEach(async () => { await closeRedisClients().catch(() => undefined) })

  it('probe 클라이언트는 공유 클라이언트와 다른 인스턴스다', () => {
    const url = 'redis://127.0.0.1:6399'
    expect(getProbeRedisClient(url), '같은 연결이면 블로킹 소비 뒤에 ping 이 큐잉된다')
      .not.toBe(getRedisClient(url))
  })

  it('probe 클라이언트는 URL 별로 캐시된다(요청마다 새 연결을 열지 않는다)', () => {
    const url = 'redis://127.0.0.1:6399'
    expect(getProbeRedisClient(url)).toBe(getProbeRedisClient(url))
  })

  it('공유 클라이언트는 여전히 URL 별 단일 인스턴스다(회귀 0)', () => {
    const url = 'redis://127.0.0.1:6399'
    expect(getRedisClient(url)).toBe(getRedisClient(url))
  })

  /** 정리에서 빠지면 연결이 누수돼 프로세스가 안 끝난다. */
  it('closeRedisClients 가 probe 연결도 quit 한다', async () => {
    const probe = getProbeRedisClient('redis://127.0.0.1:6399')
    const quit = vi.spyOn(probe, 'quit').mockResolvedValue('OK')
    await closeRedisClients()
    expect(quit, 'probe 연결이 정리 대상에서 빠졌다').toHaveBeenCalled()
  })
})
