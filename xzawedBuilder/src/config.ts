import { z } from 'zod'
import { baseAgentSchema, loadAgentConfig } from '@xzawed/agent-streams'

const ConfigSchema = baseAgentSchema(3006).extend({
  buildTimeoutMs: z.coerce.number().int().positive().default(120000),
})

export type Config = z.infer<typeof ConfigSchema>
export const loadConfig = loadAgentConfig(ConfigSchema, (e) => ({ buildTimeoutMs: e['BUILD_TIMEOUT_MS'] }))
