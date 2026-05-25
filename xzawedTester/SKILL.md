---
name: tester-skills
scope: service
version: 1.0.0
description: xzawedTester 개발·디버깅·운영 스킬
---

# xzawedTester 스킬

**테스트 실행**: `pnpm test` (32건)
**관련 문서**: [docs/services/tester.md](../docs/services/tester.md)

---

### add-test-framework
새 테스트 프레임워크 지원 추가

**파일**: `src/detector.ts`의 detectTestCommand() + `src/tester.ts`의 ALLOWED_PREFIXES

**예시 — pytest 추가**:
```typescript
// detector.ts
if (hasDep('pytest')) return { command: 'pytest', args: ['--tb=short'] }

// tester.ts ALLOWED_PREFIXES
const ALLOWED_PREFIXES = ['pnpm test', 'npm test', ..., 'pytest']
```

**검증**: `pnpm test src/detector.test.ts`

---

### tune-failure-analysis
테스트 실패 분석 프롬프트 조정

**파일**: `src/claude/runner.ts`의 analyzeFailures()

**TestFailure.suggestion 품질 향상**: SYSTEM_PROMPT에 구체적 수정 제안 요청 추가

---

### debug-test-detection
테스트 명령어 자동 감지 디버깅

```bash
# 감지 결과 확인
node -e "
  const { detectTestCommand } = require('./dist/detector.js')
  console.log(detectTestCommand('/path/to/project'))
"

# validateTestCommand 테스트
node -e "
  const { validateTestCommand } = require('./dist/tester.js')
  console.log(validateTestCommand('pnpm test'))  // OK
  console.log(validateTestCommand('rm -rf /'))   // throw
"
```
