import type { StaticRule } from './static.js'

export const INJECTION_RULES: StaticRule[] = [
  {
    id: 'S012',
    pattern: /exec(?:Sync)?\s*\(\s*`/g,
    severity: 'high',
    category: 'injection',
    description: 'exec()에 템플릿 리터럴 사용 — OS 커맨드 인젝션 위험',
    suggestion: "spawn(bin, args, { shell: false }) 패턴으로 교체",
    cwe: 'CWE-78',
  },
  {
    id: 'S013',
    pattern: /new\s+Function\s*\(/g,
    severity: 'high',
    category: 'injection',
    description: '런타임 코드 생성(new Function) — eval()과 동일한 위험',
    suggestion: '동적 코드 생성 제거, 정적 함수 테이블 사용',
    cwe: 'CWE-94',
  },
]
