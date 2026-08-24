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
 * **`designer` 는 일부러 넣지 않았다.** `design_ui` 자기검증은 `S5.2b` 다 — 증거를 남기지 못하는
 * 상태에서 요구만 바꾸면 `unverifiable` 이 그대로 남고(정상), 통과시키면 그것이 무음 통과다.
 * 미지 역할도 `tc` 로 남긴다(모르는 것을 느슨하게 열지 않는다 — fail-closed).
 */
const REQUIRED_CHANNEL_BY_ROLE: Record<string, ChannelName> = {
  security: 'security',
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
    const skipped = outcomes.filter((o) => o.outcome === 'skipped').map((o) => o.channel)
    const missingChannels = [...(hasRequiredPassed ? [] : [required]), ...skipped]
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
