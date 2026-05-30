import type { StaticRule } from './static.js'

export const CRYPTO_RULES: StaticRule[] = [
  {
    id: 'S006',
    pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/gi,
    severity: 'high',
    category: 'crypto',
    description: 'MD5 해시 사용 — 충돌 공격에 취약, 패스워드·서명에 부적합',
    suggestion: "crypto.createHash('sha256') 또는 bcrypt/argon2 사용",
    cwe: 'CWE-327',
  },
  {
    id: 'S007',
    pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/gi,
    severity: 'medium',
    category: 'crypto',
    description: 'SHA1 해시 사용 — deprecated, 충돌 가능성 존재',
    suggestion: "crypto.createHash('sha256') 이상 사용",
    cwe: 'CWE-327',
  },
  {
    id: 'S008',
    pattern: /aes-\d+-ecb/gi,
    severity: 'high',
    category: 'crypto',
    description: 'AES-ECB 모드 사용 — 패턴을 노출함, CBC/GCM 권장',
    suggestion: 'AES-256-GCM 등 인증 암호화 모드 사용',
    cwe: 'CWE-327',
  },
]
