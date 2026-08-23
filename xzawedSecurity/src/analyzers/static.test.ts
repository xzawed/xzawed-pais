import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { analyzeFiles } from './static.js'

/**
 * **모킹을 쓰지 않는다.**
 *
 * 이전 판은 `validatePath`를 항등 함수로 `vi.mock`하고 `fs/promises`도 통째로
 * 대체한 뒤 `/workspace/app.ts` 같은 **절대경로**를 넣었다. 그래서
 *
 *   1. 경로 해석 결함(`executor.ts`가 workspaceRoot 재기준화 없이 realpath)이
 *      자기 테스트에서 **한 번도 실행되지 않았고**,
 *   2. 메시지 스키마가 강제하는 **상대경로** 케이스를 한 번도 지나가지 않았다.
 *
 * 실제 임시 디렉토리에 파일을 쓰고 상대경로로 넘긴다. vitest의 cwd는 서비스
 * 디렉토리이고 워크스페이스는 tmp라 **cwd ≠ workspaceRoot**가 자연히 성립한다 —
 * 그것이 배포 구성(runner WORKDIR `/app` vs WORKSPACE_ROOT `/workspace`)과 같은 조건이다.
 */

let ws: string

beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'security-static-'))
})

afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true })
})

/** 워크스페이스 안에 파일을 쓰고 **상대경로**를 돌려준다(메시지 스키마가 강제하는 형태). */
async function put(rel: string, content: string): Promise<string> {
  const abs = path.join(ws, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf-8')
  return rel
}

describe('analyzeFiles — 상대경로 artifact (배포 구성과 동일 조건)', () => {
  it('빈 목록이면 빈 결과', async () => {
    expect(await analyzeFiles([], ws)).toEqual([])
  })

  it('하드코딩 비밀번호를 찾는다 (S001)', async () => {
    const rel = await put('app.ts', 'const password = "secret123"')
    const issues = await analyzeFiles([rel], ws)
    expect(issues.some((i) => i.id.startsWith('S001'))).toBe(true)
    expect(issues[0]?.severity).toBe('critical')
    expect(issues[0]?.cwe).toBe('CWE-798')
  })

  it('eval 사용을 찾는다 (S003)', async () => {
    const rel = await put('eval.ts', 'eval(userInput)')
    const issues = await analyzeFiles([rel], ws)
    expect(issues.some((i) => i.id.startsWith('S003'))).toBe(true)
    expect(issues[0]?.severity).toBe('high')
  })

  it('innerHTML 대입을 찾는다 (S004)', async () => {
    const rel = await put('dom.ts', 'element.innerHTML = userContent')
    const issues = await analyzeFiles([rel], ws)
    expect(issues.some((i) => i.id.startsWith('S004'))).toBe(true)
    expect(issues[0]?.cwe).toBe('CWE-79')
  })

  it('템플릿 리터럴 SQL 주입을 찾는다 (S005)', async () => {
    const rel = await put('db.ts', 'db.query(`SELECT * FROM users WHERE id=${userId}`)')
    const issues = await analyzeFiles([rel], ws)
    const s005 = issues.find((i) => i.id.startsWith('S005'))
    expect(s005?.severity).toBe('high')
    expect(s005?.cwe).toBe('CWE-89')
  })

  it('document.write 를 찾는다 (S017)', async () => {
    const rel = await put('w.ts', 'document.write("<script>alert(1)</script>")')
    expect((await analyzeFiles([rel], ws)).some((i) => i.id.startsWith('S017'))).toBe(true)
  })

  it('dangerouslySetInnerHTML 을 찾는다 (S019)', async () => {
    const rel = await put('c.tsx', 'return <div dangerouslySetInnerHTML={{ __html: userInput }} />')
    expect((await analyzeFiles([rel], ws)).some((i) => i.id.startsWith('S019'))).toBe(true)
  })

  it('인증 훅 없는 라우트를 찾는다 (S020)', async () => {
    const rel = await put('r.ts', 'app.get("/admin", async (req, reply) => { return "ok" })')
    expect((await analyzeFiles([rel], ws)).some((i) => i.id.startsWith('S020'))).toBe(true)
  })

  it('하위 디렉토리의 상대경로도 해석한다', async () => {
    const rel = await put(path.join('src', 'deep', 'x.ts'), 'eval(a)')
    expect((await analyzeFiles([rel], ws)).length).toBeGreaterThan(0)
  })

  it('줄 번호와 파일명을 그대로 보고한다', async () => {
    const rel = await put('creds.ts', 'line1\nconst password = "pw"\nline3')
    const issues = await analyzeFiles([rel], ws)
    expect(issues[0]?.line).toBe(2)
    expect(issues[0]?.file).toBe(rel)
  })

  it('깨끗한 코드에는 이슈가 없다', async () => {
    const rel = await put('clean.ts', 'const x = 1 + 2\nconsole.log(x)')
    expect(await analyzeFiles([rel], ws)).toEqual([])
  })

  it('모든 static 이슈는 source:static 태그를 갖는다', async () => {
    const rel = await put('vuln.ts', 'eval("danger")\n')
    const issues = await analyzeFiles([rel], ws)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((i) => i.source === 'static')).toBe(true)
  })
})

