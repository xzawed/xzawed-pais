---
name: designer-skills
scope: service
version: 1.0.0
description: xzawedDesigner 개발·디버깅·운영 스킬
---

# xzawedDesigner 스킬

**테스트 실행**: `pnpm test` (수량은 루트 CLAUDE.md 서비스 표 참조)
**관련 문서**: [docs/services/designer.md](../docs/services/designer.md)

---

### add-component-spec
ComponentSpec 스키마에 새 필드 추가

**파일**: `src/types.ts`의 ComponentSpecSchema

**재귀 스키마 주의사항**:
```typescript
// z.lazy()로 재귀 정의 시 ZodType 어노테이션 필수
const ComponentSpecSchema: z.ZodType<ComponentSpec> = z.object({
  name: z.string(),
  children: z.lazy(() => ComponentSpecSchema.array()).optional(),
  // 새 필드 추가
  variant: z.string().optional(),
})
```

**검증**: `pnpm test src/types.test.ts`

---

### tune-design-prompt
UI 설계 프롬프트 조정

**파일**: `src/claude/runner.ts`의 SYSTEM_PROMPT

**targetFramework / designSystem 파라미터 활용**:
```typescript
const prompt = `
  Framework: ${input.targetFramework ?? 'react'}
  Design System: ${input.designSystem ?? 'tailwind'}
  // 프롬프트 조정
`
```

---

### debug-recursive-spec
재귀 ComponentSpec 파싱 실패 디버깅

```bash
pnpm test src/claude/runner.test.ts -- --reporter=verbose

# 파싱 실패 시 raw JSON 확인
# runner.ts의 parseResponse()에 console.log 임시 추가
```
