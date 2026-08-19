# CLAUDE.md — xzawedOrchestrator

사용자 지시를 받아 정제한 뒤 Manager에 전달하는 서비스(포트 3000)와 Electron 데스크톱 앱. Turborepo다.

## 명령

```bash
pnpm install && pnpm build          # turbo run build
cd packages/server && pnpm dev      # tsx watch
cd packages/server && pnpm test <파일>
cd packages/app && pnpm test:e2e    # Playwright + Electron
```

## 패키지 지도

| 패키지 | 책임 |
|---|---|
| `packages/server` | Fastify HTTP·WebSocket·MCP 서버. Manager 프록시, 인증, 세션 |
| `packages/app` | Electron 앱. main·preload·renderer(React 19 + Zustand). **shadcn/ui·Radix·Tailwind는 여기 있다** |
| `packages/ui` | 로그인·프로젝트 화면과 auth store. 의존성은 `@xzawed/shared`·i18next·zustand뿐 — **shadcn 기반이 아니다** |
| `packages/shared` | 앱·서버 공용 타입 |
| `packages/web` | `SERVE_WEB`로 정적 서빙되는 웹 셸 |

## 계약

- **Manager HTTP** — `packages/server/src/api/`가 Manager로 프록시한다. `UserContext`(`userId`·`projectId`·`workspaceRoot`·`tenantId?`·`githubRepo?`)가 여기서 실려 나간다. `userId`는 필수다
- **WebSocket** — `packages/server/src/ws/session.ws.ts`. 클라이언트는 `SessionWsClient`, 재연결은 `useSessionWs`가 지수 백오프로 처리
- **MCP** — `packages/server/src/mcp/server.ts`가 3개 도구를 노출
- **Electron IPC** — preload ↔ main ↔ `electron.d.ts` 세 곳에 채널 문자열이 **각자 선언된다.** tsc가 교차검증하지 못하므로 채널을 바꾸면 `/contract-drift-check`로 대조한다

## 인증·보안

전 저장소 공통 원칙은 [docs/development/security-patterns.md](../docs/development/security-patterns.md). 이 서비스 고유분만 적는다.

- **CLI 플래그 인젝션 차단** — `cli-runner.ts`가 마지막 사용자 메시지 **바로 앞에** `--` end-of-options 구분자를 넣는다(두 argv 분기 모두). 사용자 문자열이 플래그로 해석되는 것을 막는 지점이다. 단 `--system-prompt`·`--resume` 값은 `--` **앞**에 놓이므로, 그 자리에 외부 입력을 흘리면 이 방어가 적용되지 않는다(현재 세션 경로는 `systemPrompt`를 넘기지 않는다)
- **OAuth CSRF** — `randomBytes(32)`로 state를 만들고 콜백에서 검증(`github-oauth-handler.ts`)
- **MCP 프로세스** — command allowlist + 위험 args 차단(`mcp-process-manager.ts`)
- **GitHub 토큰은 렌더러에 내려가지 않는다.** main 프로세스에서만 접근하고, 렌더러는 메모리 스토어의 accessToken만 쓴다(디스크 재조회 금지)
- **WebSocket 인증** — 헤더를 쓸 수 없으므로 `Sec-WebSocket-Protocol: bearer.<token>` 폴백을 쓴다
- **토큰 복원 중 리다이렉트 보류** — `isRestoring` 가드가 없으면 앱 시작 시 성급하게 `/login`으로 튕긴다
- **rate limit은 전면 적용이 아니다.** 플러그인이 `global: false`라 라우트별로 명시한 곳만 걸린다. 현재 걸린 것은 세션 쓰기 3개(`POST /sessions` 10/분 · `POST /sessions/:id/messages` 30/분 · `POST /sessions/:id/ui-actions` 60/분 — LLM 비용 경로)와 인증 3개(`register`·`login` 5/분, `refresh` 20/분)뿐이다. **프로젝트 CRUD·github-token·knowledge 수정·결정 제출 등 나머지 쓰기 라우트는 무제한**이다. GET에는 어디에도 안 걸려 있다
- **소유권 게이트** — 프로젝트 스코프 쓰기는 미소유 시 **404**로 단락한다. 존재 여부를 흘리지 않기 위한 의도적 선택이라 403이 아니다(서버 코드에 `status(403)`은 0건). 단 **`GET /projects/:projectId/knowledge`와 `GET .../decisions/pending`은 이 pre-handler를 타지 않는다** — 프로젝트 스코프인데 열린 읽기다

