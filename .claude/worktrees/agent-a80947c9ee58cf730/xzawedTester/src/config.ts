import { z } from 'zod'

const ConfigSchema = z.object({
  anthropicApiKey: z.string().min(1),
  claudeModel: z.string().default('claude-sonnet-4-6'),
  redisUrl: z.string().default('redis://localhost:6379'),
  port: z.coerce.number().int().positive().default(3005),
  mode: z.enum(['local', 'remote']).default('local'),
  workspaceRoot: z.string().min(1),
  testTimeoutMs: z.coerce.number().int().positive().default(60_000),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse({
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    claudeModel: env.CLAUDE_MODEL,
    redisUrl: env.REDIS_URL,
    port: env.PORT,
    mode: env.MODE,
    workspaceRoot: env.WORKSPACE_ROOT,
    testTimeoutMs: env.TEST_TIMEOUT_MS,
  })
}
