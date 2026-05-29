import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn().mockImplementation((cmd: string, args: string[]) => {
    // npm audit → /usr/bin/npm, pnpm audit → '' (pnpm not found)
    if (args[0] === 'pnpm') {
      return ''
    }
    return '/usr/bin/npm\n'
  }),
}))



vi.mock('node:fs/promises', () => ({
  default: { access: vi.fn() },
}))

vi.mock('../executor.js', () => ({
  validatePath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
}))

import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { validatePath } from '../executor.js'
import { auditDeps, resetPackageManagerPaths } from './deps.js'

const mockExecFile = vi.mocked(execFile)
const mockExecFileSync = vi.mocked(execFileSync)
const mockAccess = vi.mocked(fs.access)
const mockValidatePath = vi.mocked(validatePath)

type ExecCb = (err: null | Error | { stdout: string }, res?: { stdout: string }) => void

function cbSuccess(stdout = ''): ExecCb {
  return (_c, _a, _o, cb) => (cb as (err: null, r: { stdout: string }) => void)(null, { stdout })
}

const npmAuditOutput = JSON.stringify({
  vulnerabilities: {
    lodash: {
      severity: 'high',
      via: [{ title: 'Prototype Pollution', cwe: ['CWE-1321'] }],
      fixAvailable: true,
    },
    minimist: {
      severity: 'critical',
      via: [{ title: 'Prototype Pollution critical', cwe: ['CWE-1321'] }],
      fixAvailable: false,
    },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  resetPackageManagerPaths()
  mockValidatePath.mockImplementation((p: string) => Promise.resolve(p))
  // default: no pnpm-lock.yaml, package.json exists
  mockAccess.mockImplementation((p: string) => {
    if (p.endsWith('pnpm-lock.yaml')) {
      return Promise.reject(new Error('ENOENT'))
    }
    return Promise.resolve(undefined as never)
  })
  // default: npm audit succeeds with empty output
  mockExecFile.mockImplementation(cbSuccess() as never)
})

describe('auditDeps', () => {
  it('returns [] when no package.json', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT') as never)
    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toEqual([])
  })

  it('returns [] when npm not available', async () => {
    mockExecFile.mockImplementation(
      ((_c: unknown, _a: unknown, _o: unknown, cb: (err: Error) => void) => {
        cb(new Error('not found'))
      }) as never,
    )
    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toEqual([])
  })

  it('parses npm audit JSON output into SecurityIssue[]', async () => {
    mockExecFile.mockImplementationOnce(cbSuccess(npmAuditOutput) as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toHaveLength(2)
    expect(result.some((i) => i.id === 'DEP-lodash')).toBe(true)
    expect(result.find((i) => i.id === 'DEP-lodash')?.severity).toBe('high')
    expect(result.find((i) => i.id === 'DEP-minimist')?.severity).toBe('critical')
  })

  it('reads stdout from error object when npm audit exits non-zero', async () => {
    mockExecFile.mockImplementationOnce(
      ((_c: unknown, _a: unknown, _o: unknown, cb: (err: { stdout: string }) => void) => {
        cb({ stdout: npmAuditOutput })
      }) as never,
    )

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toHaveLength(2)
  })

  it('maps moderate severity to medium', async () => {
    const output = JSON.stringify({
      vulnerabilities: {
        semver: {
          severity: 'moderate',
          via: [{ title: 'ReDoS', cwe: ['CWE-400'] }],
          fixAvailable: true,
        },
      },
    })
    mockExecFile.mockImplementationOnce(cbSuccess(output) as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result[0]?.severity).toBe('medium')
  })

  it('returns [] when npm audit returns invalid JSON', async () => {
    mockExecFile.mockImplementationOnce(cbSuccess('not json') as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toEqual([])
  })
})

describe('resetPackageManagerPaths', () => {
  it('clears cached pnpm path so next call re-detects', async () => {
    // 첫 번째 호출: pnpm 없음 (execFileSync returns '' for pnpm)
    mockExecFileSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if ((args as string[])[0] === 'pnpm') return ''
      return '/usr/bin/npm\n'
    })
    // pnpm-lock.yaml 있음
    mockAccess.mockImplementation((p: string | Buffer | URL) => {
      if ((p as string).endsWith('pnpm-lock.yaml')) return Promise.resolve(undefined as never)
      return Promise.resolve(undefined as never)
    })
    // 첫 번째 auditDeps: pnpm 없으므로 npm audit 실행
    await auditDeps('/workspace/app', '/workspace')
    const callsBefore = mockExecFile.mock.calls.length

    // resetPackageManagerPaths 후 pnpm이 생긴 것처럼 mock 변경
    resetPackageManagerPaths()
    mockExecFileSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if ((args as string[])[0] === 'pnpm') return '/usr/local/bin/pnpm\n'
      return '/usr/bin/npm\n'
    })

    const pnpmAuditOutput = JSON.stringify({ advisories: {} })
    mockExecFile.mockImplementationOnce(cbSuccess(pnpmAuditOutput) as never)

    await auditDeps('/workspace/app', '/workspace')
    // 캐시가 초기화됐으므로 pnpm audit이 실행됨 (execFile 호출 횟수 증가)
    expect(mockExecFile.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})

describe('hasPnpmLock (via auditDeps)', () => {
  it('returns true path when pnpm-lock.yaml exists', async () => {
    // pnpm-lock.yaml 있음, pnpm 있음
    mockExecFileSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if ((args as string[])[0] === 'pnpm') return '/usr/local/bin/pnpm\n'
      return '/usr/bin/npm\n'
    })
    mockAccess.mockResolvedValue(undefined as never)
    resetPackageManagerPaths()

    const pnpmAuditOutput = JSON.stringify({
      advisories: {
        '1': {
          severity: 'high',
          title: 'vuln',
          cwe: ['CWE-400'],
          fixAvailable: true,
        },
      },
    })
    mockExecFile.mockImplementationOnce(cbSuccess(pnpmAuditOutput) as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    // pnpm audit 경로를 탔으므로 DEP-PNPM- prefix 사용
    expect(result.some((i) => i.id.startsWith('DEP-PNPM-'))).toBe(true)
  })

  it('returns false path when pnpm-lock.yaml does not exist', async () => {
    // pnpm-lock.yaml 없음 → npm audit 실행
    mockAccess.mockImplementation((p: string | Buffer | URL) => {
      if ((p as string).endsWith('pnpm-lock.yaml')) return Promise.reject(new Error('ENOENT'))
      return Promise.resolve(undefined as never)
    })

    mockExecFile.mockImplementationOnce(cbSuccess(npmAuditOutput) as never)
    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result.some((i) => i.id.startsWith('DEP-lodash') || i.id.startsWith('DEP-minimist'))).toBe(true)
  })
})

