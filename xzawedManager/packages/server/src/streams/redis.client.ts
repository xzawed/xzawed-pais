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

export async function closeRedisClients(): Promise<void> {
  await Promise.all([...clients.values()].map((c) => c.quit()))
  clients.clear()
}
