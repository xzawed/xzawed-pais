import { stat, access, constants } from 'node:fs/promises'
import path from 'node:path'

/**
 * 워크스페이스 경로 판정의 **단일 출처**.
 *
 * 등록 진입점이 셋인데 검사가 서로 달랐다 — `..`·절대경로 검사가 `projects.route.ts`
 * 한 곳에만 있었고, 내부 라우트와 Redis 게이트웨이(LLM 이 `register_project` 도구로
 * 값을 정하는 경로)에는 아예 없었다.
 *
 * **`WorkspaceService` 의 메서드로 두지 않는 이유.** 라우트 테스트 3개가 그 클래스를
 * 통째로 mock 한다(`validateLocalPath: vi.fn()`). 메서드로만 두면 검증기가 라우트
 * 테스트에서 전부 무력화된다. 순수 계층을 별도 모듈로 빼서 라우트가 직접 import 해야
 * mock 을 우회해 실제로 돈다.
 *
 * **2계층으로 나눈 이유.** github 등록 3곳 중 2곳이 `void cloneRepo(...)` 로 clone 을
 * 던지고 즉시 `workspacePath` 를 확정한다 — 그 시점에 목적지 디렉토리는 존재하지
 * 않는다. 존재 검사를 한 덩어리로 묶으면 github 등록이 항상 실패한다. 그래서
 * I/O 없는 `normalizeWorkspacePath` 는 **모든** 경로에, I/O 하는
 * `assertReadableDirectory` 는 `workspaceType='local'` 에만 건다.
 *
 * 이 모듈이 **하지 않는 것**(막는 척하지 않기 위해 명시한다):
 * - realpath·심볼릭 링크 봉쇄. 봉쇄는 상위 루트가 이미 있을 때 성립하는데, 등록
 *   시점엔 사용자가 그 루트 자체를 정하는 중이다. 루트 없는 realpath 는 정규화일 뿐
 *   아무것도 거부하지 못한다(`xzawedSecurity` 의 `validatePath` 와 다른 상황이다).
 * - TOCTOU 방어. 검사와 사용 사이의 심볼릭 링크 교체는 한 번의 realpath 로 막을 수
 *   없고, 사용 주체는 다른 프로세스·다른 컨테이너다.
 * - 민감 디렉토리 denylist. 우회 가능한 목록이다. 옳은 도구는 allowlist 봉쇄이고
 *   그것은 제품 정책 결정이다.
 * - 인증·인가. 게이트웨이 무인증과 `payload: z.unknown()` 은 별개 슬라이스다.
 */

/** 거부 사유. 열거값이라 응답에 실어도 경로 정보를 누출하지 않는다. */
export type WorkspacePathReason =
  | 'not-a-string'
  | 'empty'
  | 'control-char'
  | 'not-absolute'
  | 'namespace-or-unc'
  | 'dotdot-segment'
  | 'backslash-in-posix-path'
  | 'filesystem-root'
  | 'not-a-directory'
  | 'path-not-accessible'

/**
 * `statusCode` 를 실어 두면 Fastify 의 기존 오류 봉투가 그대로 400 으로 내보낸다 —
 * 라우트마다 try/catch 를 심을 필요도, **복제 블록인 `setErrorHandler` 를 건드릴 필요도**
 * 없다(그 블록은 Manager 와 바이트 동일해야 한다).
 *
 * 메시지에 `reason` 토큰을 넣는다. 응답 본문이 `{ error }` 한 필드뿐이라 그렇게 해야
 * 호출자와 테스트가 어떤 검사에 걸렸는지 알 수 있다. 열거값이라 경로를 누출하지 않는다.
 */
export class WorkspacePathError extends Error {
  readonly statusCode = 400

  constructor(readonly reason: WorkspacePathReason, detail: string, options?: { cause?: unknown }) {
    super(`localPath rejected (${reason}): ${detail}`, options)
    this.name = 'WorkspacePathError'
  }
}

const WIN_DRIVE = /^[A-Za-z]:[\\/]/
const UNC_OR_NAMESPACE = /^[\\/]{2}/
const POSIX_ABS = /^\//
const CONTROL_CHARS = /[\u0000-\u001f]/

/**
 * 문자열의 **모양**으로 플레이버를 고른다. `process.platform` 을 보지 않는다.
 *
 * 이 서버는 Linux 컨테이너와 사용자 OS 양쪽에서 돌고(Electron 이 `spawn` 한다),
 * 저장된 값은 DB 를 거쳐 다른 OS 의 프로세스로 전달된다. 호스트 OS 로 판정하면
 * CI(ubuntu) 그린과 로컬(win32) 그린이 서로 다른 것을 검증하게 되고, 네이티브
 * `path.*` 는 POSIX 입력을 재작성한다(win32 에서 `normalize('/a/b')` → `\a\b`).
 */
function flavorOf(input: string): typeof path.win32 | typeof path.posix | null {
  if (WIN_DRIVE.test(input)) return path.win32
  if (POSIX_ABS.test(input)) return path.posix
  return null
}

