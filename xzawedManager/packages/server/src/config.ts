import { z } from 'zod'

const configSchema = z
  .object({
    ANTHROPIC_API_KEY: z.string().min(1),
    CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    PORT: z.coerce.number().default(3001),
    MODE: z.enum(['local', 'remote']).default('local'),
    SERVICE_JWT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    ORCHESTRATOR_URL: z.string().url().optional(),
    ORCHESTRATOR_SERVICE_TOKEN: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.SERVICE_JWT_SECRET !== undefined && val.SERVICE_JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SERVICE_JWT_SECRET'],
        message: 'SERVICE_JWT_SECRET must be at least 32 characters when provided',
      })
    }
  })

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  return configSchema.parse(process.env)
}
