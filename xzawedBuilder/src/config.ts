import { z } from 'zod'
import { baseAgentSchema, baseAgentEnv } from '@xzawed/agent-streams'

const ConfigSchema = baseAgentSchema(3006).extend({
  buildTimeoutMs: z.coerce.number().int().positive().default(120000),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse({
    ...baseAgentEnv(env),
    buildTimeoutMs: env['BUILD_TIMEOUT_MS'],
  })
}
