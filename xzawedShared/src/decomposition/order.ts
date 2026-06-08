/** id 사전순 비교자(UTF-16 코드유닛·로케일 무관, localeCompare 금지 — N4 결정론). decomposition/ 공용. */
export const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
