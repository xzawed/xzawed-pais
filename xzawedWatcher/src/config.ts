import { z } from 'zod'
import { baseAgentSchema, loadAgentConfig } from '@xzawed/agent-streams'

// Watcher는 Claude API를 쓰지 않아 anthropicApiKey·claudeModel이 불필요하다.
// 공통 스키마에서 그 둘을 빼는 것으로 그 사실을 코드에 남긴다.
const ConfigSchema = baseAgentSchema(3007)
  .omit({ anthropicApiKey: true, claudeModel: true })
  .extend({
    maxWatchers: z.coerce.number().int().positive().default(10),
    debounceMs: z.coerce.number().int().nonnegative().default(300),
  })

export type Config = z.infer<typeof ConfigSchema>
export const loadConfig = loadAgentConfig(ConfigSchema, (e) => ({
  maxWatchers: e['MAX_WATCHERS'],
  debounceMs: e['DEBOUNCE_MS'],
}))
