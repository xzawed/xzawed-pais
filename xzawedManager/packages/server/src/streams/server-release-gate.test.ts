import { describe, it, expect } from 'vitest'
import { releaseGateWarnings } from './server-release-gate.js'
describe('releaseGateWarnings', () => {
  it('warns when releaseGate on but TASK_MANAGER/WP_VERIFY off, or no pool', () => {
    expect(releaseGateWarnings({ releaseGate: true, taskManager: false, wpVerify: true, hasPool: true }).join(' ')).toContain('TASK_MANAGER_ENABLED')
    expect(releaseGateWarnings({ releaseGate: true, taskManager: true, wpVerify: false, hasPool: true }).join(' ')).toContain('MANAGER_WP_VERIFY')
    expect(releaseGateWarnings({ releaseGate: true, taskManager: true, wpVerify: true, hasPool: false }).join(' ')).toContain('DATABASE_URL')
  })
  it('no warnings when off or fully configured', () => {
    expect(releaseGateWarnings({ releaseGate: false, taskManager: false, wpVerify: false, hasPool: false })).toEqual([])
    expect(releaseGateWarnings({ releaseGate: true, taskManager: true, wpVerify: true, hasPool: true })).toEqual([])
  })
})
