import type { WorkPackage } from '@xzawed/agent-streams'
import { DONE_STATE } from './dispatch-constants.js'
import type { ChannelOutcome, ReleaseGateResult, WpGateView } from '../db/release-gate.types.js'

/** WP별 증거를 집계해 릴리스 게이트 판정. evidence가 required 집합을 인코딩(develop_code/run_tests/build만 행 존재). */
export function evaluateReleaseGate(
  workPackages: WorkPackage[],
  evidenceByWp: Map<string, ChannelOutcome[]>,
): ReleaseGateResult {
  const perWp: WpGateView[] = []
  const blockingReasons: string[] = []
  const sorted = [...workPackages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const wp of sorted) {
    const outcomes = evidenceByWp.get(wp.id) ?? []
    if (outcomes.length === 0) {
      perWp.push({ wpId: wp.id, proven: false, unverifiable: true, missingChannels: [] })
      blockingReasons.push(`wp ${wp.id}: 검증 증거 없음 — 검증 불가 도구 유형 또는 미영속(un-proven)`)
      continue
    }
    const hasTcPassed = outcomes.some((o) => o.channel === 'tc' && o.outcome === 'passed')
    const skipped = outcomes.filter((o) => o.outcome === 'skipped').map((o) => o.channel)
    const missingChannels = [...(hasTcPassed ? [] : (['tc'] as const)), ...skipped]
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
  done.sort()
  let h = 5381
  const s = done.join('|')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}
