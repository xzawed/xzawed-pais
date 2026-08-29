import { describe, it, expect, vi, afterEach } from 'vitest'
import { getRedisClient, getProbeRedisClient, createRedisClient, closeRedisClients } from './redis.client.js'

/**
 * **probe 연결은 공유 연결과 섞이면 안 된다**(S4.3 실측으로 드러난 결함).
 *
 * 공유 클라이언트는 `StreamConsumer` 가 `XREADGROUP ... BLOCK 2000` 으로 점유한다. ioredis 는
 * 한 연결에서 명령을 **직렬화**하므로 그 위에서 `ping()` 을 치면 블록이 풀릴 때까지 큐에 서고,
 * readiness 예산(1000ms)보다 블록(2000ms)이 길어 **항상** 초과한다.
 *
 * 증상: 세션이 없을 때는 `/health/ready` 200 이다가 **첫 세션이 생기는 순간 영구 503**.
 * 실 compose 스택 실측 — 재시작 직후 6/6 → 세션 1개 후 0/6, 수정 후 세션 2개에도 10/10.
 * 컨테이너를 실제로 띄우는 검사가 없어 아무도 못 봤다.
 */
describe('redis.client — probe 연결 분리', () => {
  afterEach(async () => { await closeRedisClients().catch(() => undefined) })

  it('probe 클라이언트는 공유 클라이언트와 다른 인스턴스다', () => {
    const url = 'redis://127.0.0.1:6399'
    const shared = getRedisClient(url)
    const probe = getProbeRedisClient(url)
    expect(probe, '같은 연결이면 블로킹 소비 뒤에 ping 이 큐잉된다').not.toBe(shared)
  })

  it('probe 클라이언트는 URL 별로 캐시된다(요청마다 새 연결을 열지 않는다)', () => {
    const url = 'redis://127.0.0.1:6399'
    expect(getProbeRedisClient(url)).toBe(getProbeRedisClient(url))
  })

  it('URL 이 다르면 다른 probe 연결이다', () => {
    expect(getProbeRedisClient('redis://127.0.0.1:6399')).not.toBe(getProbeRedisClient('redis://127.0.0.1:6400'))
  })

  it('공유 클라이언트는 여전히 URL 별 단일 인스턴스다(회귀 0)', () => {
    const url = 'redis://127.0.0.1:6399'
    expect(getRedisClient(url)).toBe(getRedisClient(url))
  })

  it('전용 클라이언트는 호출마다 새 인스턴스다(블로킹 소비자용)', () => {
    const url = 'redis://127.0.0.1:6399'
    expect(createRedisClient(url)).not.toBe(createRedisClient(url))
  })

  /** 정리에서 빠지면 연결이 누수돼 테스트·프로세스가 안 끝난다. */
  it('closeRedisClients 가 probe 연결도 quit 한다', async () => {
    const url = 'redis://127.0.0.1:6399'
    const probe = getProbeRedisClient(url)
    const quit = vi.spyOn(probe, 'quit').mockResolvedValue('OK')
    await closeRedisClients()
    expect(quit, 'probe 연결이 정리 대상에서 빠졌다').toHaveBeenCalled()
  })
})

/**
 * **전용 연결 회수.** 세션마다 `createRedisClient` 로 소켓이 생기므로 세션 종료 시
 * 되돌려야 한다 — 안 그러면 `dedicated` Set 과 실제 연결이 세션 수만큼 쌓인다.
 * (실측: 활성 세션 12개일 때 Manager 가 Redis 연결 15개를 보유했다.)
 */
describe('releaseRedisClient — 전용 연결 회수', () => {
  afterEach(async () => { await closeRedisClients().catch(() => undefined) })

  it('quit 을 부르고 dedicated 추적에서 뺀다', async () => {
    const { releaseRedisClient } = await import('./redis.client.js')
    const c = createRedisClient('redis://127.0.0.1:6399')
    const quit = vi.spyOn(c, 'quit').mockResolvedValue('OK')

    await releaseRedisClient(c)
    expect(quit).toHaveBeenCalledTimes(1)

    // 이미 회수했으므로 closeRedisClients 가 다시 quit 하지 않는다(이중 quit 방지).
    await closeRedisClients()
    expect(quit).toHaveBeenCalledTimes(1)
  })

  /** 정리 경로는 절대 throw 하지 않는다 — 세션 종료가 회수 실패로 멈추면 안 된다. */
  it('quit 이 실패해도 throw 하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { releaseRedisClient } = await import('./redis.client.js')
    const c = createRedisClient('redis://127.0.0.1:6399')
    vi.spyOn(c, 'quit').mockRejectedValue(new Error('connection lost'))

    await expect(releaseRedisClient(c)).resolves.toBeUndefined()
  })

  /** 블로킹 소비자는 서로 다른 소켓을 받아야 한다 — 공유하면 XGROUP CREATE 가 뒤에 줄 선다. */
  it('createRedisClient 는 호출마다 새 인스턴스를 준다', () => {
    const url = 'redis://127.0.0.1:6399'
    expect(createRedisClient(url)).not.toBe(createRedisClient(url))
  })
})
