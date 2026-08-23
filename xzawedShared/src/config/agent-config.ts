import { readFileSync } from 'node:fs'
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

/**
 * `<KEY>_FILE` 이 있으면 그 파일 내용을, 없으면 `<KEY>` 를 돌려준다.
 *
 * compose secret 은 값을 env 가 아니라 컨테이너 안 tmpfs 파일로 준다 — env 로 받으면
 * `docker inspect` 의 `Config.Env` 에 평문으로 남기 때문이다.
 *
 * **`_FILE` 이 설정됐는데 읽지 못하면 throw 한다.** 조용히 `<KEY>` 로 폴백하면 시크릿
 * 마운트가 깨진 것을 아무도 모른 채 다른 값으로 돈다 — '키 없음'보다 나쁜 것이
 * '키가 있는 척'이다.
 */
// jscpd:ignore-start
// replicated-block: secret-file-env
// Orchestrator 는 @xzawed/agent-streams 를 의존하지 않는다(Manager 와 달리). 계약을 복제하는
// 것 말고 선택이 없으므로 scripts/check-replicated-blocks.js 가 동일성을 강제한다.
export function readSecretEnv(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  const filePath = env[`${key}_FILE`]
  if (filePath === undefined || filePath === '') return env[key]
  try {
    return readFileSync(filePath, 'utf-8').trim()
  } catch (e) {
    throw new Error(`${key}_FILE=${filePath} 을(를) 읽지 못했습니다: ${String(e)}`)
  }
}
// jscpd:ignore-end

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
    anthropicApiKey: readSecretEnv(env, 'ANTHROPIC_API_KEY'),
    claudeModel: env['CLAUDE_MODEL'],
    redisUrl: env['REDIS_URL'],
    port: env['PORT'],
    mode: env['MODE'],
    workspaceRoot: env['WORKSPACE_ROOT'],
  }
}

/** 공통 필드만 쓰는 에이전트의 설정 타입. `makeAgentConfig`의 반환 타입과 짝이다. */
export type AgentConfig = z.infer<ReturnType<typeof baseAgentSchema>>

/**
 * 공통 필드만 쓰는 에이전트를 위한 완성형 팩토리.
 *
 * 스키마와 loadConfig를 각 서비스가 따로 조립하면 그 조립 코드 자체가 다시
 * 서비스마다 같은 모양으로 복제된다 — 포트 한 글자만 다른 파일 넷이 생긴다.
 * 조립까지 여기서 끝내면 호출부는 두 줄이 된다.
 */
export function makeAgentConfig(defaultPort: number) {
  const schema = baseAgentSchema(defaultPort)
  return { schema, loadConfig: loadAgentConfig(schema) }
}

/**
 * 서비스 고유 필드를 얹은 스키마용 로더.
 *
 * 스키마만 공통화하면 **loadConfig 조립부가 다시 복제된다** — Tester·Builder·Watcher가
 * 아홉 줄을 공유하고 있었다(SonarCloud 신규 코드 중복이 이걸 잡았다). 조립까지 여기서
 * 끝내면 호출부에 남는 것은 스키마 정의와 env 매핑뿐이다.
 */
export function loadAgentConfig<S extends z.ZodTypeAny>(
  schema: S,
  extraEnv: (env: Record<string, string | undefined>) => Record<string, unknown> = () => ({}),
) {
  return (env: Record<string, string | undefined> = process.env): z.infer<S> =>
    schema.parse({ ...baseAgentEnv(env), ...extraEnv(env) }) as z.infer<S>
}
