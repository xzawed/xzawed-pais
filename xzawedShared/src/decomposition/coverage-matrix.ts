import { byId } from './order.js'

/** 한 Story가 덮는(claim) 산출물 id 목록. */
export interface StoryCoverage {
  storyId: string
  deliverableIds: string[]
}

/** 스토리×산출물 대조 결과. 모든 배열 id 사전순(결정론). */
export interface CoverageMatrix {
  /** 어느 스토리도 덮지 않는 산출물 id(빈 컬럼 = 갭). */
  gaps: string[]
  /** 2개 이상 스토리가 덮는 산출물(다중 주장 = 중복). repair 타깃팅용 storyIds 동반. */
  overlaps: Array<{ deliverableId: string; storyIds: string[] }>
  /** 산출물 인벤토리에 없는 id를 주장한 스토리(구조 무결성 가드). */
  unknownClaims: Array<{ storyId: string; deliverableId: string }>
}

/**
 * §6 P4 "100% 규칙" 검증. 갭·중복·unknown을 데이터로 보고(throw 아님 — 수선은 P2-2 LLM 책임).
 * 같은 스토리 내 산출물 중복 나열은 1회로 집합화. 모든 출력 id 사전순.
 */
export function coverageMatrix(stories: StoryCoverage[], deliverables: string[]): CoverageMatrix {
  const inventory = new Set(deliverables)
  const claims = new Map<string, Set<string>>() // deliverableId → 주장 스토리 집합
  const unknownClaims: Array<{ storyId: string; deliverableId: string }> = []

  for (const story of stories) {
    const seen = new Set<string>() // 같은 스토리 내 중복 나열 1회화
    for (const did of story.deliverableIds) {
      if (seen.has(did)) continue
      seen.add(did)
      if (!inventory.has(did)) {
        unknownClaims.push({ storyId: story.storyId, deliverableId: did })
        continue
      }
      let claimants = claims.get(did)
      if (!claimants) {
        claimants = new Set()
        claims.set(did, claimants)
      }
      claimants.add(story.storyId)
    }
  }

  const gaps: string[] = []
  const overlaps: Array<{ deliverableId: string; storyIds: string[] }> = []
  for (const did of inventory) {
    const claimants = claims.get(did)
    if (!claimants || claimants.size === 0) gaps.push(did)
    else if (claimants.size >= 2) overlaps.push({ deliverableId: did, storyIds: [...claimants].sort(byId) })
  }

  // 인벤토리는 Set이라 삽입 순서로 순회된다 — 아래 정렬로 출력 결정론을 보장(입력 순서 무관).
  gaps.sort(byId)
  overlaps.sort((a, b) => byId(a.deliverableId, b.deliverableId))
  unknownClaims.sort((a, b) => byId(a.storyId, b.storyId) || byId(a.deliverableId, b.deliverableId))

  return { gaps, overlaps, unknownClaims }
}
