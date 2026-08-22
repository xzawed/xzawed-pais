import { z } from 'zod'
import { baseAgentSchema, loadAgentConfig } from '@xzawed/agent-streams'

const ConfigSchema = baseAgentSchema(3005).extend({
  testTimeoutMs: z.coerce.number().int().positive().default(60_000),
})

export type Config = z.infer<typeof ConfigSchema>
export const loadConfig = loadAgentConfig(ConfigSchema, (e) => ({ testTimeoutMs: e['TEST_TIMEOUT_MS'] }))
