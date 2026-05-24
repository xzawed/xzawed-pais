import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import fs from 'node:fs/promises'
import { detectTestCommand, buildCommandWithFiles, parseTestCounts } from './detector.js'

const mockFs = vi.mocked(fs)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('detectTestCommand', () => {
  it('detects vitest from devDependencies (ignores scripts.test for safety)', async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^2.0.0' } }) as unknown as Buffer
    )
    const cmd = await detectTestCommand('/project')
    expect(cmd).toBe('pnpm vitest run')
  })

  it('skips echo-style scripts and falls back to devDeps', async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { test: 'echo "no tests"' }, devDependencies: { vitest: '^2.0.0' } }) as unknown as Buffer
    )
    const cmd = await detectTestCommand('/project')
    expect(cmd).toBe('pnpm vitest run')
  })

  it('detects jest from devDependencies', async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ devDependencies: { jest: '^29.0.0' } }) as unknown as Buffer
    )
    const cmd = await detectTestCommand('/project')
    expect(cmd).toBe('pnpm jest')
  })

  it('falls back to cargo test for Rust project', async () => {
    mockFs.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    mockFs.access.mockResolvedValueOnce(undefined)
    const cmd = await detectTestCommand('/project')
    expect(cmd).toBe('cargo test')
  })

  it('returns pnpm test as fallback when scripts.test absent and no known deps', async () => {
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: {} }) as unknown as Buffer
    )
    const cmd = await detectTestCommand('/project')
    expect(cmd).toBe('pnpm test')
  })
})

describe('buildCommandWithFiles', () => {
  it('appends test files to base command', () => {
    expect(buildCommandWithFiles('vitest run', ['src/a.test.ts', 'src/b.test.ts']))
      .toBe('vitest run src/a.test.ts src/b.test.ts')
  })

  it('returns base command unchanged when no files', () => {
    expect(buildCommandWithFiles('vitest run', [])).toBe('vitest run')
  })

  it('rejects testFiles paths containing whitespace', () => {
    const withSpaces = [
      'foo.test.ts; rm -rf /',
      'foo.test.ts && cat /etc/passwd',
      'foo.test.ts | tee /tmp/out',
      'foo.test.ts $HOME',
      'foo.test.ts > /tmp/x',
    ]
    for (const filePath of withSpaces) {
      expect(() => buildCommandWithFiles('vitest run', [filePath])).toThrow('Whitespace in testFiles path is not permitted')
    }
  })

  it('rejects testFiles paths containing shell metacharacters (no spaces)', () => {
    const dangerous = [
      'foo.test.ts;rm',
      'foo.test.ts`whoami`',
      'foo.test.ts\necho',
    ]
    for (const filePath of dangerous) {
      expect(() => buildCommandWithFiles('vitest run', [filePath])).toThrow('Shell metacharacters')
    }
  })
})

describe('parseTestCounts', () => {
  it('parses vitest output', () => {
    const output = 'Tests  42 passed (45)\n3 failed'
    const { passed, failed } = parseTestCounts(output)
    expect(passed).toBe(42)
    expect(failed).toBe(3)
  })

  it('parses jest output', () => {
    const output = 'Tests: 3 failed, 39 passed, 42 total'
    const { passed, failed } = parseTestCounts(output)
    expect(passed).toBe(39)
    expect(failed).toBe(3)
  })

  it('parses jest output with Test Suites line (counts tests not suites)', () => {
    const output = 'Test Suites: 1 passed, 1 total\nTests: 26 passed, 26 total'
    const { passed, failed } = parseTestCounts(output)
    expect(passed).toBe(26)
    expect(failed).toBe(0)
  })

  it('returns 0/0 for unrecognized output', () => {
    const { passed, failed } = parseTestCounts('no test info here')
    expect(passed).toBe(0)
    expect(failed).toBe(0)
  })
})
