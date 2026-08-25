import type { WorkPackage } from '@xzawed/agent-streams'
import { DONE_STATE } from './dispatch-constants.js'
import type { ChannelName, ChannelOutcome, ReleaseGateResult, WpGateView } from '../db/release-gate.types.js'

/**
 * WP 가 **무엇을 내기로 했는지**에 따라 요구 증거가 다르다(S5.2a).
 *
 * 이전에는 모든 WP 에 `tc: passed` 를 요구했는데, `security` 역할 WP 는 **돌릴 테스트가 없어**
 * 영원히 미증명이었다 — S5.2a 가 자기검증으로 증거를 남기게 만들어도 게이트가 여전히 막는다.
 * 요구 채널을 역할에서 파생해 그 자리를 푼다.
 *
 * **`designer` 는 `S5.2b` 에서 들어왔다.** S5.2a 시점에는 일부러 뺐다 — 증거를 남기지 못하는
 * 상태에서 요구만 바꾸면 `unverifiable` 이 그대로 남고(정상), 통과시키면 그것이 무음 통과이기
 * 때문이다. 이제 `judgeDesignUiWp` 가 `design: passed` 를 남기므로 요구가 성립한다.
 * **역할을 여기 추가하기 전에 그 역할이 증거를 남기는지 먼저 확인한다** — 순서를 뒤집으면
 * 그 워크플로가 영구 blocked 가 되거나(증거 없음) 무음 통과가 된다(요구 없음).
 * 미지 역할도 `tc` 로 남긴다(모르는 것을 느슨하게 열지 않는다 — fail-closed).
 */
const REQUIRED_CHANNEL_BY_ROLE: Record<string, ChannelName> = {
  security: 'security',
  designer: 'design',
}
const DEFAULT_REQUIRED_CHANNEL: ChannelName = 'tc'

function requiredChannelFor(wp: WorkPackage): ChannelName {
  return REQUIRED_CHANNEL_BY_ROLE[wp.owningRole] ?? DEFAULT_REQUIRED_CHANNEL
}

/** WP별 증거를 집계해 릴리스 게이트 판정. 요구 채널은 owningRole 에서 파생(S5.2a). */
export function evaluateReleaseGate(
  workPackages: WorkPackage[],
  evidenceByWp: Map<string, ChannelOutcome[]>,
): ReleaseGateResult {
  const perWp: WpGateView[] = []
  const blockingReasons: string[] = []
  const sorted = [...workPackages].sort((a, b) => a.id.localeCompare(b.id))
  for (const wp of sorted) {
    const outcomes = evidenceByWp.get(wp.id) ?? []
    if (outcomes.length === 0) {
      perWp.push({ wpId: wp.id, proven: false, unverifiable: true, missingChannels: [] })
      blockingReasons.push(`wp ${wp.id}: 검증 증거 없음 — 검증 불가 도구 유형 또는 미영속(un-proven)`)
      continue
    }
    const required = requiredChannelFor(wp)
    const hasRequiredPassed = outcomes.some((o) => o.channel === required && o.outcome === 'passed')
    // **통과도 비대상도 아닌 것은 전부 미증명이다**(S5.3a). 이전엔 `=== 'skipped'` 로 좁혀
    // 셌는데, 그러면 **미지의 outcome 종류가 조용히 통과**한다 — 모르는 것을 느슨하게 여는 쪽이라
    // 역할 맵의 fail-closed 기본값과 어긋난다. 여기서 뒤집어 두면 새 종류는 기본이 차단이다.
    //
    // 비대상을 세지 않는 근거. 채널이 켜진 채 실패하면 `verifyWp` 가 완료를 발행하지 않아 WP 가
    // DONE 에 못 간다 — 즉 게이트가 보는 WP 는 **이미 검증을 통과한 것들**이고, 거기서 설정상
    // 비대상인 채널을 미증명으로 세는 것은 이중 판정이다. 검증 채널 5종은 전부 기본 off 이므로
    // 그렇게 세면 테스트를 통과한 WP 조차 "미증명 채널 5개"로 영구 차단된다.
    const unproven = outcomes
      .filter((o) => o.outcome !== 'passed' && o.outcome !== 'not_applicable')
      .map((o) => o.channel)
    const missingChannels = [...(hasRequiredPassed ? [] : [required]), ...unproven]
    const proven = missingChannels.length === 0
    perWp.push({ wpId: wp.id, proven, unverifiable: false, missingChannels })
    if (!proven) blockingReasons.push(`wp ${wp.id}: 미증명 채널 [${missingChannels.join(', ')}]`)
  }
  return { status: perWp.every((v) => v.proven) ? 'passed' : 'blocked', perWp, blockingReasons }
}

/** 그래프 전 WP가 DONE인지(미완·ESCALATED 잔존 시 false). */
export function allWpDone(
  workPackages: WorkPackage[],
  states: Map<string, { toState: string }>,
): boolean {
  return workPackages.length > 0 && workPackages.every((wp) => states.get(wp.id)?.toState === DONE_STATE)
}

/** 완료 WP 집합의 결정론 버전 — 재작업(새 DONE seq) 시 변경(재게이트), 동일 집합은 멱등. */
export function doneSetVersion(states: Map<string, { toState: string; seq: number }>): string {
  const done: string[] = []
  for (const [wpId, rec] of states) if (rec.toState === DONE_STATE) done.push(`${wpId}:${rec.seq}`)
  done.sort((a, b) => a.localeCompare(b))
  const s = done.join('|')
  // FNV-1a 32-bit (결정론). Math.imul로 32비트 곱셈 오버플로를 안전 처리(bitwise `| 0` 회피).
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.codePointAt(i) ?? 0
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
