import { z } from 'zod'

const configSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3001),
  MODE: z.enum(['local', 'remote']).default('local'),
  SERVICE_JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  return configSchema.parse(process.env)
}
