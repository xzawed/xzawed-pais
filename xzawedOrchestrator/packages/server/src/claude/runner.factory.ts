import type { Config } from '../config.js'
import type { ClaudeRunner } from './runner.interface.js'
import { CLIRunner } from './cli-runner.js'
import { APIRunner } from './api-runner.js'
import { HTTPRemoteRunner } from './http-remote-runner.js'
import { SSHRemoteRunner } from './ssh-remote-runner.js'

export function createRunner(config: Config): ClaudeRunner {
  switch (config.claudeMode) {
    case 'api':
      return new APIRunner({
        apiKey: config.anthropicApiKey!,
        model: config.claudeModel,
      })
    case 'remote':
      if (config.remoteCLIUrl) {
        return new HTTPRemoteRunner(config.remoteCLIUrl)
      }
      return new SSHRemoteRunner(
        config.remoteHost!,
        config.remoteUser!,
        config.remoteKeyPath!,
      )
    case 'cli':
    default:
      return new CLIRunner()
  }
}
