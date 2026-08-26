/**
 * **Redis 관측 지표 수집**(S3.3 / 수용 기준 L2-8 · 결함 O1).
 *
 * DLQ 적재량과 소비자 그룹 PEL 깊이는 "무언가 조용히 쌓이고 있다"를 알려 주는 유일한 신호다.
 * 지금까지 수집 코드가 0줄이라 둘 다 볼 수 없었다.
 *
 * **고정 키 목록으로는 잴 수 없다.** 스트림이 per-session·per-workflow 라
 * (`manager:to-designer:{sessionId}` · `manager:decomposition:{wf}` …) DLQ 키
 * `{stream}:dlq` 도 같이 늘어난다. 알려진 키 하나만 재면 나머지가 쌓여 있어도 **0 을 보고**한다 —
 * 그것이 관측의 최악, 초록 거짓말이다. 그래서 키스페이스를 실제로 훑는다.
 *
 * **`KEYS` 를 쓰지 않는다.** 단일 스레드 Redis 를 키 수만큼 블로킹한다. `SCAN` 은 커서 기반이라
 * 다른 명령과 교대로 실행된다.
 *
 * **잘라내면 그 사실을 지표로 드러낸다.** 상한에 걸려 일부만 셌는데 합계만 내면 그 숫자는
 * "적재량"이 아니라 "적재량의 하한"이다 — `..._truncated` 가 1이면 합계를 신뢰하면 안 된다.
 *
 * 전 서비스가 한 Redis 를 공유하므로(`docker-compose.yml` 9곳 모두 `redis://redis:6379`)
 * 한 곳에서 훑으면 시스템 전체가 보인다 — 서비스마다 배선을 복제하지 않는 이유다.
 */

/** 한 번의 수집이 모을 스트림 키 상한. 넘으면 잘라내고 `truncated` 로 알린다. */
export const SCAN_KEY_LIMIT = 2000
/** SCAN 한 번에 요청할 힌트 크기(Redis 는 근사치로만 지킨다). */
const SCAN_COUNT = 200
/**
 * SCAN 왕복 상한.
 *
 * **키 상한만으로는 부족하다.** `TYPE stream` 필터는 서버측이지만 커서는 **키스페이스 전체**를
 * 걷는다 — 스트림이 5개뿐이어도 `idem:*` 마커가 수백만 개면 한 번의 스크레이프가 전부를 순회한다.
 * `/metrics` 는 15초마다 긁히므로 그 비용이 상시 부하가 된다. Grok 반증이 지적했다.
 *
 * 여기서 멈춰도 `truncated` 로 "전부 보지 못했다"를 알린다 — 두 상한이 같은 플래그를 쓰는 이유는
 * 소비자에게 중요한 것이 **왜 못 봤는가가 아니라 합계가 하한이라는 사실**이기 때문이다.
 */
export const SCAN_ROUNDTRIP_LIMIT = 200
/** 지표 본문에 개별로 노출할 상위 스트림 수 — 카디널리티 폭발 방지. */
export const TOP_N = 20

/**
 * ioredis 의 **구조적 부분집합**(테스트에서 목으로 대체 가능).
 *
 * `scan` 은 ioredis 의 오버로드 하나와 정확히 같은 모양이어야 한다 — 가변 인자로 느슨하게
 * 선언하면 실 클라이언트가 구조적으로 할당되지 않는다(오버로드는 가변 시그니처에 안 맞는다).
 */
export interface MetricsRedis {
  scan(
    cursor: number | string,
    patternToken: 'MATCH', pattern: string,
    countToken: 'COUNT', count: number | string,
    typeToken: 'TYPE', type: string,
  ): Promise<[cursor: string, elements: string[]]>
  xlen(key: string): Promise<number>
  xinfo(subcommand: 'GROUPS', key: string): Promise<unknown>
}

export interface StreamDepth {
  stream: string
  depth: number
}

