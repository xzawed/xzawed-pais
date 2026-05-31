---
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git grep:*)
description: Developer·Builder·Tester의 경로/명령 실행 보안 불변식 정적 감사 — CLAUDE.md 보안 아키텍처 원칙의 점검판
---

## Context

- Current branch: !`git branch --show-current`
- Changed files vs master: !`git diff --name-only origin/master...HEAD`

## Your task

파일 I/O와 명령 실행을 다루는 Developer·Builder·Tester 서비스의 **보안 불변식이 유지되는지** 정적으로 감사한다. CLAUDE.md "보안 아키텍처 원칙"(명령 실행·경로 검증)을 코드에서 점검하는 읽기전용 도구다.

이 스킬은 **읽기전용 advisory**다. 차단·수정하지 않고, 불변식이 약화·누락된 지점만 보고한다. 정당한 예외(atomic-write의 `.tmp` 임시 경로 등)는 오탐 가능성을 함께 표기한다.

---

### [1/5] 경로 검증 — validatePath (realpath + 상대경로 강제)

LLM 생성 경로를 `workspaceRoot` 기준으로 가두는 `validatePath`가 파일 접근 진입점마다 호출되는지 확인한다:

| 서비스 | 위치 |
|---|---|
| Developer | `xzawedDeveloper/src/fileio.ts` |
| Builder | `xzawedBuilder/src/executor.ts` |
| Tester | `xzawedTester/src/executor.ts` |

```
git grep -n "validatePath\|realpath\|path.resolve" -- xzawedDeveloper/src xzawedBuilder/src xzawedTester/src
```

확인 사항: `fs.readFile/writeFile/rename` 등 모든 경로 사용 직전에 `validatePath`를 거치는가. 절대경로를 그대로 허용하거나 `..` 정규화 없이 join하는 곳이 있으면 보고. (단 `.tmp.${Date.now()}` 같은 atomic-write 임시 경로는 정당한 예외로 표기.)

---

### [2/5] WORKSPACE_ROOT 검증 — validateWorkspaceRoot / resolveWorkspaceRoot

파일시스템 루트(`/`, `C:\`)를 workspace로 거부하는 가드가 각 executor 시작 경로에서 호출되는지 확인:

```
git grep -n "validateWorkspaceRoot\|resolveWorkspaceRoot" -- xzawedDeveloper xzawedBuilder xzawedTester xzawedWatcher xzawedSecurity
```

`@xzawed/agent-streams`(`xzawedShared/src/workspace-guard.ts`)에서 공급. import 후 실제 호출까지 이어지는지 확인. 호출 없이 `process.env.WORKSPACE_ROOT`를 직접 쓰는 곳이 있으면 보고.

---

### [3/5] 명령 실행 — spawn(shell:false) 강제

`spawn(cmd, [], {shell:true})` 금지, `spawn(bin, args, {shell:false})` 강제:

```
git grep -n "spawn(\|execFile(\|exec(" -- xzawedBuilder/src xzawedTester/src
```

확인: `shell: true`가 있거나, `shell` 옵션 없이 사용자/LLM 입력을 단일 문자열로 spawn하는 곳. 발견 시 CRITICAL.

---

### [4/5] 명령 allowlist — ALLOWED_PREFIXES

Builder/Tester가 실행할 명령이 하드코딩 allowlist로 제한되는지:

```
git grep -n "ALLOWED_PREFIXES\|allowlist\|ALLOWED_" -- xzawedBuilder/src xzawedTester/src
```

확인: Redis 페이로드의 command 필드가 allowlist 검증을 거치는가. `package.json` scripts 값을 신뢰해 그대로 실행하지 않는가(의존성 기반 하드코딩만 허용).

---

### [5/5] 셸 메타문자 차단 정규식

경로/인자에 셸 메타문자가 섞이면 거부하는 정규식이 유지되는지:

```
git grep -n "[;&|]" -- xzawedBuilder/src/builder.ts
```

기준 패턴: `/[;&|` + "`" + `$><]/.test(...)` (현재 `xzawedBuilder/src/builder.ts`에 존재). 이 가드가 약화·삭제됐는지 확인.

---

### 결과 요약 형식

```
=== DEV-PATH-GUARD-AUDIT 결과 ===

[1/5] validatePath        ✅ 전 진입점 적용  /  ⚠️ <위치: 미적용 경로 사용>
[2/5] WORKSPACE_ROOT 가드  ✅ 호출 확인  /  ⚠️ <위치: 직접 env 사용>
[3/5] spawn shell:false   ✅ PASS  /  🔴 CRITICAL — <위치: shell:true / 문자열 spawn>
[4/5] command allowlist   ✅ PASS  /  ⚠️ <위치: 미검증 command>
[5/5] 메타문자 정규식      ✅ 유지  /  ⚠️ <위치: 약화/삭제>

위험도:
- CRITICAL: spawn shell:true, allowlist 우회 명령 실행
- HIGH: validatePath 미적용 경로 I/O, WORKSPACE_ROOT 미검증
- MEDIUM: 메타문자 정규식 약화
```

발견 시: 해당 CLAUDE.md "보안 아키텍처 원칙" 섹션과 기존 정상 구현(예: `builder.ts`의 메타문자 정규식)을 참조로 제시한다. 보고만 하고 수정은 사용자 판단에 맡긴다.
