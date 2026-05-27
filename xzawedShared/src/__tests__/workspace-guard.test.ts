import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { validateWorkspaceRoot, resolveWorkspaceRoot } from '../workspace-guard.js'

describe('validateWorkspaceRoot', () => {
  it('일반 디렉토리는 통과한다', () => {
    expect(() => validateWorkspaceRoot('/workspace/project')).not.toThrow()
  })

  it('파일시스템 루트이면 오류를 던진다', () => {
    expect(() => validateWorkspaceRoot('/')).toThrow('WORKSPACE_ROOT must not be filesystem root')
  })

  it('빈 문자열이면 오류를 던진다', () => {
    expect(() => validateWorkspaceRoot('')).toThrow('WORKSPACE_ROOT must not be empty')
  })

  it('공백 문자열이면 오류를 던진다', () => {
    expect(() => validateWorkspaceRoot('   ')).toThrow('WORKSPACE_ROOT must not be empty')
  })

  it('후행 슬래시가 있는 일반 경로는 통과한다', () => {
    expect(() => validateWorkspaceRoot('/workspace/project/')).not.toThrow()
  })
})

describe('resolveWorkspaceRoot', () => {
  const originalEnv = process.env['WORKSPACE_ROOT']

  beforeEach(() => {
    delete process.env['WORKSPACE_ROOT']
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['WORKSPACE_ROOT'] = originalEnv
    } else {
      delete process.env['WORKSPACE_ROOT']
    }
  })

  it('userContext.workspaceRoot가 있으면 그것을 반환한다', () => {
    const result = resolveWorkspaceRoot({ workspaceRoot: '/from/context' }, undefined)
    expect(result).toBe('/from/context')
  })

  it('userContext가 없고 fallback이 있으면 fallback을 반환한다', () => {
    const result = resolveWorkspaceRoot(undefined, '/from/fallback')
    expect(result).toBe('/from/fallback')
  })

  it('userContext와 fallback이 없고 WORKSPACE_ROOT env가 있으면 env를 반환한다', () => {
    process.env['WORKSPACE_ROOT'] = '/from/env'
    const result = resolveWorkspaceRoot(undefined, undefined)
    expect(result).toBe('/from/env')
  })

  it('userContext, fallback, env 모두 없으면 오류를 던진다', () => {
    expect(() => resolveWorkspaceRoot(undefined, undefined)).toThrow(
      'workspaceRoot를 결정할 수 없습니다: userContext, fallback, WORKSPACE_ROOT 모두 미설정',
    )
  })
})
