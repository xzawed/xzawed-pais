import path from 'node:path'
import { z } from 'zod'

export const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
  // G11 Slice 3: 소유 org(테넌트)·Orchestrator가 전파. additive optional — 미포함 레거시 메시지 그대로 통과.
  //   스키마에 명시해야 z.object 기본 strip에 지워지지 않고 graph_dag 영속·워커 주입까지 흐른다(Slice 4 소비 토대).
  tenantId: z.string().optional(),
  githubRepo: z.object({
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
  }).optional(),
})

export type UserContext = z.infer<typeof UserContextSchema>

/** P4a-2 자율 실행 경로 전용: workspaceRoot **절대경로 강제**(설계 결정 #4의 코드 계약 승격).
 *  상대경로는 manager cwd 하위 mkdir → 에이전트 cwd 기준 해석으로 developer false-success(산출물 유실)·
 *  builder/tester reclaim 루프를 만들므로 Zod 단계에서 차단한다. 대화형(task_request) 경로는 기존
 *  UserContextSchema 유지(레거시 영향 0). */
export const AbsoluteUserContextSchema = UserContextSchema.refine(
  (uc) => path.isAbsolute(uc.workspaceRoot),
  { message: 'workspaceRoot must be an absolute path', path: ['workspaceRoot'] },
)
