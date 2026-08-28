import path from 'node:path'

export function resolveWorkspaceRoot(
  userContext: { workspaceRoot: string; [key: string]: unknown } | undefined,
  fallback: string | undefined,
): string {
  const resolved = userContext?.workspaceRoot || fallback || process.env['WORKSPACE_ROOT']
  if (!resolved) {
    throw new Error('workspaceRoot를 결정할 수 없습니다: userContext, fallback, WORKSPACE_ROOT 모두 미설정')
  }
  return resolved
}

/**
 * 경로에 상위 이동(`..`) **세그먼트**가 있는가.
 *
 * `s.includes('..')` 부분문자열 검사는 **정상 파일명을 오거부한다** —
 * `patches/v1..v2.diff` · `src/..hidden.ts` · `a..b/c.ts` 가 전부 걸린다.
 * Security 인바운드가 그 술어를 쓰고 있었고, Zod refine 실패는 메시지 하나가
 * 아니라 **감사 요청 전체를 DLQ 로** 보냈다(기본 대화형 챗 경로에서 발현).
 *
 * 판정은 구분자로 쪼갠 **세그먼트 단위**로 한다. 백슬래시도 구분자로 본다 —
 * LLM 이 Windows 표기를 낼 수 있고, 컨테이너는 리눅스라 `path.sep` 만 보면 샌다.
 *
 * 선례는 Orchestrator `projects/workspace-path.ts` 다 — 같은 오거부를 이미 겪고
 * 세그먼트 판정으로 고쳤다. 그 서비스는 이 라이브러리를 의존하지 않아 사본이 남는다.
 */
export function hasTraversalSegment(p: string): boolean {
  return p.split(/[\\/]+/).includes('..')
}

/**
 * 인바운드 경로가 "워크스페이스 상대 경로"로 받아들일 만한가.
 *
 * **봉쇄가 아니라 1차 거름망이다.** 실제 봉쇄는 각 서비스의 `validatePath` 가
 * 존재하는 최근접 조상 기준 `realpath` 로 한다 — 이 함수는 그 앞단에서
 * 명백히 잘못된 입력을 스키마 단계에서 거르는 용도다(defense in depth).
 */
export function isSafeRelativePath(p: string): boolean {
  return !path.isAbsolute(p) && !hasTraversalSegment(p)
}

export function validateWorkspaceRoot(workspaceRoot: string): void {
  if (!workspaceRoot || workspaceRoot.trim() === '') {
    throw new Error('WORKSPACE_ROOT must not be empty')
  }

  const resolved = path.resolve(workspaceRoot)
  const rootPart = path.parse(resolved).root

  if (resolved === rootPart || resolved === rootPart.replace(/[\\/]$/, '')) {
    throw new Error('WORKSPACE_ROOT must not be filesystem root')
  }
}
