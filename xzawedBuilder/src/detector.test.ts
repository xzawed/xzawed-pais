import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { detectBuildCommand } from './detector.js'
import * as fs from 'node:fs/promises'

const fsMock = vi.mocked(fs)

// Helper: make fs.access succeed for a set of filenames, reject for all others
function mockAccess(...existingFiles: string[]) {
  fsMock.access.mockImplementation(async (p) => {
    const filePath = String(p)
    if (existingFiles.some(f => filePath.endsWith(f))) return undefined as any
    throw new Error('ENOENT')
  })
}

describe('detectBuildCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // --- Cargo ---

  it('Cargo.toml이 있으면 cargo build --release를 반환한다', async () => {
    mockAccess('Cargo.toml')
    const result = await detectBuildCommand('/project')
    expect(result).toBe('cargo build --release')
  })

  // --- Makefile ---

  it('Cargo.toml이 없고 Makefile이 있으면 make build를 반환한다', async () => {
    mockAccess('Makefile')
    const result = await detectBuildCommand('/project')
    expect(result).toBe('make build')
  })

  // --- package.json (dependency-based detection, never scripts.build) ---

  it('package.json에 vite 의존성이 있으면 pnpm run build를 반환한다', async () => {
    mockAccess('package.json')
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } }) as any
    )
    const result = await detectBuildCommand('/project')
    expect(result).toBe('pnpm run build')
  })

  it('package.json에 webpack 의존성이 있으면 pnpm run build를 반환한다', async () => {
    mockAccess('package.json')
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ devDependencies: { webpack: '^5.0.0' } }) as any
    )
    const result = await detectBuildCommand('/project')
    expect(result).toBe('pnpm run build')
  })

  it('package.json에 typescript 의존성이 있으면 pnpm run build를 반환한다', async () => {
    mockAccess('package.json')
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }) as any
    )
    const result = await detectBuildCommand('/project')
    expect(result).toBe('pnpm run build')
  })

  it('package.json에 알려진 빌드 도구가 없으면 기본값 pnpm run build를 반환한다', async () => {
    mockAccess('package.json')
    fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ name: 'myapp' }) as any)
    const result = await detectBuildCommand('/project')
    expect(result).toBe('pnpm run build')
  })

  it('scripts.build 필드가 있어도 그 값을 사용하지 않는다', async () => {
    mockAccess('package.json')
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ scripts: { build: 'rm -rf / && echo pwned' } }) as any
    )
    const result = await detectBuildCommand('/project')
    // Must NOT return the injected script — always returns a hardcoded safe command
    expect(result).toBe('pnpm run build')
    expect(result).not.toContain('pwned')
  })

  it('package.json 파싱 실패 시 pnpm run build를 반환한다', async () => {
    mockAccess('package.json')
    fsMock.readFile.mockRejectedValueOnce(new Error('EACCES'))
    const result = await detectBuildCommand('/project')
    expect(result).toBe('pnpm run build')
  })

  // --- go.mod ---

  it('package.json도 없고 go.mod가 있으면 go build ./...를 반환한다', async () => {
    mockAccess('go.mod')
    const result = await detectBuildCommand('/project')
    expect(result).toBe('go build ./...')
  })

  // --- nothing ---

  it('아무 파일도 없으면 오류를 던진다', async () => {
    fsMock.access.mockRejectedValue(new Error('ENOENT'))
    await expect(detectBuildCommand('/project')).rejects.toThrow('빌드 명령을 감지할 수 없음')
  })
})
