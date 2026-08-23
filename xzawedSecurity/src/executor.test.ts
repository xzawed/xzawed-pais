import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { validatePath } from './executor.js'

/**
 * **`fs`를 모킹하지 않는다.**
 *
 * 이전 판은 `node:fs/promises`를 통째로 대체하고 `realpath`를 항등 함수로 두었다.
 * 그 상태에서는 경로가 무엇을 기준으로 해석되는지가 검사 대상에서 빠진다 —
 * 그리고 그것이 정확히 이 함수의 결함이 있던 자리였다. 게다가 픽스처가 전부
 * 절대경로여서, 인바운드 스키마가 **강제하는** 상대경로 케이스를 지나가지 않았다.
 */

let ws: string

beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'security-exec-'))
})

afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true })
})

describe('validatePath — 상대경로 해석', () => {
  it('상대경로를 workspaceRoot 기준으로 해석한다 (cwd 기준이 아니다)', async () => {
    await fs.writeFile(path.join(ws, 'target.ts'), 'x', 'utf-8')
    // 테스트 cwd는 서비스 디렉토리이고 워크스페이스는 tmp다 — 배포 구성과 같은 조건.
    expect(await validatePath('target.ts', ws)).toBe(
      await fs.realpath(path.join(ws, 'target.ts')),
    )
  })

  it('하위 디렉토리 상대경로도 해석한다', async () => {
    await fs.mkdir(path.join(ws, 'src'), { recursive: true })
    await fs.writeFile(path.join(ws, 'src', 'a.ts'), 'x', 'utf-8')
    expect(await validatePath(path.join('src', 'a.ts'), ws)).toBe(
      await fs.realpath(path.join(ws, 'src', 'a.ts')),
    )
  })

  it('존재하지 않는 상대경로는 거부한다 — 없는 파일을 감사한 척하지 않는다', async () => {
    await expect(validatePath('missing.ts', ws)).rejects.toThrow()
  })
})

describe('validatePath — 봉쇄', () => {
  it('워크스페이스 안의 절대경로는 허용한다', async () => {
    const abs = path.join(ws, 'inside.ts')
    await fs.writeFile(abs, 'x', 'utf-8')
    expect(await validatePath(abs, ws)).toBe(await fs.realpath(abs))
  })

  it('워크스페이스 밖의 절대경로는 거부한다', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'security-out-'))
    try {
      const abs = path.join(outside, 'secret.ts')
      await fs.writeFile(abs, 'x', 'utf-8')
      await expect(validatePath(abs, ws)).rejects.toThrow('경로 거부')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('접두사만 같은 형제 디렉토리는 거부한다', async () => {
    // `<ws>-shadow` 는 `<ws>` 로 시작하지만 안이 아니다 — 문자열 접두사 비교의 함정.
    const shadow = `${ws}-shadow`
    await fs.mkdir(shadow, { recursive: true })
    try {
      const abs = path.join(shadow, 'attack.ts')
      await fs.writeFile(abs, 'x', 'utf-8')
      await expect(validatePath(abs, ws)).rejects.toThrow('경로 거부')
    } finally {
      await fs.rm(shadow, { recursive: true, force: true })
    }
  })

  it('상위경로로 벗어나는 상대경로는 거부한다', async () => {
    const outside = path.dirname(ws)
    await fs.writeFile(path.join(outside, 'escape.ts'), 'x', 'utf-8')
    try {
      await expect(validatePath(path.join('..', 'escape.ts'), ws)).rejects.toThrow('경로 거부')
    } finally {
      await fs.rm(path.join(outside, 'escape.ts'), { force: true })
    }
  })

  it('파일시스템 루트 workspaceRoot는 거부한다', async () => {
    await expect(validatePath('audit-target', path.parse(process.cwd()).root))
      .rejects.toThrow('WORKSPACE_ROOT must not be filesystem root')
  })
})
