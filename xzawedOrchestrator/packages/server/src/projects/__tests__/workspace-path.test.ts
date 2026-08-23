import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeWorkspacePath, assertReadableDirectory, WorkspacePathError } from '../workspace-path.js'

/**
 * **워크스페이스 경로 판정의 단일 출처.**
 *
 * 이전엔 등록 진입점 3곳이 서로 다른 검사를 했다 — `..`·절대경로 검사가
 * `projects.route.ts` 한 곳에만 있었고, 내부 라우트와 Redis 게이트웨이(LLM 이
 * `register_project` 도구로 값을 정하는 경로)에는 아예 없었다.
 *
 * 판정은 `process.platform` 을 보지 않고 **입력 문자열의 모양**으로 플레이버를 고른다.
 * 이 서버는 Linux 컨테이너와 사용자 OS 양쪽에서 돌고(Electron 이 `spawn` 한다),
 * 저장된 값은 DB 를 거쳐 **다른 OS 의 프로세스**로 전달된다. 호스트 OS 로 판정하면
 * CI(ubuntu) 그린과 로컬(win32) 그린이 서로 다른 것을 검증하게 된다.
 */

function reasonOf(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof WorkspacePathError) return e.reason
    throw e
  }
  throw new Error('거부될 것으로 기대했으나 통과했다')
}

describe('normalizeWorkspacePath — 통과해야 하는 정상 입력', () => {
  it.each([
    ['/workspace'],                                   // 컨테이너·Electron 기본값
    ['/workspace/proj-1'],
    ['/home/user/app'],
    ['/home/user/project'],
    ['/tmp/x'],
    ['/home/user/.xzawed/workspaces/proj-1'],          // clone 목적지(POSIX)
    ['/home/.xzawed/workspaces/proj-1'],
  ])('POSIX 절대경로를 그대로 돌려준다: %s', (input) => {
    expect(normalizeWorkspacePath(input)).toBe(input)
  })

  it('Windows 절대경로를 통과시킨다 — 현행 가드는 이것을 400으로 오거부했다', () => {
    // `!localPath.startsWith('/')` 는 Windows 네이티브 절대경로를 전부 거부했다.
    // 앱에 폴더 피커가 없어 사용자가 자유 텍스트로 입력하므로, 그 가드가 걸린
    // 유일한 진입점을 Windows 사용자가 쓸 수 없었다.
    expect(normalizeWorkspacePath('C:\\Users\\dirtc\\app')).toBe('C:\\Users\\dirtc\\app')
  })

  it('슬래시형 Windows 경로를 win32 형태로 정본화한다', () => {
    expect(normalizeWorkspacePath('C:/Users/dirtc/app')).toBe('C:\\Users\\dirtc\\app')
  })

  it('`..` 부분문자열 오탐이 사라진다', () => {
    // 현행 `localPath.includes('..')` 는 이것을 400으로 오거부했다.
    // 세그먼트 분해로 바꾸면 오탐이 사라지면서 탐지력은 오히려 올라간다.
    expect(normalizeWorkspacePath('/home/user/..app')).toBe('/home/user/..app')
    expect(normalizeWorkspacePath('/home/user/proj..v2')).toBe('/home/user/proj..v2')
  })

  it.each([
    ['/home/user/app/', '/home/user/app'],
    ['/home//user///app', '/home/user/app'],
  ])('구분자를 정규화한다: %s → %s', (input, expected) => {
    // 같은 디렉토리가 서로 다른 문자열로 DB 에 들어가면 중복 판정·로그 대조가 깨진다.
    expect(normalizeWorkspacePath(input)).toBe(expected)
  })
})

