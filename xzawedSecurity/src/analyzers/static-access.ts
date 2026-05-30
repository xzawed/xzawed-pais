import type { StaticRule } from './static.js'

export const ACCESS_RULES: StaticRule[] = [
  {
    id: 'S020',
    pattern: /app\.(?:get|post|put|delete|patch)\s*\([^,]+,\s*async\s*\(/g,
    severity: 'medium',
    category: 'access-control',
    description: '인증 훅 없이 등록된 라우트 — 접근제어 누락 의심 (OWASP A5)',
    suggestion: 'authHook 또는 onRequest 훅으로 인증 추가',
    cwe: 'CWE-284',
  },
  {
    id: 'S021',
    pattern: /req\.user(?!\s*\?)/g,
    severity: 'low',
    category: 'access-control',
    description: 'req.user null 검사 없음 — 미인증 접근 시 런타임 오류',
    suggestion: 'req.user?.id 또는 명시적 null 검사 사용',
    cwe: 'CWE-476',
  },
  {
    id: 'S022',
    pattern: /role\s*===?\s*['"]admin['"]/g,
    severity: 'medium',
    category: 'access-control',
    description: '문자열 리터럴 역할 비교 — 오타 취약 (OWASP A5)',
    suggestion: 'ROLE 상수 또는 enum으로 교체',
    cwe: 'CWE-284',
  },
]