export interface DlqMetrics {
  /** 훑은 DLQ 스트림 수. */
  streams: number
  /** 전체 적재량 합계. `truncated` 면 **하한**이다. */
  total: number
  /** 깊이 내림차순 상위 N. */
  top: StreamDepth[]
  /** 전부 보지 못했는가(상한·왕복 초과·스트림별 실패). 1이면 합계는 하한이다. */
  truncated: boolean
  /** 개별 스트림 조회 실패 수 — 진단용. 0이 아니면 `truncated` 도 참이다. */
  errors: number
}

export interface PelEntry {
  stream: string
  group: string
  pending: number
}

export interface PelMetrics {
  groups: number
  total: number
  top: PelEntry[]
  /** 전부 보지 못했는가(상한·왕복 초과·스트림별 실패). 1이면 합계는 하한이다. */
  truncated: boolean
  /** 개별 스트림 조회 실패 수 — 진단용. 0이 아니면 `truncated` 도 참이다. */
  errors: number
}

/** `SCAN ... TYPE stream` 으로 스트림 키만 모은다. 상한에 걸리면 잘라내고 알린다. */
async function scanStreamKeys(
  redis: MetricsRedis, match: string,
): Promise<{ keys: string[]; truncated: boolean }> {
  // **Set 이다.** Redis SCAN 은 같은 키를 여러 번 돌려줄 수 있다고 **문서화**돼 있다(리해싱 중
  // 커서가 되감기는 경우). 배열로 모으면 같은 스트림을 두 번 세는데, 그때 절단 플래그는 여전히
  // 거짓이라 **완전한 척하는 부풀린 합계**가 된다 — 이 모듈이 막으려는 것과 정확히 같은 종류의
  // 거짓말이고, Grok 반증이 잡았다.
  const keys = new Set<string>()
  let cursor = '0'
  let roundtrips = 0
  for (;;) {
    const [next, batch] = await redis.scan(cursor, 'MATCH', match, 'COUNT', SCAN_COUNT, 'TYPE', 'stream')
    for (const k of batch) keys.add(k)
    cursor = next
    roundtrips += 1
    // **커서가 0 이면 스캔이 끝난 것이다** — 상한과 무관하게 완전한 결과다. 여기서 상한만 보고
    // `truncated` 를 세우면 정확한 값을 하한이라고 말하게 된다(반대 방향 거짓말이고, 그러면
    // 운영자가 맞는 숫자를 못 믿는다). 조기 종료 판정은 커서가 남아 있을 때만 한다 — Grok 반증.
    if (cursor === '0') break
    if (keys.size >= SCAN_KEY_LIMIT) return { keys: [...keys].slice(0, SCAN_KEY_LIMIT), truncated: true }
    // 왕복 상한 — 큰 키스페이스를 상시 순회하지 않는다.
    if (roundtrips >= SCAN_ROUNDTRIP_LIMIT) return { keys: [...keys], truncated: true }
  }
  // 스캔은 끝났지만 마지막 배치가 상한을 넘겼다면 잘라낸다 — 그건 진짜 절단이다.
  if (keys.size > SCAN_KEY_LIMIT) return { keys: [...keys].slice(0, SCAN_KEY_LIMIT), truncated: true }
  return { keys: [...keys], truncated: false }
}

function topBy<T extends { depth?: number; pending?: number }>(rows: T[], pick: (r: T) => number): T[] {
  return [...rows].sort((a, b) => pick(b) - pick(a)).slice(0, TOP_N)
}

/**
 * DLQ 적재량. `{stream}:dlq` 규약(`dlqStreamKey`)을 그대로 따라간다.
 *
 * **깊이 0 인 DLQ 도 센다**(streams 카운트에). 격리가 한 번 있었다가 redrive 된 스트림과
 * 애초에 없던 스트림은 다른 상태이고, 전자가 사라지면 "한 번도 없었다"로 오독된다.
 */