describe('normalizeWorkspacePath — traversal', () => {
  it('POSIX traversal 을 막는다', () => {
    expect(reasonOf(() => normalizeWorkspacePath('/../../../etc/passwd'))).toBe('dotdot-segment')
  })

  it('Windows 중간 traversal 을 막는다 — normalize 가 흡수해도 잡는다', () => {
    // `path.normalize('C:\Users\..\Windows')` 는 `C:\Windows` 를 돌려주므로
    // 정규화 후 검사로는 잡히지 않는다. 세그먼트 검사만 잡는다.
    expect(reasonOf(() => normalizeWorkspacePath('C:\\Users\\..\\Windows'))).toBe('dotdot-segment')
  })
})

describe('normalizeWorkspacePath — 상대경로', () => {
  it.each([['..'], ['.'], ['a/..'], ['relative/path/to/project'], ['C:app'], ['\\']])(
    '상대·드라이브상대 경로를 거부한다: %s',
    (input) => {
      // **현행은 이것들을 전부 통과시킨다.** 그리고 `resolve()` 가 cwd 기준이라
      // `../../..` 가 저장소 루트로 풀린다 — 검사한 경로와 저장·사용되는 경로가 다르다.
      expect(reasonOf(() => normalizeWorkspacePath(input))).toBe('not-absolute')
    },
  )

  it('빈 문자열은 empty 로 거부한다', () => {
    // 빈 문자열은 cwd 로 풀려 **서버 프로세스의 작업 디렉토리**가 워크스페이스가 된다.
    expect(reasonOf(() => normalizeWorkspacePath(''))).toBe('empty')
    expect(reasonOf(() => normalizeWorkspacePath('   '))).toBe('empty')
  })
})

describe('normalizeWorkspacePath — 파일시스템 루트 (플랫폼 무관)', () => {
  it.each([['/'], ['C:\\'], ['C:/'], ['//']])('루트를 거부한다: %s', (input) => {
    const r = reasonOf(() => normalizeWorkspacePath(input))
    expect(['filesystem-root', 'namespace-or-unc']).toContain(r)
  })

  it('Linux 에서도 C:\ 를 거부한다 — 판정이 호스트 OS 에 의존하지 않는다', () => {
    // 현행 테스트는 `platform() === 'win32'` 로 분기하고 else 에서 아무것도 검사하지
    // 않는다. shape 기반이면 CI(ubuntu)에서도 같은 답이 나온다.
    expect(reasonOf(() => normalizeWorkspacePath('C:\\'))).toBe('filesystem-root')
  })
})

describe('normalizeWorkspacePath — 네임스페이스·UNC', () => {
  it.each([
    ['//?/C:/Windows'],
    ['\\\\?\\C:\\Windows'],
    ['\\\\.\\C:\\Windows'],
    ['\\\\server\\share\\proj'],
    ['//server/share/proj'],
  ])('거부한다: %s', (input) => {
    // `\?\` 는 Win32 API 가 **정규화를 하지 않는** 경로라 `..` 가 커널까지 살아간다.
    // UNC 는 공격자 지정 호스트로 SMB 아웃바운드를 유발하고, 라우팅 불가 주소면
    // `access()` 가 20초 넘게 매달려 요청 경로를 막는다(실측).
    // 매핑된 드라이브 문자(`Z:\proj`)는 통과하므로 정당한 네트워크 공유 사용은 남는다.
    expect(reasonOf(() => normalizeWorkspacePath(input))).toBe('namespace-or-unc')
  })
})

describe('normalizeWorkspacePath — 입력 위생', () => {
  it('문자열이 아니면 거부한다', () => {
    // Redis 게이트웨이가 payload 를 `z.unknown()` 으로 두고 타입 단언만 하므로
    // number·object 가 그대로 `access()` 까지 간다.
    expect(reasonOf(() => normalizeWorkspacePath(42))).toBe('not-a-string')
    expect(reasonOf(() => normalizeWorkspacePath({ toString: () => '/etc' }))).toBe('not-a-string')
    expect(reasonOf(() => normalizeWorkspacePath(null))).toBe('not-a-string')
  })

  it('제어문자를 거부한다', () => {
    expect(reasonOf(() => normalizeWorkspacePath('/home/user/pro\u0000ject'))).toBe('control-char')
    expect(reasonOf(() => normalizeWorkspacePath('/home/user/pro\nject'))).toBe('control-char')
  })

  it('POSIX 경로 속 백슬래시를 거부한다', () => {
    // **이 검사만 오탐 가능성이 실재한다** — Linux 에서 `a\b` 는 합법적인 디렉토리명이다.
    // 그럼에도 거부하는 이유는 저장값이 DB 를 거쳐 다른 OS 프로세스로 가기 때문이다.
    // OS 마다 다르게 읽히는 문자열을 워크스페이스 루트로 저장하지 않는다.
    expect(reasonOf(() => normalizeWorkspacePath('/home/user/a\\b'))).toBe('backslash-in-posix-path')
  })
})

