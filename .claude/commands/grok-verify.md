---
allowed-tools: mcp__plugin_grok_grok-build__grok_build_delegate, mcp__plugin_grok_grok-build__grok_build_worktree, Read, Grep, Glob, Bash(git diff:*), Bash(git status:*), Bash(git branch:*)
description: 주장을 Grok에 독립 반증 위임 — 격리 워크트리에서 실증만 수행, 수정 금지. 사용법 /grok-verify <반증할 주장>
---

## Context

- Current branch: !`git branch --show-current`
- Changed files vs master: !`git diff --name-only origin/master...HEAD`

## Your task

`$ARGUMENTS` 로 주어진 **주장을 반증**하도록 Grok에 위임한다. 확인이 아니라 반증이다 — 내가 옳다는 걸 확인받는 위임은 확증 편향을 증폭시킬 뿐이다.

### 이 스킬을 쓰는 때

`grok-risk-signal` 훅이 신호를 띄웠거나, 내가 "이건 확실하다"고 느끼는데 그 확신의 근거가 **코드를 읽은 것뿐**일 때. 특히:

- 의존성 major 범프가 안전하다는 주장
- flag off 경로가 변경 전과 동일하다는 주장
- 어떤 테스트가 실제로 그 경로를 덮는다는 주장
- 빌드·테스트가 통과한다는 주장 (내가 아직 안 돌려봤을 때)

**쓰지 말아야 할 때:** 설계가 옳은지, 어떤 접근이 나은지, 이 PR을 머지해도 되는지 — 판단은 위임 대상이 아니다. Grok에게 의견을 물으면 그럴듯한 오답이 온다.

### 위임 전에 결정할 것

주장을 **실행 가능한 이진 명제**로 좁힌다. "안전하다"는 반증 불가다. "`xzawedLauncher`에서 `pnpm build && pnpm test && pnpm typecheck`가 전부 통과한다"는 반증 가능하다.

좁히지 못하겠으면 위임하지 말고 사용자에게 무엇을 확인하고 싶은지 되묻는다.

### 위임 프롬프트에 반드시 포함할 것

Grok이 이 저장소에서 자주 놓치는 것들이다. 생략하면 그럴듯한 거짓 PASS가 온다.

1. **반증 지시와 기본값** — "이 주장을 깨뜨려라. 확신이 서지 않으면 FAIL로 보고하라." 불확실=실패(senario N1).
2. **격리** — `worktree: true`. 메인 워크스페이스의 lockfile·node_modules를 절대 건드리지 않는다.
3. **수정 금지** — "실패를 고치려 하지 마라. 첫 실제 에러에서 멈추고 그대로 보고하라." Grok의 강점은 진단 도중 고치기 시작하지 않는 것이다.
4. **비대화형 install 플래그** — `pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false`. 이게 없으면 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`로 중단된다.
5. **루트 package.json 없음** — 서비스 디렉터리가 각각 독립 pnpm 프로젝트다.
6. **skip을 pass로 위장 금지** — "통합 테스트는 `DATABASE_URL`/`REDIS_URL`이 없으면 skip된다. skip 수를 반드시 별도로 보고하고, skip을 통과로 세지 마라."
7. **xzawedShared 변경 시** — `bash scripts/sync-shared.sh` 선행. `file:` 의존성은 install 시점 복사라 재빌드만으로는 stale이다. (Manager는 이 스크립트 대상이 아니므로 `xzawedManager`에서 별도 install 필요.)
8. **출력 형식** — 이진 VERDICT(PASS/FAIL) + 실패 시 정확한 에러 전문 15줄 + 어떤 명령이 냈는지 + 통과/실패 테스트 수 + **돌리지 않은 것**(잔여 위험).

### 검증 후 — 내가 할 일

Grok의 보고를 **그대로 믿지 않는다.** 다음을 확인한다:

- PASS 주장에 **명령 로그가 붙어 있는가.** 산문만 있으면 안 돌린 것으로 취급한다.
- skip 수가 보고됐는가. 0이라고만 하면 의심한다.
- 잔여 위험 항목이 비어 있으면 되묻는다 — 이 저장소에서 "전부 검증했다"는 거의 항상 거짓이다(Playwright·pg·Redis 중 뭔가는 안 돌았다).

결과를 사용자에게 전할 때는 **PASS/FAIL과 근거를 그대로** 전한다. FAIL을 완화해서 옮기지 않는다.
