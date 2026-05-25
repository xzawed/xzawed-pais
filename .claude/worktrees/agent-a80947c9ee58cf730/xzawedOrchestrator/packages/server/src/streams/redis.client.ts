import { Redis } from 'ioredis'

let client: Redis | null = null

export function getRedisClient(url: string): Redis {
  if (!client) {
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 })
  }
  return client
}

export async function closeRedisClient(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
  }
}
