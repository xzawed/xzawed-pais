import { Redis } from 'ioredis'

const clients = new Map<string, Redis>()
/** createRedisClient로 만든 비공유 연결 — closeRedisClients가 함께 quit(누수 방지). */
const dedicated = new Set<Redis>()

function newRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 2000, retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined })
}

/** 새 Redis 연결 생성(비공유·전용). 블로킹 소비자처럼 전용 연결이 필요한 곳에서 사용. closeRedisClients가 정리. */
export function createRedisClient(url: string): Redis {
  const client = newRedis(url)
  dedicated.add(client)
  return client
}

export function getRedisClient(url: string): Redis {
  let client = clients.get(url)
  if (!client) {
    client = newRedis(url)
    clients.set(url, client)
  }
  return client
}

/** 관측 전용(readiness·/metrics) 연결 — 공유 클라이언트와 절대 섞이지 않는다. */
const probes = new Map<string, Redis>()

/**
 * **readiness·`/metrics` 전용 연결**(S4.3 실측으로 드러난 결함).
 *
 * 공유 클라이언트(`getRedisClient`)는 `StreamConsumer` 가 `XREADGROUP ... BLOCK 2000` 으로
 * 점유한다. ioredis 는 한 연결에서 명령을 **직렬화**하므로, 그 위에서 `ping()` 을 치면 블록이
 * 풀릴 때까지 큐에 선다 — readiness 예산(1000ms)보다 블록(2000ms)이 길어 **항상** 초과한다.
 *
 * 증상은 조용하고 치명적이었다. 세션이 하나도 없을 때는 `/health/ready` 가 200 이다가
 * **첫 세션이 생기는 순간 영구 503** 이 된다(실측: 재시작 직후 6/6 → 세션 1개 후 0/6).
 * compose healthcheck 는 30초 간격·3회라 첫 대화 ~90초 뒤 Manager 컨테이너가 unhealthy 로
 * 뒤집히고, Launcher 는 `Health === 'healthy'` 로 `running` 을 판정한다 — **정상 동작 중인
 * 스택이 "죽었다"고 보고된다.** 컨테이너 스택을 실제로 띄우는 검사가 없어 아무도 못 봤다.
 *
 * **probe 를 전용 연결로 옮기는 것이 의미론적으로도 옳다.** readiness 가 물어야 하는 것은
 * "Redis 가 닿는가"이지 "공유 연결이 지금 한가한가"가 아니다. 소비 루프가 실제로 도는지는
 * `loopProbe` 가 따로 본다 — 두 질문을 한 연결에 겹쳐 물으면 둘 다 못 믿게 된다.
 */
export function getProbeRedisClient(url: string): Redis {
  let client = probes.get(url)
  if (!client) {
    client = newRedis(url)
    probes.set(url, client)
  }
  return client
}

export async function closeRedisClients(): Promise<void> {
  await Promise.all([...clients.values(), ...probes.values(), ...dedicated].map((c) => c.quit()))
  clients.clear()
  probes.clear()
  dedicated.clear()
}
