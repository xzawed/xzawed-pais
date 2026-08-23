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
  // CORS 허용 Origin 목록(쉼표 구분). 이전엔 server.ts가 process.env를 직접 읽어
  // 스키마 밖에 있었다 — 기동 시 검증도 PAIS_PROFILE 병합도 받지 못했다.
  ALLOWED_ORIGINS:            z.string().optional(),
  // 리버스 프록시 뒤에서만 켠다. 켜면 Fastify가 X-Forwarded-For 를 클라이언트 IP로 채택하는데,
  // 프록시가 없으면 **클라이언트가 그 헤더를 마음대로 보낼 수 있다** — rate limit 키가 IP라
  // 매 요청 헤더를 바꾸면 로그인 시도 제한이 통째로 무력화된다. 'true' 만 참으로 읽는다.
  TRUST_PROXY:                z.string().optional(),
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
  if (env.CLAUDE_MODE === 'api' && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'],
      message: 'ANTHROPIC_API_KEY is required when CLAUDE_MODE=api. Set CLAUDE_MODE=cli to use Claude CLI subscription instead.' })
  }
  // MODE=remote 는 네트워크에 노출된다는 선언이다. 그 상태에서 AUTH=none 은
  // 무인증 개방이므로 기동을 거부한다. MODE=local(기본)은 그대로 둔다 — 로컬 단일 사용자 전제.
  if (env.MODE === 'remote' && env.AUTH !== 'jwt') {
    ctx.addIssue({ code: 'custom', path: ['AUTH'],
      message: 'AUTH must be "jwt" when MODE=remote (무인증으로 네트워크에 노출할 수 없습니다). Set AUTH=jwt with SERVICE_JWT_SECRET and USER_JWT_SECRET.' })
  }
  // 원격 노출인데 허용 Origin 이 비면 CORS 가 전부 거부라 브라우저 클라이언트가 아무것도 못 한다.
  // 조용히 그 상태로 뜨는 것보다 기동 시 말하는 편이 낫다.
  if (env.MODE === 'remote' && !parseOrigins(env.ALLOWED_ORIGINS).length) {
    ctx.addIssue({ code: 'custom', path: ['ALLOWED_ORIGINS'],
      message: 'ALLOWED_ORIGINS is required when MODE=remote (쉼표로 구분한 Origin 목록).' })
  }
})

/** 쉼표 구분 Origin 목록을 트림·빈값 제거해 배열로. */
function parseOrigins(raw: string | undefined): string[] {
  return raw?.split(',').map((x) => x.trim()).filter(Boolean) ?? []
}

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
  /** CORS 허용 Origin. MODE=remote 면 비어 있을 수 없다(기동 시 강제). */
  allowedOrigins: string[]
  /** X-Forwarded-For 를 신뢰할지. 프록시 뒤가 아니면 반드시 false. */
  trustProxy: boolean
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
// jscpd:ignore-start
// replicated-block: pais-profile-merge
// 병합 규칙이 Manager와 갈리면 같은 PAIS_PROFILE이 서비스마다 다르게 해석된다.
// 사유와 강제 방법: scripts/check-replicated-blocks.js
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
// jscpd:ignore-end

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
    allowedOrigins:   parseOrigins(env.ALLOWED_ORIGINS),
    trustProxy:       env.TRUST_PROXY === 'true',
    managerUrl:       env.MANAGER_URL,
    databaseUrl:      env.DATABASE_URL,
    decomposeEnabled: env.ORCHESTRATOR_DECOMPOSE_ENABLED === 'true',
    userJwtSecret:    env.USER_JWT_SECRET,
    serveWeb:         env.SERVE_WEB === 'true',
    githubTokenKey:   env.GITHUB_TOKEN_ENCRYPTION_KEY,
    wsCleanupGraceMs: Number.parseInt(env.WS_CLEANUP_GRACE_MS, 10),
  }
}
