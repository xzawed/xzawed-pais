import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { validatePath, applyChange, cleanupOldBakFiles } from './fileio.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'developer-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('validatePath', () => {
  it('allows path inside workspace root', async () => {
    const filePath = path.join(tmpDir, 'src', 'app.ts')
    const result = await validatePath(filePath, tmpDir)
    expect(result).toBe(path.resolve(filePath))
  })

  it('rejects path outside workspace root', async () => {
    const outside = path.join(tmpDir, '..', 'outside.ts')
    await expect(validatePath(outside, tmpDir)).rejects.toThrow('경로 거부')
  })

  it('rejects absolute path traversal', async () => {
    await expect(validatePath('/etc/passwd', tmpDir)).rejects.toThrow('경로 거부')
  })

  it('handles non-existent file (uses resolve fallback)', async () => {
    const newFile = path.join(tmpDir, 'new-file.ts')
    const result = await validatePath(newFile, tmpDir)
    expect(result).toBe(path.resolve(newFile))
  })
})

describe('applyChange', () => {
  it('creates a new file', async () => {
    const filePath = path.join(tmpDir, 'new.ts')
    await applyChange({ path: filePath, operation: 'create', content: 'export {}' }, tmpDir)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('export {}')
  })

  it('creates parent directories automatically', async () => {
    const filePath = path.join(tmpDir, 'src', 'deep', 'file.ts')
    await applyChange({ path: filePath, operation: 'create', content: 'hello' }, tmpDir)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('hello')
  })

  it('modifies an existing file', async () => {
    const filePath = path.join(tmpDir, 'existing.ts')
    await fs.writeFile(filePath, 'old content', 'utf-8')
    await applyChange({ path: filePath, operation: 'modify', content: 'new content' }, tmpDir)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('new content')
  })

  it('deletes a file by renaming to .bak', async () => {
    const filePath = path.join(tmpDir, 'to-delete.ts')
    await fs.writeFile(filePath, 'delete me', 'utf-8')
    await applyChange({ path: filePath, operation: 'delete' }, tmpDir)
    await expect(fs.access(filePath)).rejects.toThrow()
    const entries = await fs.readdir(tmpDir)
    expect(entries.some((e) => e.startsWith('to-delete.ts.bak.'))).toBe(true)
  })

  it('writes empty string when content is absent on create', async () => {
    const filePath = path.join(tmpDir, 'empty.ts')
    await applyChange({ path: filePath, operation: 'create' }, tmpDir)
    const content = await fs.readFile(filePath, 'utf-8')
    expect(content).toBe('')
  })

  it('throws for path outside workspace', async () => {
    const outside = path.join(tmpDir, '..', 'evil.ts')
    await expect(
      applyChange({ path: outside, operation: 'create', content: '' }, tmpDir)
    ).rejects.toThrow('경로 거부')
  })
})

describe('cleanupOldBakFiles', () => {
  it('deletes .bak.{timestamp} files older than maxAgeDays', async () => {
    // 8일 전 timestamp
    const oldTs = Date.now() - 8 * 24 * 60 * 60 * 1000
    const oldBak = path.join(tmpDir, `file.ts.bak.${oldTs}`)
    await fs.writeFile(oldBak, 'old', 'utf-8')
    // mtime을 8일 전으로 조정
    const oldDate = new Date(oldTs)
    await fs.utimes(oldBak, oldDate, oldDate)

    const removed = await cleanupOldBakFiles(tmpDir, 7)
    expect(removed).toBe(1)
    await expect(fs.access(oldBak)).rejects.toThrow()
  })

  it('keeps .bak.{timestamp} files newer than maxAgeDays', async () => {
    // 3일 전 timestamp (7일 미만)
    const recentTs = Date.now() - 3 * 24 * 60 * 60 * 1000
    const recentBak = path.join(tmpDir, `file.ts.bak.${recentTs}`)
    await fs.writeFile(recentBak, 'recent', 'utf-8')
    const recentDate = new Date(recentTs)
    await fs.utimes(recentBak, recentDate, recentDate)

    const removed = await cleanupOldBakFiles(tmpDir, 7)
    expect(removed).toBe(0)
    // 파일이 여전히 존재해야 함
    await expect(fs.access(recentBak)).resolves.toBeUndefined()
  })

  it('returns 0 without error for non-existent directory', async () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist')
    const removed = await cleanupOldBakFiles(nonExistent, 7)
    expect(removed).toBe(0)
  })

  it('ignores files that do not match .bak.{timestamp} pattern', async () => {
    // 일반 파일 및 .bak 확장자 없는 파일
    await fs.writeFile(path.join(tmpDir, 'file.ts'), 'source', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'file.bak'), 'plain bak', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'file.ts.bak.notanumber'), 'bad pattern', 'utf-8')

    const removed = await cleanupOldBakFiles(tmpDir, 0)
    expect(removed).toBe(0)
  })
})

