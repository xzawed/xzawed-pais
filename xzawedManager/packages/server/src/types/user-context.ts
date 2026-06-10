import path from 'node:path'
import { z } from 'zod'

export const UserContextSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  workspaceRoot: z.string(),
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
