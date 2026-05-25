import { z } from 'zod'

const ConfigSchema = z.object({
  redisUrl: z.string().default('redis://localhost:6379'),
  port: z.coerce.number().int().positive().default(3007),
  mode: z.enum(['local', 'remote']).default('local'),
  workspaceRoot: z.string().min(1),
  maxWatchers: z.coerce.number().int().positive().default(10),
  debounceMs: z.coerce.number().int().nonnegative().default(300),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse({
    redisUrl: env.REDIS_URL,
    port: env.PORT,
    mode: env.MODE,
    workspaceRoot: env.WORKSPACE_ROOT,
    maxWatchers: env.MAX_WATCHERS,
    debounceMs: env.DEBOUNCE_MS,
  })
}
