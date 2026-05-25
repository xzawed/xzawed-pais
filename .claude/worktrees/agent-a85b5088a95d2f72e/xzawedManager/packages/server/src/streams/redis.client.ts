import { Redis } from 'ioredis'

let client: Redis | null = null

export function getRedisClient(url: string): Redis {
  if (!client) {
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 })
  }
  return client
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    try { await client.quit() } catch { /* already disconnected */ } finally { client = null }
  }
}
