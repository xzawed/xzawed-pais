import { describe, it, expect } from 'vitest'
import { judgePrimaryResult, planVerificationChecks } from './verify.js'

describe('judgePrimaryResult — 결과-근거 판정(fail-closed)', () => {
  it('run_tests: success=true·failed=0 → ok', () => {
    expect(judgePrimaryResult('run_tests', { success: true, failed: 0, passed: 3 })).toEqual({ ok: true })
  })
  it('run_tests: success=false → fail(사유 포함)', () => {
    const v = judgePrimaryResult('run_tests', { success: false, failed: 2 })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('run_tests')
  })
  it('run_tests: success=true라도 failed>0 → fail', () => {
    expect(judgePrimaryResult('run_tests', { success: true, failed: 1 }).ok).toBe(false)
  })
  it('run_tests: 필드 부재(파싱 실패) → fail — 기본값에 기대지 않는 fail-closed', () => {
    expect(judgePrimaryResult('run_tests', { passed: 3 }).ok).toBe(false)
    expect(judgePrimaryResult('run_tests', null).ok).toBe(false)
    expect(judgePrimaryResult('run_tests', 'ok').ok).toBe(false)
  })
  it('build_project: success=true → ok / false·부재 → fail', () => {
    expect(judgePrimaryResult('build_project', { success: true })).toEqual({ ok: true })
    expect(judgePrimaryResult('build_project', { success: false }).ok).toBe(false)
    expect(judgePrimaryResult('build_project', {}).ok).toBe(false)
  })
  it('결과-근거 채널 비적용 도구(develop_code·design_ui·security_audit) → ok(pass-through)', () => {
    expect(judgePrimaryResult('develop_code', { artifacts: [] })).toEqual({ ok: true })
    expect(judgePrimaryResult('design_ui', null)).toEqual({ ok: true })
    expect(judgePrimaryResult('security_audit', undefined)).toEqual({ ok: true })
  })
})

describe('planVerificationChecks — 파생 체크 플랜', () => {
  it('develop_code → 빌드 먼저, 테스트 다음(fail-fast 순서)', () => {
    expect(planVerificationChecks('develop_code')).toEqual(['build_project', 'run_tests'])
  })
  it('그 외 도구(자기결과가 ground truth거나 채널 부재) → 빈 플랜', () => {
    expect(planVerificationChecks('run_tests')).toEqual([])
    expect(planVerificationChecks('build_project')).toEqual([])
    expect(planVerificationChecks('design_ui')).toEqual([])
    expect(planVerificationChecks('security_audit')).toEqual([])
  })
})
