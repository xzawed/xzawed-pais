// P5-1 릴리스 게이트 오진 방지 경고(순수·테스트 가능). 전제: TASK_MANAGER_ENABLED + MANAGER_WP_VERIFY + DATABASE_URL.
export function releaseGateWarnings(c: { releaseGate: boolean; taskManager: boolean; wpVerify: boolean; hasPool: boolean }): string[] {
  if (!c.releaseGate) return []
  const w: string[] = []
  if (!c.hasPool) w.push('MANAGER_RELEASE_GATE=true 이지만 DATABASE_URL이 없어 게이트가 동작하지 않습니다(증거·게이트 미영속).')
  if (!c.taskManager) w.push('MANAGER_RELEASE_GATE=true 이지만 TASK_MANAGER_ENABLED가 꺼져 있어 워커/완료 경로가 없어 게이트가 동작하지 않습니다.')
  if (!c.wpVerify) w.push('MANAGER_RELEASE_GATE=true 이지만 MANAGER_WP_VERIFY가 꺼져 있어 검증 증거가 수집되지 않습니다(모든 WP unverifiable→CLOSED).')
  return w
}