export async function collectDlqMetrics(redis: MetricsRedis): Promise<DlqMetrics> {
  const { keys, truncated } = await scanStreamKeys(redis, '*:dlq')
  const rows: StreamDepth[] = []
  let total = 0
  let errors = 0
  for (const stream of keys) {
    // **한 키의 실패가 전체 지표를 날리면 안 된다.** 스캔과 XLEN 사이에 키 타입이 바뀌면
    // `WRONGTYPE` 이 나는데, 그것을 위로 던지면 라우트가 통째로 잡아 `pais_redis_up 0` 을 낸다 —
    // Redis 는 멀쩡한데 "못 읽었다"는 **거짓**이고 나머지 스트림의 숫자도 같이 사라진다.
    // 대신 건너뛰고 세되, 전부 보지 못했으므로 합계를 하한으로 표시한다(Grok 반증).
    try {
      const depth = await redis.xlen(stream)
      total += depth
      rows.push({ stream, depth })
    } catch {
      errors += 1
    }
  }
  return {
    streams: rows.length, total, top: topBy(rows, (r) => r.depth),
    truncated: truncated || errors > 0, errors,
  }
}

/**
 * `XINFO GROUPS` 응답(배열의 배열)에서 `name`·`pending` 을 꺼낸다.
 *
 * **건너뛴 것을 센다.** 모양이 예상과 다르면 숫자를 지어내지 않는 것이 맞지만, 조용히 버리면
 * "PEL 0" 과 "PEL 을 못 읽었다"가 같은 출력이 된다 — 이 모듈이 막으려는 바로 그 침묵이다.
 * 오늘 이 저장소는 RESP2(ioredis 기본, `protocol: 3` 설정 0건)라 응답이 중첩 배열이지만,
 * RESP3 로 바뀌면 맵이 와서 `Array.isArray` 가 통째로 거짓이 된다 — 그때 0 을 보고하는 대신
 * 실패로 세어 `truncated` 로 드러낸다(Grok 반증).
 */
function parseGroups(raw: unknown): { groups: { name: string; pending: number }[]; skipped: number } {
  if (!Array.isArray(raw)) return { groups: [], skipped: 1 }
  const out: { name: string; pending: number }[] = []
  let skipped = 0
  for (const g of raw) {
    if (!Array.isArray(g)) { skipped += 1; continue }
    let name: string | undefined
    let pending: number | undefined
    for (let i = 0; i + 1 < g.length; i += 2) {
      const k = g[i]
      const v = g[i + 1]
      if (k === 'name' && typeof v === 'string') name = v
      if (k === 'pending' && (typeof v === 'number' || typeof v === 'string')) pending = Number(v)
    }
    if (name !== undefined && pending !== undefined && Number.isFinite(pending)) out.push({ name, pending })
    else skipped += 1
  }
  return { groups: out, skipped }
}

/**
 * 소비자 그룹 PEL 깊이. 스트림 목록도 고정이 아니므로 같은 이유로 훑는다.
 *
 * **DLQ 스트림은 제외한다** — 거기엔 소비자 그룹이 없고, 있어도 그 PEL 은 격리된 메시지가
 * 아니라 redrive 도구의 상태라 의미가 다르다.
 *
 * `XINFO GROUPS` 는 그룹이 없는 스트림에서도 빈 배열을 준다(에러 아님). 스트림이 그 사이에
 * 사라지면 throw 하므로 개별 실패는 건너뛴다 — 하나 때문에 전체 지표를 잃지 않는다.
 */
export async function collectPelMetrics(redis: MetricsRedis): Promise<PelMetrics> {
  const { keys, truncated } = await scanStreamKeys(redis, '*')
  const rows: PelEntry[] = []
  let total = 0
  let errors = 0
  for (const stream of keys) {
    if (stream.endsWith(':dlq')) continue
    let raw: unknown
    try {
      raw = await redis.xinfo('GROUPS', stream)
    } catch {
      // 수집 중 삭제된 스트림 등 — 한 건 때문에 전체를 잃지 않는다. 다만 **조용히 건너뛰면
      // 부족한 합계가 완전한 척하므로** 세어서 합계를 하한으로 표시한다.
      errors += 1
      continue
    }
    const { groups, skipped } = parseGroups(raw)
    errors += skipped
    for (const g of groups) {
      total += g.pending
      rows.push({ stream, group: g.name, pending: g.pending })
    }
  }
  return {
    groups: rows.length, total, top: topBy(rows, (r) => r.pending),
    truncated: truncated || errors > 0, errors,
  }
}
