/**
 * **세션 스트림 키 수명.**
 *
 * 스트림 키는 세션마다 새로 생기는데(`manager:to-{agent}:{sessionId}` 등) 회수하는
 * 코드가 저장소에 **0줄**이었다(실측: `.del`/`.expire`/`xtrim`/`XGROUP DESTROY`
 * 프로덕션 히트 3건이 전부 멱등 마커·파일시스템이고 스트림 키는 하나도 없다).
 * `redis-data` 는 named volume 이라 재시작에도 남는다.
 *
 * 출하 스택은 `--maxmemory 384mb --maxmemory-policy noeviction` 이므로 상한에 닿으면
 * **모든 `XADD` 가 영구 실패**한다 — 챗 입력조차 안 된다. dev compose 에는 `maxmemory`
 * 가 없어 **개발·CI 에서는 절대 재현되지 않는다.**
 *
 * ## 왜 MAXLEN 이 아니라 TTL 인가 (실측 근거)
 *
 * 두 문제가 섞여 있었다. MAXLEN 은 **키 하나의 길이**를 줄이고, 세션 누적은 **키 개수**
 * 문제라 MAXLEN 이 손대지 못한다. 그리고 살아 있는 세션의 스트림을 MAXLEN 으로 자르면
 * 아직 안 읽은 메시지가 **조용히 사라진다** — 이 저장소가 `noeviction` 을 고르며 명시적으로
 * 거부한 방향이다("시끄러운 실패가 조용한 유실보다 낫다").
 *
 * 실측(throwaway Redis, redis:7-alpine):
 * - 빈 세션(그룹만) 3,727 B · 실제 세션(54×2KB + 3×1KB) **161,610 B**
 * - 384MB 도달까지 **2,484 세션**
 * - `DEL` 회수 161,172 B/세션(99.7%) · `EXPIRE` 회수율 **98.6%** — 둘이 동등하다
 * - `DEL` 하면 소비자 그룹도 함께 사라진다(`XGROUP DESTROY` 별도 호출 **불필요**)
 *
 * 즉시 `DEL` 대신 TTL 을 쓰는 이유는 **경쟁 때문**이다. 종료 통지(`event:'end'`)를 받은
 * 에이전트가 소비자를 내리는 것은 비동기라, 곧바로 지우면 그 소비자가 `NOGROUP` 오류를
 * 만난다. TTL 은 teardown 이 끝난 한참 뒤에 회수한다.
 *
 * ## 그래서 `persistSessionStreams` 가 필수다
 *
 * 실측으로 확인한 함정 둘:
 * - **`XADD` 는 TTL 을 지우지 않는다**(600 → 599)
 * - **`XGROUP CREATE` 도 지우지 않는다**(600 → 599)
 *
 * 세션이 종료된 뒤 같은 `sessionId` 로 다시 시작되면(`activeConsumers.delete` 후 재진입이
 * 가능하다) 스트림이 **살아 있는 세션 도중에 증발한다.** 그래서 재통지 경로에서 반드시
 * `PERSIST` 로 TTL 을 벗긴다. 만료된 뒤에는 `XADD` 로 키를 되살려도 그룹은 돌아오지
 * 않으므로(`NOGROUP`) `XGROUP CREATE` 가 함께 돌아야 한다 — 재통지 경로가 이미 그렇게 한다.
 */

/**
 * ## 이 모듈이 덮지 못하는 것 — 고아 키
 *
 * `EXPIRE` 는 **존재하는 키에만** 걸린다(없으면 no-op). 그래서 둘이 남는다.
 *
 * 1. **늦은 응답** — 종료 통지 뒤에 에이전트가 응답을 쓰면 `{agent}:to-manager:{sid}` 가
 *    TTL 없이 새로 생긴다. 종단 실측에서 관측했다(종료 시점에 그 키는 아직 `TTL=-2`,
 *    즉 존재하지 않아 EXPIRE 가 no-op 이었다).
 * 2. **프로세스 크래시** — `releaseSession` 이 아예 안 돌면 그 세션 키 전부가 남는다.
 *
 * 둘 다 **주기적 고아 키 스윕**이 있어야 닫힌다. 이 모듈은 정상 종료 경로만 맡는다 —
 * 그것이 대다수이고, 스윕은 별도 슬라이스다.
 */
/** 세션 종료 후 스트림 키를 남겨 두는 시간. teardown(초 단위)보다 넉넉하고 누적은 1시간분으로 묶인다. */
export const SESSION_STREAM_TTL_SEC = 3600

/** 필요한 만큼만 요구한다 — 테스트가 ioredis 전체를 흉내 내지 않도록. */
export interface SessionKeyRedis {
  expire(key: string, seconds: number): Promise<unknown>
  persist(key: string): Promise<unknown>
}

/**
 * 세션 스트림 키에 TTL 을 건다. **never-throw** — 정리 경로는 실패해도 세션 종료를
 * 막지 않는다(저장소 관례). 회수가 안 되면 자원이 새지만 종료 자체는 계속돼야 한다.
 */
export async function expireSessionStreams(
  redis: SessionKeyRedis,
  keys: readonly string[],
  ttlSec: number = SESSION_STREAM_TTL_SEC,
): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    try {
      await redis.expire(key, ttlSec)
    } catch (err) {
      console.error(`[session-keys] EXPIRE 실패(무시) key=${key}:`, err)
    }
  }))
}

/**
 * 스트림 키의 TTL 을 벗긴다. 세션 재개 시 **반드시** 불러야 한다 —
 * `XADD`·`XGROUP CREATE` 어느 쪽도 TTL 을 지우지 않기 때문이다(실측).
 * never-throw 이유는 위와 같다.
 */
export async function persistSessionStreams(
  redis: SessionKeyRedis,
  keys: readonly string[],
): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    try {
      await redis.persist(key)
    } catch (err) {
      console.error(`[session-keys] PERSIST 실패(무시) key=${key}:`, err)
    }
  }))
}

/** Manager 가 세션 종료 시점에 소유권을 주장할 수 있는 키들(에이전트 쌍은 핸들러가 따로 처리한다). */
export function managerSessionStreamKeys(sessionId: string): string[] {
  return [
    `orchestrator:to-manager:${sessionId}`,
    `manager:to-orchestrator:${sessionId}`,
    `manager:events:${sessionId}`,
  ]
}
