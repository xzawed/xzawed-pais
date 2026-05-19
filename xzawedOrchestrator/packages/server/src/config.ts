import type { ClaudeMode } from '@xzawed/shared'

export interface Config {
  port: number
  mode: 'local' | 'remote'
  auth: 'none' | 'jwt'
  serviceJwtSecret?: string
  claudeMode: ClaudeMode
  anthropicApiKey?: string
  claudeModel: string
  remoteCLIUrl?: string
  remoteHost?: string
  remoteUser?: string
  remoteKeyPath?: string
  redisUrl: string
  managerUrl: string
  databaseUrl?: string
  userJwtSecret?: string
  serveWeb: boolean
  githubTokenKey?: string
}

export function loadConfig(): Config {
  const claudeMode = (process.env.CLAUDE_MODE ?? 'api') as ClaudeMode
  const auth = (process.env.AUTH ?? 'none') as 'none' | 'jwt'
  const serviceJwtSecret = process.env.SERVICE_JWT_SECRET

  if (claudeMode === 'api' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when CLAUDE_MODE=api. Set CLAUDE_MODE=cli to use Claude CLI subscription instead.')
  }

  if (claudeMode === 'remote' && !process.env.REMOTE_CLI_URL && !process.env.REMOTE_HOST) {
    throw new Error('REMOTE_CLI_URL or REMOTE_HOST is required when CLAUDE_MODE=remote')
  }

  if (auth === 'jwt' && (!serviceJwtSecret || serviceJwtSecret.length < 32)) {
    throw new Error('SERVICE_JWT_SECRET must be at least 32 characters when AUTH=jwt')
  }

  return {
    port: Number.parseInt(process.env.PORT ?? '3000', 10),
    mode: (process.env.MODE ?? 'local') as 'local' | 'remote',
    auth,
    serviceJwtSecret,
    claudeMode,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    claudeModel: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    remoteCLIUrl: process.env.REMOTE_CLI_URL,
    remoteHost: process.env.REMOTE_HOST,
    remoteUser: process.env.REMOTE_USER,
    remoteKeyPath: process.env.REMOTE_KEY_PATH,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    managerUrl: process.env.MANAGER_URL ?? 'http://localhost:3001',
    databaseUrl: process.env.DATABASE_URL,
    userJwtSecret: process.env.USER_JWT_SECRET,
    serveWeb: process.env.SERVE_WEB === 'true',
    githubTokenKey: process.env.GITHUB_TOKEN_ENCRYPTION_KEY,
  }
}