## 함정

E2E·테스트 공통 패턴은 [docs/development/testing-patterns.md](../docs/development/testing-patterns.md)에 있다. 여기엔 이 서비스에서만 나오는 것만 둔다.

- **`electronApp.evaluate()`로 ipcMain 핸들러를 교체하지 않는다.** nav 클릭 등 UI 인터랙션 이후에 쓰면 Electron 내부 nav 이벤트 큐가 블로킹된다. test 모드에서 `main.tsx`가 `window.__integrationsStore`를 노출하므로 `page.evaluate()`로 상태를 직접 주입한다
- **`page.route()`는 HTTP만 가로챈다.** `ws://`는 차단할 수 없으므로 WebSocket 에러 경로는 HTTP 엔드포인트 mock으로 대신 시뮬레이션한다
- **MemoryRouter라 `page.waitForURL()`이 동작하지 않는다.** BrowserRouter가 아니므로 DOM testid나 `waitFor({ state: 'visible' })`로 네비게이션 완료를 확인한다
- **`page.reload()` 전에 locale을 선주입한다.** `addInitScript()`로 localStorage에 넣지 않으면 CI에서 i18n 초기화 타이밍이 어긋난다
- **브라우저 모드 테스트는 실제 Chromium을 띄운다.** `@testing-library/react`를 쓸 때 `afterEach(cleanup)`을 명시하지 않으면 렌더가 누적된다
- **i18n 키는 ko/en/ja 세 곳을 동시에 고친다.** 앱은 `packages/app/src/renderer/src/locales/`, 서버는 `packages/server/src/locales/`, 공유 UI는 `packages/ui/src/locales/`에 각각 있다. `/i18n-add` 스킬이 세 파일을 함께 건드리고, CI `i18n-check` 잡이 불일치를 막는다

## 실패 의미론 — 조용히 삼키는 곳

**이 서비스에는 실패를 성공처럼 보이게 하는 지점이 있다.** 저장소 전반의 "무음 통과 금지" 원칙과 어긋나므로 알고 있어야 한다.

- **`POST /sessions/:id/ui-actions`의 Redis 발행 실패는 202로 삼켜진다.** `catch`가 warn 로그만 남기고 `{status:'accepted'}`를 반환한다. **승인 게이트 결정과 명확화 응답이 이 경로로 나가므로, 사람이 승인을 눌렀는데 아무 일도 일어나지 않을 수 있다.** 클라이언트는 성공으로 본다
- **읽기 프록시는 fail-open이다.** knowledge·decisions GET은 Manager가 죽으면 빈 목록을 반환한다. **결정 대기함에서 "대기 중인 결정 없음"과 "Manager 불통"이 UI상 구별되지 않는다**
- **chat과 build 경로의 전달 실패 의미론이 반대다.** chat은 러너가 이미 스트리밍을 끝냈으므로 발행 실패를 삼키고 `done`을 보낸다(fail-open). build는 전달이 유일한 액션이라 실패 시 `error`를 표면화한다(fail-closed)
- **`projectOwnershipPreHandler`는 반드시 `userAuthHook` 다음에 배치한다.** 앞에 두면 `req.authUser`가 없어 방어적으로 skip되고 **IDOR 게이트가 통째로 무력화된다**

## 환경 변수

`packages/server/src/config.ts`의 Zod 스키마가 진실원천이다. 목록을 여기 복사하지 않는다.

기동을 거부하는 조건(`superRefine`).

- `AUTH=jwt`면 `SERVICE_JWT_SECRET`·`USER_JWT_SECRET` **둘 다** 32자 이상
- `CLAUDE_MODE=api`면 `ANTHROPIC_API_KEY` 필수
- `CLAUDE_MODE=remote`면 원격 실행기 설정 필수

**`WORKSPACE_ROOT`의 파일시스템 루트 거부는 기동 검증이 아니다.** `assertNotFilesystemRoot`는 요청 처리 중 `buildUserContext`에서 호출되므로, 잘못된 값으로도 서버는 뜨고 세션을 만들 때 비로소 실패한다.

## 참고

- 저장소 공통 규칙 → [루트 CLAUDE.md](../CLAUDE.md)
- 기본 실행 vs 플래그 게이트 → [docs/LIVE_VS_FLAGGED.md](../docs/LIVE_VS_FLAGGED.md)
