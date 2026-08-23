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
export async function validatePath(targetPath: string, workspaceRoot: string): Promise<string> {
  validateWorkspaceRoot(workspaceRoot)
  const realTarget = await fs.realpath(path.resolve(workspaceRoot, targetPath))
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const relative = path.relative(realRoot, realTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`경로 거부: ${targetPath}`)
  }
  return realTarget
}
