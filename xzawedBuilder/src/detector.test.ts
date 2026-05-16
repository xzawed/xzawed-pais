import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { detectBuildCommand } from './detector.js'
import * as fs from 'node:fs/promises'

const fsMock = vi.mocked(fs)

describe('detectBuildCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('package.json에 scripts.build가 있으면 그 값을 반환한다', async () => {
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { build: 'tsc --noEmit' } }) as any
    )
    const result = await detectBuildCommand('/project')
    expect(result).toBe('tsc --noEmit')
  })

  it('package.json에 scripts.build가 없으면 pnpm run build를 반환한다', async () => {
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ name: 'myapp' }) as any)
    const result = await detectBuildCommand('/project')
    expect(result).toBe('pnpm run build')
  })

  it('package.json이 없고 Cargo.toml이 있으면 cargo build를 반환한다', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    fsMock.access.mockResolvedValueOnce(undefined as any) // Cargo.toml 존재
    const result = await detectBuildCommand('/project')
    expect(result).toBe('cargo build --release')
  })

  it('package.json, Cargo.toml이 없고 Makefile이 있으면 make build를 반환한다', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    fsMock.access.mockRejectedValueOnce(new Error('ENOENT')) // Cargo.toml 없음
    fsMock.access.mockResolvedValueOnce(undefined as any) // Makefile 존재
    const result = await detectBuildCommand('/project')
    expect(result).toBe('make build')
  })

  it('아무 파일도 없으면 오류를 던진다', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('ENOENT'))
    fsMock.access.mockRejectedValue(new Error('ENOENT'))
    await expect(detectBuildCommand('/project')).rejects.toThrow('빌드 명령을 감지할 수 없음')
  })
})