describe('경로 봉쇄 — 워크스페이스 루트 자체 (N-1)', () => {
  // path.relative(root, root) === '' 이라 startsWith('..')도 isAbsolute도 아니다.
  // 옛 가드는 이 다섯을 전부 통과시키고 workspaceRoot 자신을 반환했다.
  for (const candidate of ['.', '', './', 'a/..', 'src/..']) {
    it(`${JSON.stringify(candidate)} 를 거부한다`, async () => {
      await expect(validatePath(candidate, tmpDir)).rejects.toThrow('워크스페이스 루트 자체')
    })
  }

  it('delete 연산이 워크스페이스 디렉터리를 부모로 옮기지 못한다', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await expect(
      applyChange({ operation: 'delete', path: '.' }, tmpDir),
    ).rejects.toThrow('워크스페이스 루트 자체')

    // 워크스페이스가 제자리에 남아 있어야 한다.
    const stat = await fs.stat(tmpDir)
    expect(stat.isDirectory()).toBe(true)
    expect(await fs.readdir(tmpDir)).toContain('src')
  })

  it('루트 바로 아래 파일은 여전히 허용한다 — 과잉 차단 금지', async () => {
    await applyChange({ operation: 'create', path: 'a.txt', content: 'X' }, tmpDir)
    expect(await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')).toBe('X')
  })
})

describe('경로 봉쇄 — 중간 심볼릭 링크 (6-A)', () => {
  let outside: string
  let canSymlink = true

  beforeEach(async () => {
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'developer-outside-'))
    try {
      await fs.symlink(outside, path.join(tmpDir, 'link'), 'dir')
    } catch {
      // Windows에서 개발자 모드·관리자 권한이 없으면 심볼릭 링크를 만들 수 없다.
      // 그 환경에서는 이 결함을 재현할 수 없으므로 검증을 건너뛴다(거짓 통과 금지).
      canSymlink = false
    }
  })
  afterEach(async () => {
    await fs.rm(outside, { recursive: true, force: true })
  })

  it('링크 아래의 새 파일 경로를 거부한다 — realpath ENOENT 어휘 폴백 봉쇄', async () => {
    if (!canSymlink) return
    await expect(validatePath('link/new.txt', tmpDir)).rejects.toThrow('경로 거부')
  })

  it('링크 아래로 실제 쓰기가 나가지 않는다', async () => {
    if (!canSymlink) return
    await expect(
      applyChange({ operation: 'create', path: 'link/new.txt', content: 'ESCAPED' }, tmpDir),
    ).rejects.toThrow('경로 거부')
    expect(await fs.readFile(path.join(outside, 'new.txt'), 'utf-8').catch(() => null)).toBeNull()
  })

  it('링크 아래 여러 단계 깊이도 거부한다', async () => {
    if (!canSymlink) return
    await expect(validatePath('link/a/b/c.txt', tmpDir)).rejects.toThrow('경로 거부')
  })

  it('링크 아래의 기존 파일도 거부한다 (기존 동작 유지)', async () => {
    if (!canSymlink) return
    await fs.writeFile(path.join(outside, 'existing.txt'), 'x')
    await expect(validatePath('link/existing.txt', tmpDir)).rejects.toThrow('경로 거부')
  })

  it('워크스페이스 안을 가리키는 링크는 허용한다 — 과잉 차단 금지', async () => {
    if (!canSymlink) return
    await fs.mkdir(path.join(tmpDir, 'real'), { recursive: true })
    try {
      await fs.symlink(path.join(tmpDir, 'real'), path.join(tmpDir, 'inner'), 'dir')
    } catch { return }
    const v = await validatePath('inner/ok.txt', tmpDir)
    expect(v).toBe(path.join(await fs.realpath(path.join(tmpDir, 'real')), 'ok.txt'))
  })

  it('cleanupOldBakFiles가 링크 밖 디렉터리를 대상으로 삼지 못한다', async () => {
    if (!canSymlink) return
    const victim = path.join(outside, 'old.bak.1')
    await fs.writeFile(victim, 'BACKUP')
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    await fs.utimes(victim, old, old)

    await expect(
      applyChange({ operation: 'create', path: 'link/x.txt', content: 'y' }, tmpDir),
    ).rejects.toThrow('경로 거부')

    expect(await fs.readFile(victim, 'utf-8')).toBe('BACKUP')
  })
})

describe('경로 봉쇄 — 중첩 신규 디렉터리 (정상 경로 회귀)', () => {
  it('깊은 신규 경로를 만든다', async () => {
    await applyChange({ operation: 'create', path: 'a/b/c/d.txt', content: 'deep' }, tmpDir)
    expect(await fs.readFile(path.join(tmpDir, 'a', 'b', 'c', 'd.txt'), 'utf-8')).toBe('deep')
  })

  it('워크스페이스가 아직 없어도 만든다', async () => {
    const fresh = path.join(tmpDir, 'not-yet')
    await applyChange({ operation: 'create', path: 'x/y.txt', content: 'Z' }, fresh)
    expect(await fs.readFile(path.join(fresh, 'x', 'y.txt'), 'utf-8')).toBe('Z')
  })

  it('..로 워크스페이스를 벗어나는 신규 경로를 거부한다', async () => {
    await expect(validatePath('../escape.txt', tmpDir)).rejects.toThrow('경로 거부')
  })
})
