import type { Config } from '../config.js'
import type { ClaudeRunner } from './runner.interface.js'
import { CLIRunner } from './cli-runner.js'
import { APIRunner } from './api-runner.js'

export function createRunner(config: Config): ClaudeRunner {
  switch (config.claudeMode) {
    case 'api':
      return new APIRunner({
        apiKey: config.anthropicApiKey!,
        model: config.claudeModel,
      })
    case 'remote':
      // RemoteCLIRunner는 Plan 2에서 구현. 현재는 CLIRunner 폴백.
      return new CLIRunner()
    case 'cli':
    default:
      return new CLIRunner()
  }
}
