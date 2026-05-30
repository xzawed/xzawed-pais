import type { StaticRule } from './static.js'

export const TRAVERSAL_RULES: StaticRule[] = [
  {
    id: 'S014',
    pattern: /path\.\s*(?:join|resolve)\s*\([^)]*req\.\s*(?:params|query|body)/g,
    severity: 'high',
    category: 'traversal',
    description: '사용자 입력을 path.join에 직접 삽입 — 경로 탈출 가능',
    suggestion: 'path.basename() + workspaceRoot 경계 검증 적용',
    cwe: 'CWE-22',
  },
  {
    id: 'S015',
    pattern: /(?:fetch|axios)\s*\(\s*(?:req|request)\.\s*(?:params|query|body)/g,
    severity: 'high',
    category: 'ssrf',
    description: '사용자 입력 URL로 직접 외부 요청 — SSRF 위험',
    suggestion: 'URL 파싱 후 허용 도메인 whitelist 검증',
    cwe: 'CWE-918',
  },
  {
    id: 'S016',
    pattern: /['"`]file:\/\//g,
    severity: 'medium',
    category: 'traversal',
    description: 'file:// 프로토콜 하드코딩 — 로컬 파일 접근 가능성',
    suggestion: 'HTTP/HTTPS 스키마만 허용',
    cwe: 'CWE-73',
  },
]
