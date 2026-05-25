import { Redis } from 'ioredis'

const clients = new Map<string, Redis>()

export function getRedisClient(url: string): Redis {
  let client = clients.get(url)
  if (!client) {
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 2000 })
    clients.set(url, client)
  }
  return client
}

export async function closeRedisClients(): Promise<void> {
  for (const c of clients.values()) {
    try { await c.quit() } catch (e) { console.warn('[redis] client quit failed:', e) }
  }
  clients.clear()
}

/** @deprecated Use closeRedisClients() */
export async function closeRedisClient(): Promise<void> {
  return closeRedisClients()
}
