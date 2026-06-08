import { z } from 'zod'

const configSchema = z
  .object({
    ANTHROPIC_API_KEY: z.string().min(1),
    CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    PORT: z.coerce.number().default(3001),
    MODE: z.enum(['local', 'remote']).default('local'),
    SERVICE_JWT_SECRET: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    GITHUB_TOKEN: z.string().optional(),
    // 승인 게이트 fail-safe(기본 true). 파싱 불가·미지 승인 응답을 자동 승인하지 않고 사람 재검토로
    // 에스컬레이션한다(senario M8 무음 통과 금지·N1 불확실=실패). 'false'면 레거시 fail-open 복원.
    // 실제 게이트 동작은 runner.ts가 동일 의미로 process.env에서 직접 소비(여기는 문서화·타입화).
    MANAGER_GATE_FAILSAFE: z
      .string()
      .optional()
      .transform((v) => v !== 'false'),
    // 세션 이벤트소싱(기본 false). true면 Postgres append-only 이벤트 로그를 진실원천으로 사용(DATABASE_URL 필요).
    EVENT_SOURCED_SESSION: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // 아웃박스 릴레이 폴링 주기(ms). 잘못된 값은 거부(양의 정수).
    MANAGER_OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
    // Task Manager Supervisor 배선(기본 false). true+DATABASE_URL이면 decomposition 소비→디스패치·
    // lease sweep·completion 소비→재디스패치를 server.ts에 배선(P1d-7). off면 핸들러만 존재(미배선).
    TASK_MANAGER_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // lease 만료 sweep 주기(ms)·가시성 타임아웃(ms)·최대 디스패치 시도. 잘못된 값은 거부.
    MANAGER_LEASE_SWEEP_MS: z.coerce.number().int().positive().default(30_000),
    MANAGER_LEASE_VISIBILITY_MS: z.coerce.number().int().positive().default(300_000),
    MANAGER_LEASE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  })
  .superRefine((val, ctx) => {
    if (val.SERVICE_JWT_SECRET !== undefined && val.SERVICE_JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SERVICE_JWT_SECRET'],
        message: 'SERVICE_JWT_SECRET must be at least 32 characters when provided',
      })
    }
  })

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  return configSchema.parse(process.env)
}
