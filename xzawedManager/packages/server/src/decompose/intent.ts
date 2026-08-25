/**
 * 분해 입력(`intent`) 정규화 — **경계마다 흩어져 있던 판정을 하나로 모은 것**(S7.2).
 *
 * 처음엔 각 경계에 `.length > 0` 을 흩어 두었다. `"   "` 가 전부 통과했고, 고친 뒤에도
 * **다섯 번째 경계**(소비자의 `payload.intent ?? storedIntent`)가 남아 공백이 저장된 스펙을
 * 이기고 그 다음 `upsertGraph` 가 그것을 버려 **원 스펙이 삭제**됐다 — 원래 구멍보다 나쁘다.
 * 판정이 여러 곳에 복제되면 그중 하나는 반드시 어긋난다는 것을 두 번 확인했으므로 여기로 모은다.
 *
 * **공백만이 아니라 폭 0 문자도 내용이 아니다.** `trim()` 은 `U+200B`(ZWSP)·`U+FEFF` 를 지우지
 * 않아 "보이지 않는 스펙"이 통과한다 — 적대적 입력이 아니라 붙여넣기로도 생긴다.
 */

/** 내용 판정에서 제외할 문자 — 일반 공백 + 폭 0 문자(ZWSP·ZWNJ·ZWJ·BOM). */
const INVISIBLE = /[\s​-‍﻿]/g

/**
 * 보이는 내용이 있으면 앞뒤 공백을 다듬어 돌려주고, 없으면 `null`.
 *
 * 반환값이 `null` 이면 **"분해 입력이 없다"** 와 같게 다뤄야 한다 — 저장하지 않고, 전선에
 * 싣지 않고, 재분해를 돌리지 않고, 기존 값을 덮지 않는다.
 */
export function normalizeIntent(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.replace(INVISIBLE, '').length === 0) return null
  return value.trim()
}
