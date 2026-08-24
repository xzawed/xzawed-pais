import { z } from 'zod'

/**
 * Work Package 상태 **정본**(S6.1) — enum 과 전이표의 단일 출처.
 *
 * **왜 이 파일이 생겼나.** 이전에는 정본이 셋으로 갈려 있었고 **교집합이 0** 이었다.
 * 소문자 `draft|ready|in_progress|blocked|done`(shared `WorkPackageSchema`) ·
 * 대문자 `DRAFTED|DISPATCHED|DONE|ESCALATED`(Manager 디스패치·`wp_state_log`) ·
 * 테스트만 쓰던 `READY`. 값이 하나도 겹치지 않으므로 **한쪽을 읽는 술어는 다른 쪽이 쓴 값을 영원히 못 본다** —
 * `isReady` 의 `wp.status === 'done'` 기본 술어가 대표적이다(프로덕션은 소문자 `done` 을 쓴 적이 없다).
 * 디스패치 경로는 `latestStates` 기반 술어를 주입해 우회하고 있었을 뿐이다.
 *
 * **대문자가 정본인 이유.** `docs/superpowers/specs/2026-06-08-p1d4-dispatch-design.md` 가
 * `DRAFTED → DISPATCHED` 를 **[PO 결정] · WORKFLOW §B 정본 명칭**으로 기록했고, append-only 로그인
 * `wp_state_log` 가 이미 그 값을 담는다. 소문자는 프로덕션에서 `draft` 하나만 쓰였다.
 *
 * **정직성.** WORKFLOW §B 전체(8+2)는 별도 비공개 repo 에 있어 이 저장소에서 대조할 수 없다.
 * 여기 있는 6개는 **이 저장소의 코드가 실제로 쓰는 값의 합집합**이지 그 사양의 전사가 아니다.
 * 프로덕션 writer 가 있는 것은 `DRAFTED`·`DISPATCHED`·`ESCALATED`·`DONE` 넷이고,
 * `READY`·`BLOCKED` 는 그래프 술어·전이표에만 존재한다(아래 표 참조).
 */
export const WP_STATES = [
  /** 분해 직후. 아직 DoR 미충족. 프로덕션 writer: `decompose/map.ts`. */
  'DRAFTED',
  /** DoR 충족(선행 done + 오라클). 프로덕션 writer 없음 — `isReady` 술어가 계산으로 판정한다. */
  'READY',
  /** 에이전트에 할당돼 실행 중. 프로덕션 writer: `dispatch.repo.recordDispatch`·`lease.repo` 재점유/재개. */
  'DISPATCHED',
  /** 선행 미충족·외부 사유로 진행 불가. 프로덕션 writer 없음. */
  'BLOCKED',
  /** 검증까지 통과한 완료. 종단. 프로덕션 writer: `lease.repo.recordCompletion`. */
  'DONE',
  /** 시도 상한 초과로 사람에게 넘어감. 프로덕션 writer: `lease.repo.recordEscalation`. */
  'ESCALATED',
] as const

export const WpStatusSchema = z.enum(WP_STATES)
export type WpStatus = z.infer<typeof WpStatusSchema>

/**
 * 허용 전이표. **키 집합 = enum**(L2-5), 목적지도 전부 enum 안이다 — `__tests__/wp-state.test.ts` 가 강제한다.
 *
 * 프로덕션이 실제로 기록하는 5종은 전부 여기 포함된다(`lease.repo.ts`·`dispatch.repo.ts` 실측):
 * `DRAFTED→DISPATCHED` · `DISPATCHED→DISPATCHED`(재점유) · `DISPATCHED→ESCALATED` ·
 * `ESCALATED→DISPATCHED`(사람 수정 후 재검증) · `DISPATCHED→DONE`.
 *
 * **표가 코드보다 좁아지면 런타임이 죽는다.** 전이를 지울 때는 그 writer 가 사라졌는지 먼저 확인한다.
 */
export const WP_TRANSITIONS = {
  DRAFTED: ['READY', 'DISPATCHED', 'BLOCKED'],
  READY: ['DISPATCHED', 'BLOCKED'],
  /** 자기 루프는 lease 재점유(reclaim) — 같은 상태로 재기록해 attempt 를 올린다. */
  DISPATCHED: ['DISPATCHED', 'DONE', 'ESCALATED', 'BLOCKED'],
  BLOCKED: ['READY', 'DISPATCHED'],
  /** 종단. 완료 후 재디스패치 경로는 없다(`completion.ts` 는 DONE 을 skip 한다). */
  DONE: [],
  ESCALATED: ['DISPATCHED'],
} as const satisfies Record<WpStatus, readonly WpStatus[]>

export function isTerminalWpState(s: WpStatus): boolean {
  return WP_TRANSITIONS[s].length === 0
}

/**
 * 전이 허용 여부. `from` 이 null 이면 최초 전이라 어떤 상태로도 허용한다
 * (`wp_state_log.from_state` 가 nullable 인 것과 같은 의미).
 */
export function canTransition(from: WpStatus | null | undefined, to: WpStatus): boolean {
  if (from == null) return true
  return (WP_TRANSITIONS[from] as readonly WpStatus[]).includes(to)
}

/**
 * 값과 순서를 함께 검증하고 위반이면 throw 한다(fail-closed).
 *
 * **`wp_state_log` writer 는 전부 이것을 지나야 한다.** DB CHECK 제약은 값 집합만 막는다 —
 * `DONE → DISPATCHED` 는 값이 전부 유효하므로 CHECK 로는 절대 안 잡힌다. 두 writer 가 각자
 * 사본을 두면 그것이 다음 드리프트이므로 정본 옆에 하나만 둔다.
 *
 * @param ctx 오류 메시지에 붙일 식별자(보통 wpId).
 */
export function assertWpTransition(from: WpStatus | null | undefined, to: WpStatus, ctx: string): void {
  const parsedTo = WpStatusSchema.safeParse(to)
  if (!parsedTo.success) {
    throw new Error(`${ctx}: 알 수 없는 WP 상태 '${String(to)}' — 정본 enum 밖이다`)
  }
  if (from == null) return
  const parsedFrom = WpStatusSchema.safeParse(from)
  if (!parsedFrom.success) {
    throw new Error(`${ctx}: 알 수 없는 WP 상태 '${String(from)}' — 정본 enum 밖이다`)
  }
  if (!canTransition(parsedFrom.data, parsedTo.data)) {
    throw new Error(`${ctx}: 허용되지 않은 전이 ${from} → ${to}`)
  }
}
