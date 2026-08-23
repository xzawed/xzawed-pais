/**
 * 종료 예산.
 *
 * `docker-compose.yml`·`docker-compose.prod.yml` 어디에도 `stop_grace_period` 선언이
 * 없어 Docker 기본 **10초**가 상한이다. 그런데 Fastify 기본 `keepAliveTimeout` 은
 * **72_000ms** 다(Node 기본 5_000ms 의 14.4배 — 직접 실측). 인플라이트 요청이 하나라도
 * 있으면 `app.close()` 는 응답을 보낸 뒤에도 idle 로 전환된 keep-alive 소켓을 기다려
 * 실측 ~71초가 걸린다.
 *
 * **그래서 워치독이 없으면 신호 핸들러를 붙이는 것이 종료를 악화시킨다** — 0초(즉시
 * SIGKILL)에서 71초로 늘어날 뿐 결말은 그대로 SIGKILL 이다.
 *
 * 하한 근거: 세션 소비자의 `BLOCK 2000` XREADGROUP 이 빠져나오는 데 최대 2초.
 * 5초는 이를 덮고 유예 10초에 5초 헤드룸을 남긴다.
 */
export const SHUTDOWN_TIMEOUT_MS = 5_000

export interface ShutdownDeps {
  /**
   * HTTP 드레인. `onClose` 훅이 등록 역순(LIFO — 실측)으로 여기서 실행된다:
   * `projectGateway.stop` → WS 타이머 정리 → 세션 소비자 정지 → `closePool`.
   * 즉 소비자가 아직 DB 를 만질 수 있는 상태에서 풀이 먼저 닫히는 일이 없다.
   */
  closeServer: () => Promise<void>
  /** 공유 ioredis 연결 정리. 소비자 루프가 이 연결 위에서 블로킹 읽기를 하므로 드레인 뒤다. */
  closeRedis: () => Promise<void>
  timeoutMs?: number
  exit?: (code: number) => void
  log?: (msg: string) => void
}

/**
 * **경계가 있는 종료(bounded shutdown)** 를 만든다.
 *
 * "우아한 종료"라고 부르지 않는다. 막지 못하는 것이 있고 그것을 숨기지 않는다:
 * - `timeoutMs` 시점에 남아 있는 인플라이트 HTTP 요청은 **잘린다.**
 * - 스트림 핸들러가 처리 중인 배치는 **드레인 대상이 아니다** — `StreamConsumer.stop()`
 *   은 불리언 플립일 뿐이고 이 모듈은 그 의미론을 바꾸지 않는다.
 */
export function createShutdown(deps: ShutdownDeps): () => Promise<void> {
  // jscpd:ignore-start
  // replicated-block: shutdown-core
  // Orchestrator 와 Manager 는 서비스 간 import 를 못 하고(M3), Orchestrator 는
  // @xzawed/agent-streams 를 의존하지 않아 공유 라이브러리 경로도 없다. 복제 말고
  // 선택이 없으므로 scripts/check-replicated-blocks.js 가 동일성을 강제한다.
  const timeoutMs = deps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS
  const exit = deps.exit ?? ((code: number) => { process.exit(code) })
  const log = deps.log ?? ((msg: string) => { console.error(msg) })
  let started = false
  let forced = false

  /** 한 단계의 실패가 나머지 해제를 막지 않는다. 실패는 삼키지 않고 로그로 올린다. */
  const step = async (name: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run()
    } catch (err) {
      log(`[shutdown] ${name} 실패(계속 진행): ${String(err)}`)
    }
  }

  return async (): Promise<void> => {
    // SIGTERM 뒤 SIGINT 가 오면 정리가 중복 실행된다.
    if (started) return
    started = true

    // 전 구간 단일 데드라인이다. 단계별 Promise.race 는 "지나간 단계가 아직 도는데
    // 다음 단계가 그 의존을 뜯는" 상황을 만든다 — 종료 경로 안에서 같은 결함을 재현하는 짓이다.
    const watchdog = setTimeout(() => {
      forced = true
      log(`[shutdown] ${timeoutMs}ms 예산 초과 — 강제 종료`)
      exit(1)
    }, timeoutMs)
    watchdog.unref()
  // jscpd:ignore-end

    await step('http-drain', deps.closeServer)
    await step('redis-quit', deps.closeRedis)

    clearTimeout(watchdog)
    // 강제 종료된 뒤 매달린 단계가 풀려도 "정상 완주"로 덮어쓰지 않는다.
    // 종료가 깨끗했는지는 종료 코드로 관측 가능해야 한다.
    if (!forced) exit(0)
  }
}
