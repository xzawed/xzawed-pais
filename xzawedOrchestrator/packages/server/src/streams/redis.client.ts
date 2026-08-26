import { Redis } from 'ioredis'

const clients = new Map<string, Redis>()

export function getRedisClient(url: string): Redis {
  let client = clients.get(url)
  if (!client) {
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 2000, retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined })
    clients.set(url, client)
  }
  return client
}

/** 관측 전용(readiness) 연결 — 공유 클라이언트와 절대 섞이지 않는다. */
const probes = new Map<string, Redis>()

/**
 * **readiness 전용 연결**(S4.3 실측으로 드러난 결함 — Manager 와 같은 것이 여기에도 있었다).
 *
 * 공유 클라이언트(`getRedisClient`)는 `StreamConsumer` 가 `XREADGROUP ... BLOCK 2000`
 * (`consumer.ts:114`)으로 점유한다. ioredis 는 한 연결에서 명령을 **직렬화**하므로 그 위에서
 * `ping()` 을 치면 블록이 풀릴 때까지 큐에 서고, readiness 예산(1000ms)보다 블록(2000ms)이
 * 길어 **항상** 초과한다.
 *
 * 증상은 조용하고 치명적이었다. 세션이 없을 때는 `/health/ready` 200 이다가 **첫 세션이
 * 생기는 순간 영구 503** 이 된다. compose healthcheck 는 30초 간격·3회라 첫 대화 ~90초 뒤
 * 컨테이너가 unhealthy 로 뒤집히고, Launcher 는 `Health === 'healthy'` 로 `running` 을
 * 판정한다 — **정상 동작 중인 스택이 "죽었다"고 보고된다.**
 *
 * readiness 가 물어야 하는 것은 "Redis 가 닿는가"이지 "공유 연결이 지금 한가한가"가 아니다.
 * 소비 루프가 실제로 도는지는 `loopProbe` 가 따로 본다.
 */
export function getProbeRedisClient(url: string): Redis {
  let client = probes.get(url)
  if (!client) {
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 2000, retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined })
    probes.set(url, client)
  }
  return client
}

export async function closeRedisClients(): Promise<void> {
  for (const c of [...clients.values(), ...probes.values()]) {
    try { await c.quit() } catch (e) { console.warn('[redis] client quit failed:', e) }
  }
  clients.clear()
  probes.clear()
}
