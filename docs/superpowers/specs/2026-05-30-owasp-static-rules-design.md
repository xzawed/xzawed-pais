# OWASP 추가 정적 규칙 설계 스펙

## 목표

xzawedSecurity의 정적 분석기에 OWASP A2·A3·A5·A10 카테고리의 정밀 regex 규칙 11개를 추가한다. Claude AI 분석기가 OWASP 전체를 커버하지만, 정적 규칙은 **LLM 비용 없이 즉각적·결정적**으로 탐지하는 보완 레이어다.

## 아키텍처

### 파일 구조 변경

카테고리별로 파일을 분리하여 규칙을 관리한다. 기존 `StaticRule` 인터페이스와 `scanLines()` 함수를 재사용한다.

```
xzawedSecurity/src/analyzers/
├── static.ts              # 기존 (S001~S005) + 카테고리 파일 통합 진입점
├── static-crypto.ts       # 신규: A2 취약한 암호화 (S006~S008)
├── static-config.ts       # 신규: A5 보안 설정 오류 (S009~S011)
├── static-injection.ts    # 신규: A3 인젝션 확장 (S012~S013)
└── static-traversal.ts    # 신규: A10 경로 탈출·SSRF (S014~S016)
```

### 통합 방식

`static.ts`의 `RULES` 배열을 각 카테고리 파일에서 import한 규칙과 합산한다:

```typescript
import { CRYPTO_RULES } from './static-crypto.js'
import { CONFIG_RULES } from './static-config.js'
import { INJECTION_RULES } from './static-injection.js'
import { TRAVERSAL_RULES } from './static-traversal.js'

const ALL_RULES: StaticRule[] = [
  ...RULES,           // 기존 S001~S005
  ...CRYPTO_RULES,
  ...CONFIG_RULES,
  ...INJECTION_RULES,
  ...TRAVERSAL_RULES,
]
```

`analyzeFiles()` 함수는 `RULES` 대신 `ALL_RULES`를 사용하도록 수정한다.

## 규칙 상세

### static-crypto.ts — A2: 취약한 암호화

| ID | 패턴 | 심각도 | CWE | 설명 |
|---|---|---|---|---|
| S006 | `createHash\(['"]md5['"]\)` | high | CWE-327 | MD5는 충돌 공격에 취약, 패스워드·서명에 부적합 |
| S007 | `createHash\(['"]sha1['"]\)` | medium | CWE-327 | SHA1 deprecated, 충돌 가능성 존재 |
| S008 | `/aes-\d+-ecb/i` | high | CWE-327 | ECB 모드는 패턴을 노출함, CBC/GCM 권장 |

**수정 제안:**
- S006/S007: `crypto.createHash('sha256')` 또는 bcrypt/argon2 사용
- S008: AES-256-GCM 등 인증 암호화 모드 사용

### static-config.ts — A5: 보안 설정 오류

| ID | 패턴 | 심각도 | CWE | 설명 |
|---|---|---|---|---|
| S009 | `origin\s*:\s*['"]?\*['"]?` | medium | CWE-942 | CORS 와일드카드, 모든 출처의 요청 허용 |
| S010 | `NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?` | high | CWE-295 | TLS 인증서 검증 비활성화 — MITM 공격 취약 |
| S011 | `res\.(send\|json)\s*\([^)]*\.stack` | medium | CWE-209 | 에러 스택 트레이스를 HTTP 응답에 포함 |

**수정 제안:**
- S009: 허용 도메인 명시적 whitelisting
- S010: 환경변수 제거 또는 인증서 교체
- S011: 프로덕션에서 일반 에러 메시지 반환

### static-injection.ts — A3: 인젝션 확장

| ID | 패턴 | 심각도 | CWE | 설명 |
|---|---|---|---|---|
| S012 | `exec(?:Sync)?\s*\(\s*\`` | high | CWE-78 | exec()에 템플릿 리터럴 사용 — OS 커맨드 인젝션 |
| S013 | `new\s+Function\s*\(` | high | CWE-94 | 런타임 코드 생성, eval()과 동일한 위험 |

**수정 제안:**
- S012: `spawn(bin, args, { shell: false })` 패턴으로 교체
- S013: 동적 코드 생성 제거, 정적 함수 테이블 사용

### static-traversal.ts — A10: 경로 탈출·SSRF

| ID | 패턴 | 심각도 | CWE | 설명 |
|---|---|---|---|---|
| S014 | `path\.(join\|resolve)\s*\([^)]*req\.(params\|query\|body)` | high | CWE-22 | 사용자 입력을 path.join에 직접 삽입, 경로 탈출 가능 |
| S015 | `(?:fetch\|axios)\s*\(\s*(?:req\|request)\.(?:params\|query\|body)` | high | CWE-918 | 사용자 입력 URL로 직접 외부 요청, SSRF 위험 |
| S016 | `['"\`]file:\/\/` | medium | CWE-73 | file:// 프로토콜 하드코딩, 로컬 파일 접근 가능성 |

**수정 제안:**
- S014: `path.basename()` + `workspaceRoot` 경계 검증
- S015: URL 파싱 후 허용 도메인 whitelist 검증
- S016: HTTP/HTTPS 스키마만 허용

## 데이터 흐름

변경 없음. 기존 파이프라인을 그대로 사용한다:

```
audit_request (Redis)
  → Security.handle()
    → analyzeFiles(ALL_RULES)   ← 규칙 배열만 확장
    → auditDeps()
    → runner.analyzeArtifacts()
  → audit_complete (Redis)
```

## 오탐지 방지 전략

엄격 모드 요구사항에 따라 각 regex는:
- 키워드 앞뒤 `\s*`로 공백 허용
- 문자열 리터럴 내부만 탐지 (변수명·주석 미탐지)
- 파일 확장자 필터: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` (정적 분석 대상 유지)
- 테스트 파일(`*.test.ts`, `*.spec.ts`, `__tests__/`)은 severity를 낮추거나 `/* nosonar */` 주석으로 억제 가능

## 테스트 전략

각 카테고리 파일마다 전용 테스트 파일을 추가한다:
- `static-crypto.test.ts` — 탐지 케이스 + 정상 케이스(오탐 없음) 각 3개
- `static-config.test.ts` — 동일
- `static-injection.test.ts` — 동일
- `static-traversal.test.ts` — 동일

기존 `static.test.ts` 패턴을 참고하여 `scanFiles()` mock으로 단위 테스트.

## 범위 외

- Claude AI 분석기 수정 없음 (이미 OWASP 전체 커버)
- `SecurityIssue` 타입 변경 없음
- 기존 5개 규칙(S001~S005) 수정 없음
- 규칙 억제(suppression) 메커니즘 추가 없음 (향후 과제)
