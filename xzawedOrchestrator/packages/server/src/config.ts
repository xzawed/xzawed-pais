import { z } from 'zod'

const EnvSchema = z.object({
  PORT:                       z.string().default('3000'),
  MODE:                       z.enum(['local', 'remote']).default('local'),
  AUTH:                       z.enum(['none', 'jwt']).default('none'),
  CLAUDE_MODE:                z.enum(['api', 'cli', 'remote']).default('api'),
  CLAUDE_MODEL:               z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_API_KEY:          z.string().optional(),
  REDIS_URL:                  z.string().default('redis://localhost:6379'),
  SERVICE_JWT_SECRET:         z.string().optional(),
  USER_JWT_SECRET:            z.string().optional(),
  REMOTE_CLI_URL:             z.string().url().optional(),
  REMOTE_HOST:                z.string().optional(),
  REMOTE_USER:                z.string().optional(),
  REMOTE_KEY_PATH:            z.string().optional(),
  DATABASE_URL:               z.string().optional(),
  SERVE_WEB:                  z.string().optional(),
  GITHUB_TOKEN_ENCRYPTION_KEY: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.CLAUDE_MODE === 'api' && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'],
      message: 'ANTHROPIC_API_KEY is required when CLAUDE_MODE=api. Set CLAUDE_MODE=cli to use Claude CLI subscription instead.' })
  }
  if (env.CLAUDE_MODE === 'remote' && !env.REMOTE_CLI_URL && !env.REMOTE_HOST) {
    ctx.addIssue({ code: 'custom', path: ['REMOTE_CLI_URL'],
      message: 'REMOTE_CLI_URL or REMOTE_HOST is required when CLAUDE_MODE=remote' })
  }
  if (env.CLAUDE_MODE === 'remote' && !env.REMOTE_CLI_URL) {
    const missing = (['REMOTE_HOST', 'REMOTE_USER', 'REMOTE_KEY_PATH'] as const).filter(k => !env[k])
    if (missing.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['REMOTE_HOST'],
        message: `SSH mode requires: ${missing.join(', ')}` })
    }
  }
  if (env.AUTH === 'jwt' && (!env.SERVICE_JWT_SECRET || env.SERVICE_JWT_SECRET.length < 32)) {
    ctx.addIssue({ code: 'custom', path: ['SERVICE_JWT_SECRET'],
      message: 'SERVICE_JWT_SECRET must be at least 32 characters when AUTH=jwt' })
  }
  if (env.AUTH === 'jwt' && (!env.USER_JWT_SECRET || env.USER_JWT_SECRET.length < 32)) {
    ctx.addIssue({ code: 'custom', path: ['USER_JWT_SECRET'],
      message: 'USER_JWT_SECRET must be at least 32 characters when AUTH=jwt' })
  }
})

export interface Config {
  port: number
  mode: 'local' | 'remote'
  auth: 'none' | 'jwt'
  serviceJwtSecret?: string
  claudeMode: 'api' | 'cli' | 'remote'
  anthropicApiKey?: string
  claudeModel: string
  remoteCLIUrl?: string
  remoteHost?: string
  remoteUser?: string
  remoteKeyPath?: string
  redisUrl: string
  databaseUrl?: string
  userJwtSecret?: string
  serveWeb: boolean
  githubTokenKey?: string
}

export function loadConfig(): Config {
  const result = EnvSchema.safeParse(process.env)
  if (!result.success) {
    const messages = result.error.issues.map(i => i.message).join('\n')
    throw new Error(`Configuration error:\n${messages}`)
  }
  const env = result.data
  return {
    port:             Number.parseInt(env.PORT, 10),
    mode:             env.MODE,
    auth:             env.AUTH,
    serviceJwtSecret: env.SERVICE_JWT_SECRET,
    claudeMode:       env.CLAUDE_MODE,
    anthropicApiKey:  env.ANTHROPIC_API_KEY,
    claudeModel:      env.CLAUDE_MODEL,
    remoteCLIUrl:     env.REMOTE_CLI_URL,
    remoteHost:       env.REMOTE_HOST,
    remoteUser:       env.REMOTE_USER,
    remoteKeyPath:    env.REMOTE_KEY_PATH,
    redisUrl:         env.REDIS_URL,
    databaseUrl:      env.DATABASE_URL,
    userJwtSecret:    env.USER_JWT_SECRET,
    serveWeb:         env.SERVE_WEB === 'true',
    githubTokenKey:   env.GITHUB_TOKEN_ENCRYPTION_KEY,
  }
}
