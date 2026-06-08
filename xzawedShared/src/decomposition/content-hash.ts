import { createHash } from 'node:crypto'
import { byId } from './order.js'

/** content-hash 입력 = WP의 의미 정체성 필드(휘발/그래프 구조 필드 제외). */
export interface WpHashInput {
  storyId: string
  owningRole: string
  acceptanceCriteria: string[]
}

/**
 * §6 P7 안정 WP id. 같은 의미 내용 → 같은 id(N4 재진입 안정).
 * 형식 "wp_" + sha256 hex 32자(128bit). status·oracleRef·dependencies·attributionCounters는
 * 제외 — 상태 변화·oracle 부착·의존 변경이 id를 바꾸지 않는다(스펙 §4.2).
 */
export function contentHashId(content: WpHashInput): string {
  // canonical: 키 고정 순서 + acceptanceCriteria 정렬(입력 순서 무관). 원본 배열 불변(복사 정렬).
  const canonical = JSON.stringify({
    storyId: content.storyId,
    owningRole: content.owningRole,
    acceptanceCriteria: [...content.acceptanceCriteria].sort(byId),
  })
  const hex = createHash('sha256').update(canonical).digest('hex')
  return `wp_${hex.slice(0, 32)}`
}
