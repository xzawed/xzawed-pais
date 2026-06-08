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

export async function closeRedisClients(): Promise<void> {
  await Promise.all([...clients.values(), ...dedicated].map((c) => c.quit()))
  clients.clear()
  dedicated.clear()
}
