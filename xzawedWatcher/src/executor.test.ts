import { vi, it, expect } from 'vitest'

vi.mock('node:fs/promises')

import { validatePath } from './executor.js'
import * as fs from 'node:fs/promises'
import path from 'node:path'

it('watcher validatePath: WORKSPACE_ROOT 내부 감시 경로를 허용한다', async () => {
  vi.mocked(fs).realpath.mockImplementation(async (p) => String(p))
  const result = await validatePath('/watch-workspace/watched-dir/file.ts', '/watch-workspace')
  expect(result).toBe('/watch-workspace/watched-dir/file.ts')
})

it('watcher validatePath: 존재하지 않는 경로는 거부한다 (TOCTOU 방지)', async () => {
  vi.mocked(fs).realpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
  await expect(validatePath('/watch-workspace/nonexistent', '/watch-workspace')).rejects.toThrow('ENOENT')
})

/**
 * **상대경로는 workspaceRoot 기준이다.** 계약(루트 CLAUDE.md)이 "LLM 생성 경로는 절대경로 금지,
 * workspaceRoot 기준 상대경로"인데 예전에는 원시 인자를 그대로 realpath 해 **서버 프로세스의 cwd**
 * 기준으로 풀었다. xzawedSecurity 는 처음부터 workspaceRoot 기준이었다.
 */
it('watcher validatePath: 상대경로를 workspaceRoot 기준으로 푼다(cwd 아님)', async () => {
  vi.mocked(fs).realpath.mockImplementation(async (p) => String(p))
  await expect(validatePath('watched-dir/file.ts', '/watch-workspace'))
    .resolves.toBe(path.resolve('/watch-workspace', 'watched-dir/file.ts'))
})

/** 앵커를 바꿔도 봉쇄는 그대로여야 한다 — 넓힌 게 아니라 기준을 고친 것이다. */
it('watcher validatePath: 상대 traversal 은 여전히 거부한다', async () => {
  vi.mocked(fs).realpath.mockImplementation(async (p) => String(p))
  await expect(validatePath('../../etc', '/watch-workspace')).rejects.toThrow('경로 거부')
})

/**
 * **절대경로는 바이트 그대로여야 한다.** `path.resolve(root, abs)` 를 쓰면 win32 가 POSIX
 * 절대경로를 드라이브 상대로 재해석해 로컬만 빨개진다 — 실제로 그렇게 물렸다.
 */
it('watcher validatePath: 절대경로 동작은 플랫폼 무관하게 불변이다', async () => {
  vi.mocked(fs).realpath.mockImplementation(async (p) => String(p))
  await expect(validatePath('/watch-workspace/abs.ts', '/watch-workspace'))
    .resolves.toBe('/watch-workspace/abs.ts')
})
