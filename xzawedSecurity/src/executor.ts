import fs from 'node:fs/promises'
import path from 'node:path'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'

/**
 * 감사 대상 경로를 워크스페이스 안의 실제 경로로 확정한다.
 *
 * **workspaceRoot 기준으로 먼저 resolve한다.** 인바운드 스키마(`types.ts`)가 artifacts를
 * **상대경로**로 강제하는데, 그것을 그대로 `fs.realpath`에 넘기면 `process.cwd()` 기준으로
 * 풀린다. 배포 구성에서 runner의 cwd는 `/app`이고 WORKSPACE_ROOT는 `/workspace`라
 * 전 대상이 ENOENT가 되고, 호출부(`analyzers/static.ts`)의 catch가 그것을 빈 배열로
 * 바꾼다 — **SAST가 한 줄도 스캔하지 않고 "취약점 0건"을 보고**하게 된다.
 *
 * 절대경로는 그대로 resolve되므로 봉쇄 판정이 그대로 걸린다(밖을 가리키면 거부).
 */
/**
 * LLM·Manager 가 보낸 경로를 **`workspaceRoot` 기준으로 앵커**한다(형제 에이전트 3종과 동일).
 *
 * **절대경로는 손대지 않는다.** 예전에는 `path.resolve(workspaceRoot, targetPath)` 를 그대로
 * 썼는데, win32 는 POSIX 절대경로(`/workspace/x`)를 **드라이브 상대**로 재해석해
 * `<cwd 드라이브>:\workspace\x` 를 만든다 — 리눅스(프로덕션·CI)와 Windows(로컬 개발)가 서로
 * 다른 것을 검증하게 된다. `isAbsolute` 분기는 양쪽에서 같은 결과를 낸다.
 *
 * **봉쇄는 이 함수가 하지 않는다** — 아래 `realpath` + `relative` 검사가 한다.
 */
function anchor(p: string, workspaceRoot: string): string {
  return path.isAbsolute(p) ? p : path.resolve(workspaceRoot, p)
}

export async function validatePath(targetPath: string, workspaceRoot: string): Promise<string> {
  validateWorkspaceRoot(workspaceRoot)
  const realTarget = await fs.realpath(anchor(targetPath, workspaceRoot))
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const relative = path.relative(realRoot, realTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${targetPath}`)
  }
  return realTarget
}
