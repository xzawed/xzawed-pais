---
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git grep:*)
description: 여러 곳에 복제된 계약 정의(enum·필드)의 드리프트 진단 — tsc가 교차검증 못하는 사각지대 전담
---

## Context

- Current branch: !`git branch --show-current`
- Changed files vs master: !`git diff --name-only origin/master...HEAD`

## Your task

같은 계약(타입 유니언·스키마 필드·IPC 채널)이 **여러 파일에 비연결로 복제**되어 있어 `tsc`가 교차검증하지 못하는 드리프트를 진단한다. 별도 문자열 배열·SYSTEM_PROMPT 프로즈·다른 패키지의 재정의는 컴파일러가 일치 여부를 모르므로, 한 곳만 바뀌면 런타임까지 조용히 통과한다.

이 스킬은 **읽기전용 진단**이다. 자동 수정하지 않고 불일치만 보고한다. 각 그룹에서 정의 집합을 추출해 비교하고, 다른 항목을 파일·줄 번호와 함께 출력한다.

---

### [1/3] Planner Step.agentType 유니언 (6값 enum)

다음 정의처의 enum 값 집합이 모두 동일한지 비교한다:

| 위치 | 형태 |
|---|---|
| `xzawedPlanner/src/types.ts` | TS interface 유니언 (`agentType: 'developer' \| ...`) |
| `xzawedPlanner/src/claude/runner.ts` | `z.enum([...])` + SYSTEM_PROMPT 프로즈 + fallback 객체 |
| `xzawedManager/packages/server/src/tools/plan-task.ts` | interface 유니언 + `z.enum([...])` |

```
git grep -n "developer.*designer.*tester.*builder.*watcher.*security" -- xzawedPlanner xzawedManager
```

기대 값 집합: `developer, designer, tester, builder, watcher, security`. 한 정의처에만 값이 추가/누락되면 보고한다. 특히 SYSTEM_PROMPT 안의 하드코딩 enum 나열(프로즈)은 tsc가 전혀 검사하지 못하므로 중점 확인.

---

### [2/3] Designer ComponentSpec / UISpec 필드

다음의 zod 스키마와 TS interface 필드 집합이 일치하는지 비교한다:

| 위치 | 형태 |
|---|---|
| `xzawedDesigner/src/types.ts` | zod 스키마 + interface |
| `xzawedManager/packages/server/src/tools/design-ui.ts` | inputSchema(JSON) + 재정의 |

각 스키마의 필드명·필수 여부·enum 값을 추출해 차집합을 보고한다. Planner→Designer→Manager로 흐르는 UISpec이 한 단계만 필드가 어긋나도 조용히 누락된다.

---

### [3/3] Orchestrator IPC 3자 계약

Electron IPC 채널은 타입 없는 문자열 리터럴로 3곳에 중복되어 tsc가 못 잡는다:

| 위치 | 역할 |
|---|---|
| `xzawedOrchestrator/packages/app/src/preload/index.ts` | `ipcRenderer.invoke('채널명')` |
| `xzawedOrchestrator/packages/app/src/main/index.ts` (또는 main/*.ts) | `ipcMain.handle('채널명')` |
| `electron.d.ts` (ElectronAPI 인터페이스 + global var) | 메서드 시그니처 |

```
git grep -n "ipcRenderer.invoke\|ipcMain.handle" -- xzawedOrchestrator/packages/app/src
```

세 곳의 채널 문자열 집합을 추출해:
- preload에 있으나 main에 핸들러 없는 채널 (런타임 무응답)
- main에 있으나 preload·d.ts에 없는 채널
- 반환형 시그니처 불일치(예: `full_name` vs `fullName`)

를 보고한다.

---

### 결과 요약 형식

```
=== CONTRACT-DRIFT-CHECK 결과 ===

[1/3] Planner agentType   ✅ 5개 정의처 일치  /  ❌ DRIFT — <위치: 불일치 값>
[2/3] Designer UISpec     ✅ 일치  /  ❌ DRIFT — <필드 차집합>
[3/3] Orchestrator IPC    ✅ 채널 집합 일치  /  ❌ DRIFT — <누락 핸들러/시그니처>

위험도:
- CRITICAL: preload↔main 채널 불일치 (런타임 무응답), agentType 라우팅 실패
- HIGH: SYSTEM_PROMPT 프로즈 enum과 z.enum 불일치 (LLM이 잘못된 값 생성)
- MEDIUM: 반환형 필드명 표기 불일치
```

DRIFT 발견 시: 어느 정의처를 단일 소스로 삼아 나머지를 맞출지 제안한다. 단, 이 스킬은 보고만 하고 수정은 사용자 판단에 맡긴다.
