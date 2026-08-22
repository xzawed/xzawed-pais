import { z } from 'zod'
import { baseAgentSchema, baseAgentEnv } from '@xzawed/agent-streams'

const ConfigSchema = baseAgentSchema(3005).extend({
  testTimeoutMs: z.coerce.number().int().positive().default(60_000),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse({
    ...baseAgentEnv(env),
    testTimeoutMs: env['TEST_TIMEOUT_MS'],
  })
}