describe('normalizeWorkspacePath — clone 목적지', () => {
  it('존재하지 않는 clone 목적지도 통과시킨다 (Layer 1 은 I/O 를 하지 않는다)', () => {
    // github 등록 3곳 중 2곳이 `void cloneRepo(...)` 로 clone 을 던지고 즉시
    // workspacePath 를 확정한다 — 그 시점에 디렉토리는 존재할 수 없다.
    // 여기에 존재 검사를 걸면 github 등록이 항상 실패한다.
    expect(normalizeWorkspacePath('/home/user/.xzawed/workspaces/proj-1'))
      .toBe('/home/user/.xzawed/workspaces/proj-1')
    expect(normalizeWorkspacePath('C:\\Users\\dirtc\\.xzawed\\workspaces\\a3f1e2d4'))
      .toBe('C:\\Users\\dirtc\\.xzawed\\workspaces\\a3f1e2d4')
  })
})

describe('assertReadableDirectory — Layer 2 (I/O, fail-closed)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ws-path-'))
  })
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('실재하고 읽을 수 있는 디렉토리는 통과한다', async () => {
    await expect(assertReadableDirectory(dir)).resolves.toBeUndefined()
  })

  it('존재하지 않으면 거부하고 원인 에러를 보존한다', async () => {
    // 이전 판은 `catch { throw new Error(...) }` 로 `err.code` 를 지웠다.
    // 운영에서 ENOENT 와 EACCES 를 구분할 수 없게 만드는 손실이다.
    const missing = path.join(dir, 'nope')
    try {
      await assertReadableDirectory(missing)
      throw new Error('거부될 것으로 기대했으나 통과했다')
    } catch (e) {
      expect(e).toBeInstanceOf(WorkspacePathError)
      const err = e as WorkspacePathError
      expect(err.reason).toBe('path-not-accessible')
      // 기존 메시지 문구를 유지한다 — 하위호환.
      expect(err.message).toContain('로컬 경로에 접근할 수 없습니다')
      expect(err.cause).toBeDefined()
      expect((err.cause as NodeJS.ErrnoException).code).toBe('ENOENT')
    }
  })

  it('디렉토리가 아니면 거부한다 — 읽을 수 있는 파일도 워크스페이스 루트가 아니다', async () => {
    // 이전 판의 `access(R_OK)` 는 읽기 가능한 **파일**을 통과시켰다. 그러면
    // 에이전트가 그 아래 상대경로를 조합하는 순간 뒤늦게 ENOTDIR 로 죽는다.
    const file = path.join(dir, 'a-file.txt')
    await fsp.writeFile(file, 'x', 'utf-8')
    try {
      await assertReadableDirectory(file)
      throw new Error('거부될 것으로 기대했으나 통과했다')
    } catch (e) {
      expect(e).toBeInstanceOf(WorkspacePathError)
      expect((e as WorkspacePathError).reason).toBe('not-a-directory')
    }
  })

  it('statusCode 400 을 실어 라우트가 그대로 내보낼 수 있다', async () => {
    try {
      await assertReadableDirectory(path.join(dir, 'nope'))
    } catch (e) {
      expect((e as WorkspacePathError).statusCode).toBe(400)
    }
  })
})
