---
allowed-tools: Bash(pnpm build:*), Bash(pnpm test:*), Bash(pnpm audit:*), Bash(npx jscpd*), Bash(git diff:*), Bash(git status:*), Bash(git branch:*), Bash(node --input-type*), Read, Glob, Grep
description: PR 생성 전 체크리스트 자동 실행 — build/test/audit/cpd/E2E선택자/i18n/Dockerfile 순차 검증
---

## Context

- Current branch: !`git branch --show-current`
- Changed files vs master: !`git diff --name-only origin/master...HEAD`
- Git status: !`git status --short`

## Your task

PR 생성 전 체크리스트를 순차 실행하고 합격/실패 요약을 출력한다.

변경된 서비스(위 diff 결과 기준)를 자동 감지하여 해당 서비스만 테스트한다. 서비스 감지 기준:
- `xzawedOrchestrator/` → Turborepo 서비스 (pnpm build/test 루트에서)
- `xzawedManager/` → Turborepo 서비스
- `xzawedShared/` → 독립 서비스 (단, 먼저 빌드 필요)
- `xzawedPlanner/`, `xzawedDeveloper/`, `xzawedDesigner/`, `xzawedTester/`, `xzawedBuilder/`, `xzawedWatcher/`, `xzawedSecurity/` → 독립 서비스

### 체크리스트 순서

**[1/7] 빌드 검사 (tsc 포함)**

변경된 서비스 디렉토리에서 실행:
- Turborepo 서비스: `pnpm build` (루트 또는 해당 서비스 디렉토리)
- 독립 서비스: xzawedShared 선행 빌드 후 해당 서비스 `pnpm build`
- 실패 시: tsc 오류 전문 출력 후 계속 진행

**[2/7] 테스트 실행**

변경된 서비스에서만 실행:
- Turborepo (xzawedOrchestrator): `pnpm test` — unit + browser 모드, 약 443건
- Turborepo (xzawedManager): `pnpm test`
- 독립 서비스: `pnpm test`
- 테스트 수 변화 시 CLAUDE.md의 서비스 현황 테이블 업데이트 필요 여부를 알려준다

**[3/7] 보안 감사**

변경된 서비스 디렉토리에서 `pnpm audit --audit-level=moderate`

**[4/7] CPD (코드 중복) 검사**

프로젝트 루트 `d:\Source\xzawed-pais`에서:
```
npx jscpd@3.5.10 --config .jscpd.json
```
- `.jscpd.json` 설정: threshold 0, minTokens 100, typescript+tsx 대상
- 중복 발견 시: 파일명·줄 번호 목록 출력
- 0 clones 목표. 중복 발견 시 공통 헬퍼 추출 방법 제안

**[5/7] E2E 선택자 검사**

`xzawedOrchestrator/packages/app/e2e/` 하위 `.ts` 파일에서 금지 패턴 탐색:

금지 패턴:
- `getByText(` — 로케일 변경 시 깨짐. `getByTestId(` 로 대체
- `electronApp.evaluate(` — nav 클릭 후 블로킹 부작용. `page.evaluate(` + `window.__integrationsStore` 패턴으로 대체
- `page.route('**/ws/**'` — WebSocket 차단 불가. HTTP 엔드포인트 mock으로 대체
- `page.waitForURL(` — MemoryRouter 환경에서 동작 안함. `waitFor({ state: 'visible' })` 로 대체

금지 패턴이 발견되면 파일명·줄 번호·대체 패턴을 출력한다.

**[6/7] i18n 키 동기화 검사**

다음 4개 파일 쌍의 키 수가 일치하는지 확인:

앱 locales (app.json):
- `xzawedOrchestrator/packages/app/src/renderer/src/locales/ko/app.json`
- `xzawedOrchestrator/packages/app/src/renderer/src/locales/en/app.json`
- `xzawedOrchestrator/packages/app/src/renderer/src/locales/ja/app.json`

앱 locales (common.json):
- `xzawedOrchestrator/packages/app/src/renderer/src/locales/ko/common.json`
- `xzawedOrchestrator/packages/app/src/renderer/src/locales/en/common.json`
- `xzawedOrchestrator/packages/app/src/renderer/src/locales/ja/common.json`

서버 locales (server.json):
- `xzawedOrchestrator/packages/server/src/locales/ko/server.json`
- `xzawedOrchestrator/packages/server/src/locales/en/server.json`
- `xzawedOrchestrator/packages/server/src/locales/ja/server.json`

UI locales (ui.json):
- `xzawedOrchestrator/packages/ui/src/locales/ko/ui.json`
- `xzawedOrchestrator/packages/ui/src/locales/en/ui.json`
- `xzawedOrchestrator/packages/ui/src/locales/ja/ui.json`

각 그룹에서 ko/en/ja의 최상위 키 수를 비교한다. 불일치 시 누락된 키 목록 출력.

**[7/7] Dockerfile 보안 규칙 검사**

변경된 서비스의 `Dockerfile` 파일에서:
- `USER node` 존재 여부 (SonarCloud S6501) — EXPOSE 다음, CMD 바로 앞에 있어야 함
- `pnpm install` 명령에 `--ignore-scripts` 포함 여부 (SonarCloud S6505)

### 결과 요약 형식

모든 체크가 완료되면 다음 형식으로 요약을 출력한다:

```
=== PR-READY 체크리스트 결과 ===

[1/7] 빌드       ✅ PASS  /  ❌ FAIL — <오류 요약>
[2/7] 테스트     ✅ PASS (443건)  /  ❌ FAIL — <실패 테스트명>
[3/7] Audit      ✅ PASS  /  ❌ FAIL — <취약점 수>
[4/7] CPD        ✅ PASS (0 clones)  /  ❌ FAIL — <중복 파일 목록>
[5/7] E2E선택자  ✅ PASS  /  ⚠️ WARN — <금지 패턴 위치>
[6/7] i18n 키    ✅ PASS  /  ❌ FAIL — <누락 키>
[7/7] Dockerfile ✅ PASS  /  ⚠️ WARN — <누락 규칙>

전체: <N>/7 통과
PR 생성 가능: YES / NO (빌드·테스트·Audit·i18n 실패 시 NO)
```

FAIL 항목이 있으면 각 항목의 수정 방법을 구체적으로 제시한다.
