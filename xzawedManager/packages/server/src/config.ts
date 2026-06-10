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
    // P2-2 분해 생산자 배선(기본 false). true면 decompose_request → 단일 LLM 분해 → decomposition.emitted
    // 발행을 sessions.route에 배선(Supervisor가 소비). off면 핸들러 미주입(레거시 회귀 0).
    MANAGER_DECOMPOSE_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // 단계 LLM 호출 타임아웃(ms). P2-3a 분해 파이프라인 등에서 사용. 잘못된 값은 거부(양의 정수).
    CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    // P4 분해 repair 루프 최대 반복(기본 2). 소진 시 decomposition.inconsistent 에스컬레이션. 양의 정수.
    MANAGER_DECOMPOSE_REPAIR_MAX: z.coerce.number().int().positive().default(2),
    // P3-1 Oracle DoR 게이트(기본 false). true+DATABASE_URL이면 디스패치 시 approved 오라클로 satisfied-set
    // 주입 + Supervisor에 oracle.approved 소비자 배선 + oracle API 등록. off면 기본 술어(oracleRef!=null)·회귀 0.
    MANAGER_ORACLE_DOR: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P3-2 Oracle 초안 생성(기본 false). true면 decompose가 draft 스테이지 실행 + producer가 oracleDrafts emit
    // + consumer upsert(oracleStore는 DOR||DRAFT로 주입). off면 oracleDrafts=[]·회귀 0.
    // ⚠️D5: 초안이 영속되려면 소비자(=Supervisor)가 돌아야 하므로 TASK_MANAGER_ENABLED+DATABASE_URL이 실질 전제다.
    //   DRAFT만 켜고 TASK_MANAGER off면 초안이 emit돼도 소비자 부재로 영속되지 않는다.
    MANAGER_ORACLE_DRAFT: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P4-1 실행 워커(기본 false). true면 dispatch/reclaim이 wp.dispatch_signal 발행 + WorkerConsumer 배선
    // → dispatch된 WP를 owningRole 에이전트로 자율 실행. 전제: TASK_MANAGER_ENABLED + DATABASE_URL(Supervisor·getGraph).
    MANAGER_TASK_WORKER: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P4b-1 워커 검증 게이트(기본 false). true면 워커가 완료 발행 전 실행 ground truth 검증을 fail-closed로
    // 수행(결과-근거 판정 + develop_code 파생 빌드·테스트 재실행). 실패 시 완료 미발행 → lease 백스톱이
    // reclaim→escalate. 전제: MANAGER_TASK_WORKER(워커 자체가 배선돼야 의미).
    // ⚠️ 검증은 WP당 처리 시간을 최대 3×120s=360s로 늘린다 — MANAGER_LEASE_VISIBILITY_MS(기본 300s)를
    //   360s 이상으로 상향하지 않으면 건강한 검증 도중 lease 만료(false reclaim)가 발생할 수 있다(server.ts 경고).
    MANAGER_WP_VERIFY: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
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
