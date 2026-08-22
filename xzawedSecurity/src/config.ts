import { makeAgentConfig, type AgentConfig } from '@xzawed/agent-streams'

export type Config = AgentConfig
export const { loadConfig } = makeAgentConfig(3008)
