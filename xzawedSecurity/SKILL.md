---
name: security-skills
scope: service
version: 1.0.0
description: xzawedSecurity 개발·디버깅·운영 스킬
---

# xzawedSecurity 스킬

**테스트 실행**: `pnpm test` — **개수를 문서에 적지 않는다**. 출력의 `Tests N passed` 와 **skip 수**를 함께 읽는다
**관련 문서**: [docs/services/security.md](../docs/services/security.md)

---

### add-static-rule
새 정적 분석 규칙 추가

**파일**: 카테고리별 모듈 `src/analyzers/static-<카테고리>.ts`.

`static.ts`의 `RULES`는 초기 5개(S001~S005) 전용이고 **새 규칙은 거기 넣지 않는다** — `static.ts`는 각 모듈의 `<CATEGORY>_RULES`를 `ALL_RULES`로 합치는 집계자다. 기존 카테고리면 그 모듈 배열에 덧붙이고, 새 카테고리면 모듈을 만들어 `static.ts`의 import와 `ALL_RULES`에 추가한다.

id는 전역 연속 번호다. 마지막 번호를 먼저 확인한다.

```bash
grep -ho "id: 'S[0-9]*'" src/analyzers/static*.ts | sort -u | tail -1
```

```typescript
// 예: src/analyzers/static-config.ts
export const CONFIG_RULES: StaticRule[] = [
  // ...기존 항목
  {
    id: 'S023',
    pattern: /process\.env\.[A-Z_]+\s*=\s*/,
    severity: 'high',
    category: 'Configuration',
    description: '런타임 환경변수 직접 수정',
    suggestion: '환경변수는 시작 시 config.ts에서 로드. 런타임 수정 금지.',
    cwe: 'CWE-454',
  },
]
```

**검증**: `pnpm test src/analyzers/static.test.ts`(집계 결과) + 해당 카테고리 모듈 테스트

---

### tune-score-formula
보안 점수 계산 공식 조정

**파일**: `src/security.ts`의 calculateScore()

**현재 공식**: `Math.max(0, 100 - (critical×40 + high×15 + medium×5 + low×1))`

**조정 예시** (critical 가중치 낮추기):
```typescript
function calculateScore(issues: SecurityIssue[]): number {
  const deductions = issues.reduce((sum, issue) => {
    const weights = { critical: 30, high: 15, medium: 5, low: 1 }
    return sum + (weights[issue.severity] ?? 1)
  }, 0)
  return Math.max(0, 100 - deductions)
}
```

---

### debug-audit-parse
npm audit 출력 파싱 디버깅

```bash
# npm audit 출력 구조 확인
npm audit --json 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d.get('vulnerabilities',{}).keys())[:5])"

# 비정상 종료코드 확인 (취약점 발견 시 0이 아님)
npm audit --json; echo "exit: $?"
```
