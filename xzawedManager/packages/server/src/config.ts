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
    // P4b-2 conformance 채널(기본 false). true면 develop_code WP 검증에 사람 승인 오라클 GWT 시나리오를
    // 실행 ground truth로 소비하는 채널을 추가한다(독립 develop_code 호출이 테스트 작성→Tester 실행→결과 판정·N1/N6).
    // 전제: MANAGER_TASK_WORKER + MANAGER_WP_VERIFY(verifyWp 경로) + OracleRepo(=MANAGER_ORACLE_DOR||MANAGER_ORACLE_DRAFT).
    // ⚠️ conformance는 develop_code WP당 에이전트 호출을 최대 4회(실행+빌드+테스트+author+conformance-run)로 늘린다 —
    //   MANAGER_LEASE_VISIBILITY_MS(기본 300s)를 600s 이상으로 상향하지 않으면 검증 중 lease 만료(false reclaim)
    //   위험이 더 커진다(server.ts 경고).
    MANAGER_WP_CONFORMANCE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P4 advisory 채널(기본 false). true면 develop_code WP의 verdict.ok 후 비차단 optimization 제안을
    // 생산해 advisory_findings 투영 + manager_events(wp.advisory.found)로 영속한다(N3 — 절대 게이트 미차단).
    // 전제: MANAGER_TASK_WORKER + MANAGER_WP_VERIFY(verdict.ok 경로) + DATABASE_URL(AdvisoryRepo).
    MANAGER_WP_ADVISORY: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P4 impact golden-differential 채널(기본 false). true면 develop_code WP 검증에 사람 사인오프 golden_refs를
    // 실행 ground truth로 소비(독립 develop_code가 golden-diff 테스트 작성→Tester 실행→drift면 blocking·N8). golden 읽기만(N7).
    // 전제: MANAGER_TASK_WORKER + MANAGER_WP_VERIFY + OracleRepo(MANAGER_ORACLE_DOR||MANAGER_ORACLE_DRAFT).
    // ⚠️ conformance+impact 동시 시 develop_code WP당 에이전트 호출 최대 7단계 → MANAGER_LEASE_VISIBILITY_MS 상향 권장.
    MANAGER_WP_IMPACT: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P4 property/invariants 채널(기본 false·conformance 렌즈). true면 develop_code WP 검증에 사람 승인 invariants를
    // boundary+명시 속성 단언 테스트로 컴파일해 실행 ground truth로 소비(독립 develop_code가 작성→Tester 실행→위반이면 blocking).
    // invariants 읽기전용. 전제: MANAGER_TASK_WORKER + MANAGER_WP_VERIFY + OracleRepo(MANAGER_ORACLE_DOR||MANAGER_ORACLE_DRAFT).
    // ⚠️ conformance+impact+property 동시 시 develop_code WP당 에이전트 호출 최대 ~9단계 → MANAGER_LEASE_VISIBILITY_MS 상향 권장.
    MANAGER_WP_PROPERTY: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P4 mutation θ_risk 게이트(기본 false·N8 강화). true면 HIGH-risk develop_code WP 검증에 자가단언 mutation
    // 하니스(impl mutate+기존 테스트 재실행+killed/total)를 실행해 mutation_score≥θ를 요구한다(미만이면 blocking).
    // oracle 미소비. 전제: MANAGER_TASK_WORKER + MANAGER_WP_VERIFY. ⚠️ mutation은 스위트를 K회 재실행 →
    //   WP당 비용 최대 → MANAGER_LEASE_VISIBILITY_MS 상향 강력 권장(server.ts 경고).
    MANAGER_WP_MUTATION: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // mutation 통과 floor(killed/total ≥ θ). 캘리브레이션 잠정값 0.6.
    MANAGER_MUTATION_THETA: z.coerce.number().min(0).max(1).default(0.6),
    // mutation 최소 실행 risk 등급(이 등급 이상 WP만). 기본 HIGH(비용 bound). 불량값은 HIGH로 폴백.
    MANAGER_MUTATION_MIN_RISK: z.enum(['LOW', 'MEDIUM', 'HIGH']).catch('HIGH').default('HIGH'),
    // mutation 하니스가 생성할 최대 mutant 수(비용 캡).
    MANAGER_MUTATION_MAX_MUTANTS: z.coerce.number().int().positive().default(10),
    // P4 4d security 채널(기본 false). true면 develop_code WP 검증에 결정론 SAST(static+npm audit)를
    // 산출물에 실행해 source∈{static,deps} ∧ severity≥floor findings면 차단. 전제: TASK_WORKER + WP_VERIFY.
    MANAGER_WP_SECURITY: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // security 차단 최소 severity(이 등급 이상 차단). static 규칙이 high/critical이라 high가 자연 경계. 불량값 high 폴백.
    MANAGER_WP_SECURITY_MIN_SEVERITY: z.enum(['low', 'medium', 'high', 'critical']).catch('high').default('high'),
    // P6 결함 의사결정 브리프(기본 false). true면 lease 상한 초과 escalation을 DecisionRequest(defect_brief)로
    // 영속해 사람 도달 구조화 핸드오프로 폐합(M8 무음 통과 금지·M9 영속). 전제: TASK_MANAGER_ENABLED+DATABASE_URL
    // (Supervisor·LeaseSweeper 가동 + DecisionRepo). off면 escalation 시 브리프 미생성(회귀 0).
    MANAGER_DECISION_BRIEF: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P6 사람 결정 라우팅(기본 false). true면 decision.recorded 소비자 + 결정 제출 라우트 배선 →
    // fix_reverify가 escalated WP를 재진입(lease 재오픈→dispatch_signal). 전제: MANAGER_DECISION_BRIEF(브리프 생성)+DATABASE_URL.
    MANAGER_DECISION_ROUTING: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // §13 budget 서킷브레이커(USD 비용 상한). 0/미설정이면 비활성. 둘 중 하나라도 >0이면
    // 러너 tool-loop이 호출 전 누적 비용을 검사(상한 초과 시 fail-closed 차단)·호출 후 비용 누적.
    // 워크플로(세션)당 상한 + 일(UTC) 전체 상한. 인메모리(재시작 시 일 카운터 소실·캘리브레이션 비차단).
    MANAGER_BUDGET_PER_WORKFLOW_USD: z.coerce.number().nonnegative().default(0),
    MANAGER_BUDGET_DAILY_USD: z.coerce.number().nonnegative().default(0),
    // §13 provider 서킷브레이커(기본 false). true면 러너 tool-loop이 provider(Anthropic) 지속 장애
    // (429/5xx/529·연결/타임아웃)를 추적 — 연속 실패 임계 도달 시 회로 open→cooldown 동안 fail-fast(낭비 호출 차단).
    // 트립은 OPERATIONS_DECISIONS §1 NORMAL→DEGRADED 강등 신호 입력(상태머신 전이는 P6). off면 미주입(회귀 0).
    MANAGER_PROVIDER_CIRCUIT: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    MANAGER_PROVIDER_CIRCUIT_THRESHOLD: z.coerce.number().int().positive().default(5),
    MANAGER_PROVIDER_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
    // §13 벌크헤드(에이전트 종류별 풀 + 전역 캡). 0=무제한(비활성). 둘 중 하나라도 >0이면 RedisAgentHandler에 주입 —
    // 에이전트 종류(agentName)별 동시 RPC를 캡(초과 시 큐잉·백프레셔·드롭 없음)·한 종류 폭주가 다른 풀을 잠식 차단(§3).
    MANAGER_BULKHEAD_GLOBAL: z.coerce.number().int().nonnegative().default(0),
    MANAGER_BULKHEAD_PER_AGENT: z.coerce.number().int().nonnegative().default(0),
    // P5-1 릴리스 게이트(M1): all-WP-done 시 검증 증거를 hard-AND 집계해 gate.passed/blocked. 증거 부재=CLOSED(fail-closed).
    MANAGER_RELEASE_GATE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P5-2a: gate.blocked → 사인오프 DecisionRequest 라우팅(기본 false). gate.blocked 이벤트 소비 →
    // degraded_release DecisionRequest 생성 + decision.recorded accept_known → SignOff 영속.
    // 전제: MANAGER_RELEASE_GATE(gate.blocked 발행)+MANAGER_DECISION_ROUTING(결정 소비). off면 회귀 0.
    MANAGER_RELEASE_SIGNOFF: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P5-2b: gate.passed/사인오프 → deploy 하드 전제. 전제: MANAGER_RELEASE_GATE+DATABASE_URL. off면 회귀 0.
    MANAGER_DEPLOY_GATE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // B1: 결정 만료 sweep(=true). off면 expiresAt 미설정+sweep 미배선=현재 동작. 전제 TASK_MANAGER_ENABLED+DATABASE_URL.
    MANAGER_DECISION_EXPIRY: z.string().optional().transform((v) => v === 'true'),
    // B1: 결정 TTL(시간). server가 *3_600_000(ms)로 변환해 주입. 사람 대면이라 기본 72h.
    MANAGER_DECISION_TTL_HOURS: z.coerce.number().int().positive().default(72),
    // B1: 결정 만료 sweep 주기 ms(이미 ms·무변환). 만료는 시간 단위라 분 단위 충분.
    MANAGER_DECISION_SWEEP_MS: z.coerce.number().int().positive().default(60_000),
    // B1: 재에스컬레이션 상한. 만료 소비자가 새 PENDING을 이 횟수만큼만 생성. 기본 1(무한루프 방지).
    MANAGER_DECISION_REESCALATE_MAX: z.coerce.number().int().positive().default(1),
    // P2r-3: 기본 false. true면 decompose_request 시 프로젝트 리스크 분류를 생성·pending 영속(N6 미승인).
    //   실질 전제: MANAGER_DECOMPOSE_ENABLED(핸들러 도달) + DATABASE_URL(RiskClassificationRepo). off면 회귀 0.
    MANAGER_RISK_CLASSIFY: z.string().optional().transform((v) => v === 'true'),
    // P2r-4: 기본 false. true면 risk.approved 소비자(→wp.risk write-back) + 승인 라우트 배선(N6).
    //   전제: TASK_MANAGER_ENABLED(Supervisor·graph)+DATABASE_URL. 실효성엔 MANAGER_RISK_CLASSIFY. off면 회귀 0.
    MANAGER_RISK_ROUTING: z.string().optional().transform((v) => v === 'true'),
    // C5: 기본 false. true면 humanGate.required 리스크 분류를 risk_classification DecisionRequest로 발행 +
    //   decision-consumer가 approve→RiskClassificationRepo.approve. 전제: MANAGER_RISK_CLASSIFY+MANAGER_DECISION_ROUTING+DATABASE_URL.
    MANAGER_RISK_DECISION: z.string().optional().transform((v) => v === 'true'),
    // D5: 기본 false. true면 워커가 디스패치 시 승인 modelRouting을 조회해 에이전트 모델을 라우팅(off→CLAUDE_MODEL 폴백).
    MANAGER_MODEL_ROUTING: z.string().optional().transform((v) => v === 'true'),
    // D5: tier→concrete model id(claude-api 최신). routeModels의 'opus'/'sonnet' tier를 이 id로 해석.
    MANAGER_MODEL_OPUS: z.string().default('claude-opus-4-8'),
    MANAGER_MODEL_SONNET: z.string().default('claude-sonnet-4-6'),
    // P5-3a 운영 강등 모드 FSM(기본 false). true면 ModeController(IntervalSweeper)가 주기적으로
    // provider 서킷/budget 신호를 읽어 NORMAL/DEGRADED/SAFE 모드를 추적·전이 시 로그(observe-only).
    // enforcement(SAFE 디스패치 보류 등)는 P5-3b 후속. off면 ModeController 미생성(회귀 0).
    MANAGER_DEGRADED_MODE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // P5-3a: 모드 sweep 주기(ms). 잘못된 값은 거부(양의 정수). 기본 5000ms.
    MANAGER_MODE_SWEEP_MS: z.coerce.number().int().positive().default(5000),
    // P5-3a: 호전 히스테리시스 안정 윈도(ms). 이 시간 동안 저severity 신호가 유지되어야 복귀(1단계씩). 기본 60000ms.
    MANAGER_MODE_STABILITY_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    // P5-3b: 강등 enforcement(기본 false). true(+MANAGER_DEGRADED_MODE+TASK_MANAGER_ENABLED)면 SAFE 모드에서
    // handleDispatch가 신규 디스패치 보류(held)·SAFE 이탈 시 Supervisor.resumeDispatch 재개. off→P5-3a observe-only 바이트 동일.
    MANAGER_DEGRADED_ENFORCE: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
    // N2: 강등 모드 HIGH-risk 디스패치 사인오프(기본 false). true(+MANAGER_DEGRADED_ENFORCE+MANAGER_DECISION_ROUTING+DATABASE_URL)면
    // DEGRADED 모드에서 HIGH-risk WP를 보류하고 degraded_dispatch DecisionRequest로 사람 사인오프를 요구. off→P5-3b 바이트 동일.
    MANAGER_DEGRADED_SIGNOFF: z
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
