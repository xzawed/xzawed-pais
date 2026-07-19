import { describe, it, expect } from 'vitest'
import { UserContextSchema, AbsoluteUserContextSchema } from './user-context.js'

/**
 * G11 Slice 3: UserContextSchema가 tenantId를 보존하는지(strip하지 않는지) 검증.
 * z.object 기본은 미지 키를 strip하므로, tenantId가 스키마에 명시돼야 graph_dag 영속·워커 주입까지 흐른다.
 */
describe('UserContextSchema tenantId 캐리어 (G11 Slice 3)', () => {
  const base = { userId: 'u1', projectId: 'p1', workspaceRoot: '/workspace/p1' }

  it('tenantId를 보존한다(strip 안 함)', () => {
    const r = UserContextSchema.safeParse({ ...base, tenantId: 'org-42' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tenantId).toBe('org-42')
  })

  it('tenantId 없는 레거시 메시지도 통과(optional·하위호환)', () => {
    const r = UserContextSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tenantId).toBeUndefined()
  })

  it('미지 키는 strip하되 tenantId는 살린다(DLQ 위험 없음)', () => {
    const r = UserContextSchema.safeParse({ ...base, tenantId: 'org-9', bogus: 'x' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.tenantId).toBe('org-9')
      expect((r.data as Record<string, unknown>)['bogus']).toBeUndefined()
    }
  })

  it('AbsoluteUserContextSchema도 tenantId 보존(절대경로 강제 유지)', () => {
    const r = AbsoluteUserContextSchema.safeParse({ ...base, workspaceRoot: '/abs/root', tenantId: 'org-7' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tenantId).toBe('org-7')
  })
})
