---
name: planner-skills
scope: service
version: 1.0.0
description: xzawedPlanner 개발·디버깅·운영 스킬
---

# xzawedPlanner 스킬

**테스트 실행**: `pnpm test` (수량은 루트 CLAUDE.md 서비스 표 참조)
**관련 문서**: [docs/services/planner.md](../docs/services/planner.md)

---

### tune-plan-prompt
계획 생성 프롬프트 조정

**파일**: `src/claude/runner.ts`의 SYSTEM_PROMPT

**검증 방법**:
```bash
# runner.test.ts의 실제 Claude 호출 테스트 (ANTHROPIC_API_KEY 필요)
pnpm test src/claude/runner.test.ts
```

---

### add-step-constraint
Step 스키마에 새 제약 추가

**파일**: `src/types.ts`의 StepSchema

**예시 — 새 agentType 추가**:
```typescript
// src/types.ts
const StepSchema = z.object({
  agentType: z.enum([
    'developer', 'designer', 'tester', 'builder', 'watcher', 'security',
    'newagent',  // 추가
  ]),
  // ...
})
```

**검증**: `pnpm test` (스키마 변경 시 관련 테스트 모두 확인)

---

### debug-plan-fallback
Claude JSON 파싱 실패 시 fallback 동작 확인

**파일**: `src/claude/runner.ts`의 parseResponse()

```bash
# 잘못된 JSON 응답 시뮬레이션 테스트
pnpm test src/claude/runner.test.ts -- --reporter=verbose
```
