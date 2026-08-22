import { z } from 'zod'
import { baseAgentSchema, baseAgentEnv } from '@xzawed/agent-streams'

const ConfigSchema = baseAgentSchema(3003)

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return ConfigSchema.parse(baseAgentEnv(env))
}
