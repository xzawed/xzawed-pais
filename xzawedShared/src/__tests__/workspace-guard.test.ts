import { describe, it, expect } from 'vitest'
import { validateWorkspaceRoot } from '../workspace-guard.js'

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
