import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { validateWorkspaceRoot, resolveWorkspaceRoot, hasTraversalSegment, isSafeRelativePath } from '../workspace-guard.js'

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

describe('hasTraversalSegment — 세그먼트 판정', () => {
  // 부분문자열 검사가 **오거부하던** 정상 파일명들. 전부 통과해야 한다.
  it.each([
    ['patches/v1..v2.diff', '버전 구분자로 쓰인 점 두 개'],
    ['src/..hidden.ts', '리딩 점 두 개'],
    ['a..b/c.ts', '디렉토리명 안의 점 두 개'],
    ['report..md', '확장자 앞 점 두 개'],
    ['src/app.ts', '평범한 상대경로'],
    ['', '빈 문자열'],
  ])('%s (%s) 는 traversal 이 아니다', (p) => {
    expect(hasTraversalSegment(p)).toBe(false)
  })

  // 진짜 상위 이동. 전부 잡아야 한다.
  it.each([
    ['../etc/passwd', '앞선 상위 이동'],
    ['a/../b', '중간 상위 이동'],
    ['a/..', '끝의 상위 이동'],
    ['..', '자기 자신'],
    ['a\\..\\b', 'Windows 백슬래시'],
    ['a//../b', '연속 구분자'],
    ['a/./../b', '점 하나를 섞은 것'],
  ])('%s (%s) 는 traversal 이다', (p) => {
    expect(hasTraversalSegment(p)).toBe(true)
  })
})

describe('isSafeRelativePath', () => {
  it('정상 상대경로는 통과한다', () => {
    expect(isSafeRelativePath('patches/v1..v2.diff')).toBe(true)
    expect(isSafeRelativePath('src/app.ts')).toBe(true)
  })

  it('절대경로는 거부한다', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
  })

  it('traversal 은 거부한다', () => {
    expect(isSafeRelativePath('../etc/passwd')).toBe(false)
    expect(isSafeRelativePath('a/../../etc/passwd')).toBe(false)
  })
})