describe('analyzeFiles — 봉쇄와 실패 처리', () => {
  it('워크스페이스 밖을 가리키면 건너뛴다', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'security-outside-'))
    try {
      await fs.writeFile(path.join(outside, 'secret.ts'), 'eval(x)', 'utf-8')
      // 상대경로 규칙을 우회하는 절대경로 — 봉쇄가 잡아야 한다.
      expect(await analyzeFiles([path.join(outside, 'secret.ts')], ws)).toEqual([])
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('존재하지 않는 파일은 건너뛴다', async () => {
    expect(await analyzeFiles(['missing.ts'], ws)).toEqual([])
  })

  it('건너뛴 이유를 무음으로 삼키지 않는다', async () => {
    // 감사 대상을 한 건도 못 읽은 것과 "취약점이 없다"는 구분돼야 한다.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await analyzeFiles(['missing.ts'], ws)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('analyzeFiles — 실패 분기별 관측성', () => {
  it('디렉토리를 대상으로 주면 읽기 실패로 건너뛰고 이유를 남긴다', async () => {
    // stat 은 성공하고 readFile 이 EISDIR 로 실패하는 경로 — 두 분기가 다르다는 것을 고정한다.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await fs.mkdir(path.join(ws, 'adir'), { recursive: true })

    expect(await analyzeFiles(['adir'], ws)).toEqual([])
    expect(spy.mock.calls.some((c) => String(c[0]).includes('읽기 실패'))).toBe(true)
    spy.mockRestore()
  })

  it('상한을 넘는 파일은 건너뛰고 크기를 남긴다', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // MAX_FILE_SIZE_BYTES = 1 MiB. 취약 패턴을 넣어도 크기 때문에 스캔되지 않아야 한다.
    await fs.writeFile(path.join(ws, 'big.ts'), 'eval(x)\n' + 'a'.repeat(1_100_000), 'utf-8')

    expect(await analyzeFiles(['big.ts'], ws)).toEqual([])
    expect(spy.mock.calls.some((c) => String(c[0]).includes('oversized'))).toBe(true)
    spy.mockRestore()
  })

  it('경로 거부는 거부 사유를 남긴다', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await analyzeFiles([path.join('..', 'escape.ts')], ws)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('경로 거부'))).toBe(true)
    spy.mockRestore()
  })

  it('realpath 와 stat 사이에 파일이 사라지면 건너뛰고 이유를 남긴다', async () => {
    // 실파일시스템으로는 만들 수 없는 창이다 — validatePath 가 realpath 에 성공했다면
    // 그 시점에 파일이 존재한다. 그 사이 삭제되는 TOCTOU 를 주입해 분기를 고정한다.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rel = await put('vanish.ts', 'eval(x)')
    const statSpy = vi.spyOn(fs, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    )

    expect(await analyzeFiles([rel], ws)).toEqual([])
    expect(spy.mock.calls.some((c) => String(c[0]).includes('stat 실패'))).toBe(true)

    statSpy.mockRestore()
    spy.mockRestore()
  })

  it('여러 파일 중 일부가 실패해도 나머지는 감사한다', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const ok = await put('good.ts', 'eval(danger)')
    const issues = await analyzeFiles(['missing.ts', ok, path.join('..', 'x.ts')], ws)
    expect(issues.length).toBeGreaterThan(0)
    spy.mockRestore()
  })
})
