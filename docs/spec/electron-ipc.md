# Electron IPC

렌더러와 main 프로세스 사이의 경계. **채널 문자열이 여러 곳에 각자 리터럴로 선언된다** — 문자열 리터럴 중복은 tsc가 잡지 못하므로 여기가 정본이다.

## 경계

| 방향 | 보내는 쪽 | 받는 쪽 | 전송 |
|---|---|---|---|
| 렌더러 → main (요청) | `packages/app/src/preload/index.ts` `ipcRenderer.invoke` | `packages/app/src/main/index.ts` `ipcMain.handle` | 채널 문자열 |
| main → 렌더러 (푸시) | `packages/app/src/main/github-oauth-handler.ts` `webContents.send` | `packages/app/src/preload/index.ts` `ipcRenderer.on` | `github:auth-complete` |
| 타입 선언 | — | `packages/app/src/renderer/src/electron.d.ts` | `interface ElectronAPI` (**채널 문자열 없음**) |
| **인증 API 재선언** | — | `packages/ui/src/tokenStorage.ts` · `packages/ui/src/stores/auth.store.ts` | `globalThis` 캐스트 |

**선언처는 셋이 아니라 넷이다.** `packages/ui`가 별도 패키지라 `electron.d.ts`를 볼 수 없어 인증 4개 메서드를 독립 재선언하고, `as unknown as` 캐스트로 타입 링크를 명시적으로 끊는다.

## 계약

**invoke 채널 20개** — 도메인 접두사로 묶인다.

| 도메인 | 채널 |
|---|---|
| 설정 | `settings:get` · `settings:set` |
| GitHub | `github:connect` · `github:disconnect` · `github:get-status` · `github:list-repos` |
| 인증 | `token:set` · `token:clear` · `refresh-token:set` · `auth:restore` |
| MCP | `mcp:list` · `mcp:add` · `mcp:remove` · `mcp:start` · `mcp:stop` · `mcp:statuses` |
| 플러그인 | `plugin:list` · `plugin:install` · `plugin:toggle` · `plugin:uninstall` |

**push 채널 1개** — `github:auth-complete`.

채널을 추가할 때 손대야 하는 곳은 **preload · main · `electron.d.ts`**이고, 인증 계열이면 **`packages/ui`까지 넷**이다.

## 불변식

- **채널 파리티는 검사로만 지킬 수 있다.** preload와 main이 같은 문자열을 각자 적으므로 한쪽만 고치면 런타임에 "핸들러 없음"으로 터진다. `electron.d.ts`는 메서드 시그니처만 갖고 채널 문자열이 없어 이 검사에 참여하지 못한다
- **`github:auth-complete`는 현재 죽은 채널이다.** main이 발신하고 preload가 중계하지만 **렌더러에 호출자가 없다** — OAuth 완료 알림이 UI에 도달하지 않는다
- **드리프트 검사가 push 채널을 구조적으로 놓친다.** `/contract-drift-check`가 쓰는 패턴은 `ipcRenderer.invoke`와 `ipcMain.handle`인데, 이 채널은 `webContents.send`와 `ipcRenderer.on`이라 양쪽 끝 어느 것도 걸리지 않는다
- **`electron.d.ts`의 인증 4개 선언은 소비자가 0이다.** 실제 호출자는 전부 `packages/ui`이고 그쪽은 자기 타입을 쓴다
- **민감 자격증명은 렌더러로 내려가지 않는다 — fail-closed.** GitHub 토큰은 main 프로세스에서만 접근하고, 렌더러는 메모리 스토어의 accessToken만 쓴다(디스크 재조회 금지)
- **MCP `args`는 위험 플래그를 차단한다 — fail-closed.** command allowlist와 함께 `mcp-process-manager.ts`가 강제한다
- **`ipcRenderer.on`에 콜백을 직접 넘기면 `IpcRendererEvent`가 렌더러로 샌다.** 첫 인자에 내부 `sender`가 실리므로 `(_e, ...args) => cb(...args)` 형태로 감싼다

## 강제

- `.claude/commands/contract-drift-check.md` `[3/3]` — invoke 채널 집합 대조(**push 채널은 미커버**)
- `packages/app/src/main/__tests__/` — MCP args 차단·프로세스 관리
- `packages/app/e2e/` — Playwright + Electron 실기동

## 하지 않은 것

- **채널 상수를 공유 모듈로 뽑지 않았다.** preload는 `contextBridge` 경계 안에서 번들되므로 `packages/shared` import가 빌드 구성을 바꾼다. 먼저 검사로 드리프트를 막고, 상수화는 별도 슬라이스로 다룬다
- **`packages/ui`의 재선언을 `electron.d.ts`로 통합하지 않았다.** `ui`는 Electron 없이도 동작해야 하는 패키지라 `globalThis` 캐스트가 의도된 격리다
