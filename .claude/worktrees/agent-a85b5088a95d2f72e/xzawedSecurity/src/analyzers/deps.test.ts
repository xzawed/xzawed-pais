import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

vi.mock('node:fs/promises', () => ({
  default: { access: vi.fn() },
}))

vi.mock('../executor.js', () => ({
  validatePath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
}))

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { validatePath } from '../executor.js'
import { auditDeps } from './deps.js'

const mockExecFile = vi.mocked(execFile)
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
  mockValidatePath.mockImplementation((p: string) => Promise.resolve(p))
  mockAccess.mockResolvedValue(undefined as never)
  // default: npm where/which check succeeds
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
    mockExecFile
      .mockImplementationOnce(cbSuccess() as never)
      .mockImplementationOnce(cbSuccess(npmAuditOutput) as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toHaveLength(2)
    expect(result.some((i) => i.id === 'DEP-lodash')).toBe(true)
    expect(result.find((i) => i.id === 'DEP-lodash')?.severity).toBe('high')
    expect(result.find((i) => i.id === 'DEP-minimist')?.severity).toBe('critical')
  })

  it('reads stdout from error object when npm audit exits non-zero', async () => {
    mockExecFile
      .mockImplementationOnce(cbSuccess() as never)
      .mockImplementationOnce(
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
    mockExecFile
      .mockImplementationOnce(cbSuccess() as never)
      .mockImplementationOnce(cbSuccess(output) as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result[0]?.severity).toBe('medium')
  })

  it('returns [] when npm audit returns invalid JSON', async () => {
    mockExecFile
      .mockImplementationOnce(cbSuccess() as never)
      .mockImplementationOnce(cbSuccess('not json') as never)

    const result = await auditDeps('/workspace/app', '/workspace')
    expect(result).toEqual([])
  })
})