describe('runPnpmAudit (via auditDeps)', () => {
  beforeEach(() => {
    // pnpm 있음
    mockExecFileSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if ((args as string[])[0] === 'pnpm') return '/usr/local/bin/pnpm\n'
      return '/usr/bin/npm\n'
    })
    // pnpm-lock.yaml 있음
    mockAccess.mockResolvedValue(undefined as never)
    resetPackageManagerPaths()
  })

  it('converts pnpm audit --json output to SecurityIssue[]', async () => {
    const pnpmAuditOutput = JSON.stringify({
      advisories: {
        '101': {
          severity: 'critical',
          title: 'Remote Code Execution',
          cwe: ['CWE-94'],
          fixAvailable: true,
        },
        '202': {
          severity: 'moderate',
          title: 'Prototype Pollution',
          cwe: ['CWE-1321'],
          fixAvailable: false,
        },
      },
    })
    mockExecFile.mockImplementationOnce(cbSuccess(pnpmAuditOutput) as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toHaveLength(2)
    expect(result.find((i) => i.id === 'DEP-PNPM-101')?.severity).toBe('critical')
    expect(result.find((i) => i.id === 'DEP-PNPM-202')?.severity).toBe('medium')
    expect(result.find((i) => i.id === 'DEP-PNPM-101')?.cwe).toBe('CWE-94')
  })

  it('reads stdout from error object when pnpm audit exits non-zero', async () => {
    const pnpmAuditOutput = JSON.stringify({
      advisories: {
        '999': {
          severity: 'high',
          title: 'SQL Injection',
          cwe: ['CWE-89'],
          fixAvailable: true,
        },
      },
    })
    mockExecFile.mockImplementationOnce(
      ((_c: unknown, _a: unknown, _o: unknown, cb: (err: { stdout: string }) => void) => {
        cb({ stdout: pnpmAuditOutput })
      }) as never,
    )

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('DEP-PNPM-999')
  })

  it('returns [] when pnpm audit output is invalid JSON', async () => {
    mockExecFile.mockImplementationOnce(cbSuccess('not json') as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toEqual([])
  })

  it('falls back to npm when pnpm-lock.yaml exists but pnpm is not found', async () => {
    // pnpm 없음으로 재설정
    mockExecFileSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if ((args as string[])[0] === 'pnpm') return ''
      return '/usr/bin/npm\n'
    })
    resetPackageManagerPaths()

    mockExecFile.mockImplementationOnce(cbSuccess(npmAuditOutput) as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    // npm audit 결과 (DEP- prefix, no DEP-PNPM-)
    expect(result.every((i) => !i.id.startsWith('DEP-PNPM-'))).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })
})
