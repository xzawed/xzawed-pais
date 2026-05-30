import type { StaticRule } from './static.js'

export const CONFIG_RULES: StaticRule[] = [
  {
    id: 'S009',
    pattern: /origin\s*:\s*['"]?\*['"]?/g,
    severity: 'medium',
    category: 'config',
    description: 'CORS 와일드카드 origin — 모든 출처의 요청 허용',
    suggestion: '허용 도메인 명시적 whitelisting 적용',
    cwe: 'CWE-942',
  },
  {
    id: 'S010',
    pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/g,
    severity: 'high',
    category: 'config',
    description: 'TLS 인증서 검증 비활성화 — MITM 공격에 취약',
    suggestion: '환경변수 제거 또는 인증서 교체',
    cwe: 'CWE-295',
  },
  {
    id: 'S011',
    pattern: /res\.\s*(?:send|json)\s*\([^)]*\.stack/g,
    severity: 'medium',
    category: 'config',
    description: '에러 스택 트레이스를 HTTP 응답에 포함',
    suggestion: '프로덕션에서 일반 에러 메시지 반환',
    cwe: 'CWE-209',
  },
]
