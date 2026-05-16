import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { validatePath, applyChange } from './fileio.js'

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
