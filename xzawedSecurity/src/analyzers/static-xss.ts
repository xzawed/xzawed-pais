import type { StaticRule } from './static.js'

export const XSS_RULES: StaticRule[] = [
  {
    id: 'S017',
    pattern: /document\.write\s*\(/g,
    severity: 'high',
    category: 'xss',
    description: 'document.write() — XSS 위험 (OWASP A3)',
    suggestion: 'DOM API(textContent, createElement)로 교체',
    cwe: 'CWE-79',
  },
  {
    id: 'S018',
    pattern: /\$\([^)]+\)\.html\s*\([^)]/g,
    severity: 'high',
    category: 'xss',
    description: 'jQuery .html() — XSS 위험 (OWASP A3)',
    suggestion: '.text() 또는 안전한 DOM 조작으로 교체',
    cwe: 'CWE-79',
  },
  {
    id: 'S019',
    pattern: /dangerouslySetInnerHTML\s*=\s*\{/g,
    severity: 'medium',
    category: 'xss',
    description: 'dangerouslySetInnerHTML — React XSS 위험 (OWASP A3)',
    suggestion: '사용 전 DOMPurify 등으로 sanitize 필수',
    cwe: 'CWE-79',
  },
]