/**
 * 검사하고 **정본화된 값을 돌려준다.** 호출부는 이 반환값을 저장해야 한다 —
 * 이전엔 검사한 값과 저장한 값이 달랐다(원문을 그대로 DB 에 넣었다).
 *
 * I/O 를 하지 않으므로 아직 만들어지지 않은 clone 목적지에도 적용할 수 있다.
 */
export function normalizeWorkspacePath(input: unknown): string {
  if (typeof input !== 'string') {
    throw new WorkspacePathError('not-a-string', 'localPath는 문자열이어야 합니다')
  }
  if (input.trim() === '') {
    // 빈 문자열은 `resolve()` 에서 cwd 로 풀린다 — 서버 프로세스의 작업 디렉토리가
    // 워크스페이스가 된다.
    throw new WorkspacePathError('empty', 'localPath가 비어 있습니다')
  }
  if (CONTROL_CHARS.test(input)) {
    throw new WorkspacePathError('control-char', 'localPath에 제어문자가 있습니다')
  }
  if (UNC_OR_NAMESPACE.test(input)) {
    // `\\?\` 는 Win32 API 가 정규화를 **하지 않는** 경로라 `..` 가 커널까지 살아간다.
    // `\\.\` 는 디바이스 네임스페이스. UNC 는 공격자 지정 호스트로 SMB 아웃바운드를
    // 유발하고, 라우팅 불가 주소면 아래 `access()` 가 20초 넘게 매달려 요청 경로를
    // 막는다(실측). 정당한 네트워크 공유는 드라이브 문자 매핑(`Z:\proj`)으로 남는다.
    throw new WorkspacePathError('namespace-or-unc', 'UNC·네임스페이스 경로는 사용할 수 없습니다')
  }

  const p = flavorOf(input)
  if (p === null) {
    throw new WorkspacePathError('not-absolute', 'localPath는 절대경로여야 합니다')
  }

  // 세그먼트로 분해해서 본다. `includes('..')` 부분문자열 검사는 `/home/user/..app`
  // 같은 정상 경로를 오거부하면서, 정작 `C:\Users\..\Windows` 는 normalize 가 흡수해
  // 놓치는 조합이었다.
  if (input.split(/[\\/]+/).includes('..')) {
    throw new WorkspacePathError('dotdot-segment', 'localPath에 상위 경로 세그먼트가 있습니다')
  }

  if (p === path.posix && input.includes('\\')) {
    // Linux 에서 `a\b` 는 합법적인 단일 디렉토리명이라 **이 검사만 오탐 여지가 있다.**
    // 그럼에도 거부하는 이유는 저장값이 DB 를 거쳐 다른 OS 의 프로세스로 가기
    // 때문이다 — OS 마다 다르게 읽히는 문자열을 워크스페이스 루트로 저장하지 않는다.
    // 실제 피해 사용자가 확인되면 근거를 붙여 빼도 나머지 검사는 온전하다.
    throw new WorkspacePathError('backslash-in-posix-path', 'POSIX 경로에 백슬래시를 쓸 수 없습니다')
  }

  // `resolve()` 가 아니라 `normalize()` 다. resolve 는 cwd 를 섞어 같은 입력이
  // 프로세스마다 다르게 판정된다.
  let normalized = p.normalize(input)
  const root = p.parse(normalized).root
  if (normalized.length > root.length) normalized = normalized.replace(/[\\/]+$/, '')
  if (normalized === root || normalized === root.replace(/[\\/]$/, '')) {
    throw new WorkspacePathError('filesystem-root', '파일시스템 루트는 워크스페이스로 사용할 수 없습니다')
  }

  return normalized
}

/**
 * 디렉토리로 실재하고 읽을 수 있는지 확인한다. **`workspaceType='local'` 에만 건다.**
 *
 * 모든 실패를 throw 한다(fail-closed). 원인 에러는 `cause` 로 보존한다 — 이전 판은
 * `catch { throw new Error(...) }` 로 `err.code` 를 지웠다.
 */
export async function assertReadableDirectory(normalized: string): Promise<void> {
  let stats
  try {
    stats = await stat(normalized)
  } catch (err) {
    throw new WorkspacePathError(
      'path-not-accessible',
      `로컬 경로에 접근할 수 없습니다: ${normalized}`,
      { cause: err },
    )
  }
  if (!stats.isDirectory()) {
    // 이전 판의 `access(R_OK)` 는 읽기 가능한 **파일**을 통과시켰다. 워크스페이스
    // 루트로서 무의미하고, 에이전트가 그 아래 상대경로를 조합하면 뒤늦게 ENOTDIR 로 죽는다.
    throw new WorkspacePathError('not-a-directory', `로컬 경로에 접근할 수 없습니다: ${normalized} (디렉토리가 아닙니다)`)
  }
  try {
    await access(normalized, constants.R_OK)
  } catch (err) {
    throw new WorkspacePathError(
      'path-not-accessible',
      `로컬 경로에 접근할 수 없습니다: ${normalized}`,
      { cause: err },
    )
  }
}
