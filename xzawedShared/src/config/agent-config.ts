import { z } from 'zod'

/**
 * 에이전트 7종의 공통 설정 계약.
 *
 * 일곱 서비스가 각자 같은 Zod 스키마와 같은 env 매핑을 복사해 갖고 있었다. 서비스끼리
 * 직접 import할 수 없으므로(M3) 공유점은 여기뿐이다.
 *
 * **복사본은 이미 어긋나 있었다** — 같은 `workspaceRoot` 필드인데 Planner·Designer만
 * 오류 메시지를 갖고 나머지는 없었다. 이런 드리프트는 tsc가 잡지 못한다.
 *
 * 서비스별 필드는 `.extend()`로 얹고, Claude를 쓰지 않는 Watcher는 `.omit()`으로 뺀다.
 */

/** Claude를 호출하는 에이전트의 공통 필드. `defaultPort`만 서비스마다 다르다. */
export function baseAgentSchema(defaultPort: number) {
  return z.object({
    anthropicApiKey: z.string().min(1),
    claudeModel: z.string().default('claude-sonnet-4-6'),
    redisUrl: z.string().default('redis://localhost:6379'),
    port: z.coerce.number().int().positive().default(defaultPort),
    mode: z.enum(['local', 'remote']).default('local'),
    workspaceRoot: z.string().min(1, 'WORKSPACE_ROOT is required'),
  })
}

/**
 * 공통 필드의 env 매핑. Zod가 기본으로 미지 키를 strip하므로, Claude 필드를 `omit`한
 * 스키마(Watcher)에 이 결과를 그대로 넘겨도 안전하다.
 */
export function baseAgentEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    anthropicApiKey: env['ANTHROPIC_API_KEY'],
    claudeModel: env['CLAUDE_MODEL'],
    redisUrl: env['REDIS_URL'],
    port: env['PORT'],
    mode: env['MODE'],
    workspaceRoot: env['WORKSPACE_ROOT'],
  }
}
