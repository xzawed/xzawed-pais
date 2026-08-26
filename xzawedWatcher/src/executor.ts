import fs from 'node:fs/promises'
import path from 'node:path'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

/**
 * LLM·Manager 가 보낸 경로를 **`workspaceRoot` 기준으로 앵커**한다.
 *
 * 계약(루트 CLAUDE.md)은 "LLM 생성 경로는 절대경로 금지, `workspaceRoot` 기준 상대경로"인데,
 * 예전에는 원시 인자를 그대로 `realpath` 해 **서버 프로세스의 cwd** 기준으로 풀었다.
 * xzawedSecurity 는 처음부터 workspaceRoot 기준이었고 그쪽이 계약과 맞다.
 *
 * **절대경로는 손대지 않는다.** `path.resolve(root, abs)` 를 쓰면 win32 가 POSIX 절대경로를
 * 드라이브 상대로 재해석해 로컬(Windows)과 CI·컨테이너(Linux)가 서로 다른 것을 검증하게 된다.
 * `isAbsolute` 분기는 양쪽에서 같다.
 *
 * **봉쇄는 이 함수가 하지 않는다** — 호출자의 `realpath` + `relative` 검사가 한다.
 */
function anchor(p: string, workspaceRoot: string): string {
  return path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p)
}

export async function validatePath(targetPath: string, workspaceRoot: string): Promise<string> {
  validateWorkspaceRoot(workspaceRoot)
  // 미존재 시 throw 는 그대로 둔다 — 의도된 TOCTOU 방어다.
  const realTarget = await fs.realpath(anchor(targetPath, workspaceRoot))
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const relative = path.relative(realRoot, realTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${targetPath}`)
  }
  return realTarget
}
