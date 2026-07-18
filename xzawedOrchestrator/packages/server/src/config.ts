import { z } from 'zod'

/**
 * Grace window (ms) before a disconnected WS session is torn down. A reconnect within
 * this window (e.g. React StrictMode remount or serverUrl change) keeps the session and
 * its consumer alive; only an abandoned session is reaped after it elapses.
 */
export const DEFAULT_WS_CLEANUP_GRACE_MS = 15_000

const EnvSchema = z.object({
  PORT:                       z.string().default('3000'),
  MODE:                       z.enum(['local', 'remote']).default('local'),
  AUTH:                       z.enum(['none', 'jwt']).default('none'),
  CLAUDE_MODE:                z.enum(['api', 'cli', 'remote']).default('api'),
  CLAUDE_MODEL:               z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_API_KEY:          z.string().optional(),
  REDIS_URL:                  z.string().default('redis://localhost:6379'),
  MANAGER_URL:                z.string().default('http://localhost:3001'),
  SERVICE_JWT_SECRET:         z.string().optional(),
  USER_JWT_SECRET:            z.string().optional(),
  REMOTE_CLI_URL:             z.string().url().optional(),
  REMOTE_HOST:                z.string().optional(),
  REMOTE_USER:                z.string().optional(),
  REMOTE_KEY_PATH:            z.string().optional(),
  DATABASE_URL:               z.string().optional(),
  // 프리미엄 프로필 프리셋(G1). Manager와 대칭 — resolveProfileEnv가 parse 전에 프로필 기본값을
  // env에 병합(개별 env override 우선). autonomous → ORCHESTRATOR_DECOMPOSE_ENABLED=true.
  PAIS_PROFILE:               z.string().optional(),
  // build 모드(mode:'build')를 decompose_request로 라우팅(C6). 이전엔 server.ts가 process.env를
  // 직접 읽었으나 PAIS_PROFILE이 config 경유로 병합되도록 config로 일원화(단일출처).
  ORCHESTRATOR_DECOMPOSE_ENABLED: z.string().optional(),
  SERVE_WEB:                  z.string().optional(),
  GITHUB_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  WS_CLEANUP_GRACE_MS:        z.string()
    .regex(/^\d+$/, 'WS_CLEANUP_GRACE_MS must be a non-negative integer (ms)')
    .default(String(DEFAULT_WS_CLEANUP_GRACE_MS)),
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
  managerUrl: string
  databaseUrl?: string
  // loadConfig는 항상 boolean을 설정하나, 다른 optional 필드와 일관되게 optional로 둔다
  // (테스트 픽스처가 생략 가능·소비자는 undefined를 false로 처리·기존 스타일 유지).
  decomposeEnabled?: boolean
  userJwtSecret?: string
  serveWeb: boolean
  githubTokenKey?: string
  wsCleanupGraceMs?: number
}

// 프리미엄 프로필 프리셋(G1·Manager와 대칭). 프로필명 → 그 프로필이 켜는 검증된 env 기본값.
// Orchestrator 몫은 build 모드 라우팅 스위치 하나. (Manager가 자율 스택 대부분·JWT/DB 하드요구를 담당.)
export const PROFILES: Record<string, Record<string, string>> = {
  autonomous: {
    ORCHESTRATOR_DECOMPOSE_ENABLED: 'true',
  },
}

/**
 * PAIS_PROFILE이 설정돼 있으면 그 프로필 기본값을 env 복사본에 병합해 반환한다.
 * 미설정/빈 값→env 그대로(회귀 0)·미지 프로필→명확한 throw·개별 env가 프로필을 override.
 */
export function resolveProfileEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const profile = env['PAIS_PROFILE']
  if (profile === undefined || profile === '') return env
  const preset = PROFILES[profile]
  if (preset === undefined) {
    throw new Error(
      `Unknown PAIS_PROFILE: '${profile}'. Known profiles: ${Object.keys(PROFILES).join(', ')}`,
    )
  }
  const merged: NodeJS.ProcessEnv = { ...env }
  for (const [key, value] of Object.entries(preset)) {
    if (merged[key] === undefined) merged[key] = value // 명시 env 우선
  }
  return merged
}

export function loadConfig(): Config {
  const result = EnvSchema.safeParse(resolveProfileEnv(process.env))
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
    managerUrl:       env.MANAGER_URL,
    databaseUrl:      env.DATABASE_URL,
    decomposeEnabled: env.ORCHESTRATOR_DECOMPOSE_ENABLED === 'true',
    userJwtSecret:    env.USER_JWT_SECRET,
    serveWeb:         env.SERVE_WEB === 'true',
    githubTokenKey:   env.GITHUB_TOKEN_ENCRYPTION_KEY,
    wsCleanupGraceMs: Number.parseInt(env.WS_CLEANUP_GRACE_MS, 10),
  }
}
