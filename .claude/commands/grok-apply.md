---
allowed-tools: mcp__plugin_grok_grok-build__grok_build_delegate, mcp__plugin_grok_grok-build__grok_build_worktree, Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), Bash(git branch:*), Bash(node -e:*)
description: 스펙이 고정된 다중 파일 기계적 편집을 Grok에 위임 — 설계 재량 0, 전수 diff 검증 필수. 사용법 /grok-apply <적용할 변경 스펙>
---

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status --short`

## Your task

`$ARGUMENTS` 의 변경을 **여러 파일에 기계적으로 적용**하도록 Grok에 위임한다. 처리량을 얻고 나는 설계·검토에 집중하는 것이 목적이다.

### 이 스킬을 쓰는 때

**대상 파일이 3개 이상**이고, 각 파일에 무엇을 어떻게 바꿀지가 **이미 완전히 결정된** 경우에만. 예:

- 여러 서비스의 `package.json` 에 동일한 `pnpm.overrides` 항목 추가
- 여러 `tsconfig.json`·`vitest.config.ts` 에 같은 필드 변경
- 이미 승인된 골든 예제를 N개 서비스에 복제(테스트 파일 등)
- Dockerfile 보안 규칙(`USER node`·`--ignore-scripts`)을 N개에 적용

**쓰지 말아야 할 때:**

- 서비스 간 계약(Redis 메시지·Zod 스키마·복제된 enum) — tsc가 교차검증 못 하는 영역이다. `/contract-drift-check` 참고.
- 무엇을 바꿀지가 아직 안 정해진 경우 — "적절히 개선해줘"는 이 저장소에서 CPD 임계값 0을 깨뜨리는 새 헬퍼를 만들어낸다.
- 보안 표면(`spawn`·경로 검증·authHook·테넌트 경계), 플래그 배선, 정직성 문서(CLAUDE.md 상태 표·`LIVE_VS_FLAGGED.md`).
- 파일이 1~2개 — 내가 직접 하는 게 빠르다.

### 위임 프롬프트에 반드시 포함할 것

1. **기계적 작업임을 명시** — "MECHANICAL TASK. 설계 재량 없음."
2. **정확한 파일 경로 전체 열거** — 글롭이나 "관련 파일들"로 넘기지 않는다. 경로를 다 적는다.
3. **before → after 문자열을 정확히** — 어떤 키를 어떤 값으로. 추측 여지를 남기지 않는다.
4. **금지 사항 명시** — "install 금지, 락파일 금지, 소스코드 금지, 지정하지 않은 부분 재포맷 금지, 키 순서 변경 금지, 들여쓰기 유지."
5. **검증 지시** — "편집한 모든 파일이 여전히 유효한지 파싱해 확인하라(JSON은 node로)."
6. **보고 형식** — 파일별로 실제 추가·변경한 키를 열거하게 한다. "완료"만 오면 검증할 게 없다.

### 적용 후 — 내가 할 일 (건너뛰지 않는다)

Grok의 요약을 신뢰의 근거로 쓰지 않는다. **diff를 직접 본다.**

1. `git diff --name-only` — 파일 수가 스펙과 일치하는가. 지정하지 않은 파일이 섞였는가.
2. `git diff` 전수 확인 — 스펙에 없는 변경이 있는가. 특히 **키 순서 재배열·포맷 변경·인접 필드 "개선"**.
3. 균일해야 할 그룹은 **균일한지 대조**한다:
   ```
   for d in <서비스들>; do node -e "console.log(JSON.stringify(require('./$d/package.json').pnpm.overrides))"; done
   ```
4. JSON/구문 유효성을 내가 다시 확인한다.
5. **`file:` 경로 오염 검사** — `pnpm` 명령이 끼어들었다면 `"file:../xzawedShared"` 가 `"file:..\\xzawedShared"` 로 재작성됐을 수 있다. Linux CI에서 깨진다:
   ```
   grep -rn 'file:\.\.\\' --include=package.json xzawed*/
   ```

드리프트를 하나라도 발견하면 그 파일은 내가 직접 고친다. Grok에 재위임하지 않는다 — 같은 실수를 반복한다.
