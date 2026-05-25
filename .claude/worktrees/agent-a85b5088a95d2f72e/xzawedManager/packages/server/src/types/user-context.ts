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
