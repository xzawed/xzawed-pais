import fs from 'node:fs/promises'
import path from 'node:path'
import { validateWorkspaceRoot } from '@xzawed/agent-streams'
import type { FileChange } from './types.js'

/**
 * `target`이 `realRoot` 안(또는 realRoot 자신)인지 판정한다.
 *
 * 빈 문자열(= realRoot 자신)을 허용하는 것은 **조상 판정용**이다. 최종 대상이
 * realRoot 자신인 경우는 `validatePath`가 별도로 먼저 거부한다.
 */
function assertWithin(realRoot: string, target: string, label: string): void {
  const rel = path.relative(realRoot, target)
  if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new Error(`경로 거부: ${label}`)
  }
}

/**
 * LLM이 준 상대경로를 워크스페이스 안의 실제 경로로 확정한다.
 *
 * 두 가지를 막는다.
 *
 * **① 워크스페이스 루트 자신을 대상으로 삼는 것.** `path.relative(root, root)`는
 * 빈 문자열이라 `startsWith('..')`도 `isAbsolute`도 아니다 — 즉 `.`·`''`·`./`·
 * `a/..`·`src/..`가 전부 봉쇄를 통과하고 루트 자신을 반환했다. delete 분기가 그
 * 값을 받으면 `fs.rename(root, root + '.bak.N')`으로 **워크스페이스 디렉터리
 * 전체가 부모로 이동**한다.
 *
 * **② 경로 중간의 심볼릭 링크.** 리프만 `realpath`하면 새 파일 생성 시 ENOENT라
 * 어휘 경로로 폴백하는데, 그때 중간 디렉터리가 워크스페이스 밖을 가리키는 링크여도
 * 어휘 판정은 통과한다. 그래서 **존재하는 최근접 조상**까지 realpath로 풀어 그
 * 조상이 워크스페이스 안인지 본 뒤, 아직 없는 나머지 구간만 이어 붙인다. 아직
 * 존재하지 않는 구간은 링크일 수 없으므로 이 판정으로 충분하다.
 *
 * TOCTOU를 없애지는 못한다 — 검사와 쓰기 사이에 링크가 생기는 창은 남는다.
 * `applyChange`가 쓰기 **후** 실경로를 재검증해 그 창을 탐지한다.
 */
export async function validatePath(filePath: string, workspaceRoot: string): Promise<string> {
  validateWorkspaceRoot(workspaceRoot)

  // 형제 에이전트 4종과 동일하게 폴백도 절대경로로 정규화한다.
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const resolved = path.resolve(realRoot, filePath)

  if (resolved === realRoot) {
    throw new Error(`경로 거부(워크스페이스 루트 자체): ${filePath}`)
  }

  const tail: string[] = []
  let probe = resolved
  for (;;) {
    const real = await fs.realpath(probe).catch(() => null)
    if (real !== null) {
      assertWithin(realRoot, real, filePath)
      return tail.length === 0 ? real : path.join(real, ...tail)
    }
    if (probe === realRoot) {
      // 워크스페이스 자체가 아직 없다 — 조상 체인 전체가 미존재라 링크가 낄 수 없다.
      return resolved
    }
    const parent = path.dirname(probe)
    if (parent === probe) throw new Error(`경로 거부: ${filePath}`) // 파일시스템 루트까지 도달(방어)
    tail.unshift(path.basename(probe))
    probe = parent
  }
}

/** maxAgeDays일 이상 된 .bak.{timestamp} 파일을 삭제한다. */
export async function cleanupOldBakFiles(directory: string, maxAgeDays = 7): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  let removed = 0
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.bak\.\d+$/.test(entry.name)) continue
      const filePath = path.join(directory, entry.name)
      try {
        const stat = await fs.stat(filePath)
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(filePath)
          removed++
        }
      } catch {
        // 이미 삭제됐거나 접근 불가: 무시
      }
    }
  } catch {
    // 디렉터리 읽기 실패: 무시
  }
  return removed
}

export async function applyChange(change: FileChange, workspaceRoot: string): Promise<void> {
  const realRoot = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const validated = await validatePath(change.path, workspaceRoot)

  if (change.operation === 'delete') {
    const bakPath = `${validated}.bak.${Date.now()}`
    // 파생 경로는 접미사라 escape할 수 없지만, validated가 오염되면 함께 오염된다.
    // 봉쇄를 파생 경로에도 명시해 단일 지점 실패가 곧 탈출이 되지 않게 한다(방어심층).
    assertWithin(realRoot, bakPath, `${change.path} (.bak)`)
    await fs.rename(validated, bakPath)

    const dir = path.dirname(validated)
    assertWithin(realRoot, dir, `${change.path} (cleanup)`)
    // 오래된 .bak 파일 정리 (7일 기준, 비동기 - 실패 무시)
    void cleanupOldBakFiles(dir, 7)
    return
  }

  await fs.mkdir(path.dirname(validated), { recursive: true })
  // Atomic write: write to a temp file then rename to avoid partial writes on crash.
  const tmpPath = `${validated}.tmp.${Date.now()}`
  assertWithin(realRoot, tmpPath, `${change.path} (.tmp)`)
  try {
    await fs.writeFile(tmpPath, change.content ?? '', 'utf-8')
    await fs.rename(tmpPath, validated)
    // 쓰기 후 실경로 재검증 — 검사와 쓰기 사이에 링크가 끼어든 경우를 탐지한다(제거는 못 한다).
    const after = await fs.realpath(validated).catch(() => validated)
    assertWithin(realRoot, after, `${change.path} (쓰기 후 실경로)`)
  } catch (err) {
    // Best-effort cleanup of the temp file; ignore cleanup errors.
    await fs.unlink(tmpPath).catch(() => undefined)
    throw err
  }
}
