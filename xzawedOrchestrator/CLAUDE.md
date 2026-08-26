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

- **SSH 원격 러너의 인용은 `posix-shell-quote.ts` 가 한다 — `shescape` 는 이 자리에 쓸 수 없다.** `conn.exec(command)` 는 문자열 하나를 **원격 로그인 셸**에 넘기는데 shescape 는 **호스트** 셸 기준으로 이스케이프한다. 실측: `{shell:false}`(이전 판)는 아무것도 이스케이프하지 않고, `{shell:true}`는 Windows 에서 cmd.exe 문법(`a ^&^& b`)을 내면서 POSIX 메타문자 `;`·`'`·백틱은 그대로 통과시키며, `{shell:'/bin/sh'}`는 호스트에 그 바이너리가 없어 **생성자가 throw** 한다(모듈 스코프라 서버 기동이 죽는다). 순수 문자열 변환이라 Windows 로컬·Linux CI·컨테이너가 바이트 동일한 명령을 만든다
- **`--` end-of-options 는 셸 주입을 막지 못한다.** 원격 셸이 단어 분해를 끝낸 뒤에야 `claude` 가 argv 를 본다. `--` 가 실제로 하는 일은 인용 덕에 단어 하나로 살아남은 프롬프트가 CLI 플래그로 읽히는 것을 막는 것뿐이다 — 두 방어를 혼동하면 인용을 빼도 된다고 오판하게 된다. **원격 로그인 셸이 POSIX 라는 전제**도 함께 기억한다(cmd.exe·PowerShell 원격은 커버하지 않는다)
- **명령 조립은 `buildRemoteCommand` 순수 함수다.** 기존 테스트가 `ssh2` 를 통째로 mock 하고 `exec` 의 첫 인자를 `_cmd` 로 버려 **명령 문자열을 아무도 검증하지 않았고**, 그것이 이 결함이 살아남은 이유다. 순수 함수 계약 + 러너가 실제로 그것을 쓰는지 보는 `exec` 인자 단언, 둘 다 있어야 한다
- **CLI 플래그 인젝션 차단** — `cli-runner.ts`가 마지막 사용자 메시지 **바로 앞에** `--` end-of-options 구분자를 넣는다(두 argv 분기 모두). 사용자 문자열이 플래그로 해석되는 것을 막는 지점이다. 단 `--system-prompt`·`--resume` 값은 `--` **앞**에 놓이므로, 그 자리에 외부 입력을 흘리면 이 방어가 적용되지 않는다(현재 세션 경로는 `systemPrompt`를 넘기지 않는다)
- **OAuth CSRF** — `randomBytes(32)`로 state를 만들고 콜백에서 검증(`github-oauth-handler.ts`)
- **MCP 프로세스** — command allowlist + 위험 args 차단(`mcp-process-manager.ts`)
- **MCP 자식은 부모 환경을 물려받지 않는다.** `buildChildEnv`가 `INHERITED_ENV_KEYS`(PATH·HOME·프록시·로케일 등 실행에 필요한 것)만 추려 넘긴다. MCP 서버는 사용자가 추가하는 서드파티 프로세스라 `GITHUB_CLIENT_SECRET`·`ANTHROPIC_API_KEY`가 갈 이유가 없다. `BLOCKED_ENV_KEYS`는 사용자의 **덮어쓰기**만 막는다 — 상속을 막는 것은 이쪽이다
- **`mcp-servers.json`의 `env` 값은 봉인해서 저장한다.** `enc:v1:` 접두사 + `safeStorage`. 스키마를 바꾸지 않으므로 기존 평문 값은 그대로 읽힌다. 복호화 실패(다른 머신·계정)는 그 값만 비우고 서버 항목은 남긴다 — 여기서 throw하면 MCP 목록 전체가 사라진다
- **OS 암호화 저장소가 없으면 토큰이 평문으로 저장된다.** 파일명이 `.enc`여도 그렇다(키링 없는 Linux). 기능은 유지하되 최초 1회 `console.warn`으로 알린다 — 조용한 평문이 문제였지 평문 폴백 자체가 아니다
- **GitHub 토큰은 렌더러에 내려가지 않는다.** main 프로세스에서만 접근하고, 렌더러는 메모리 스토어의 accessToken만 쓴다(디스크 재조회 금지)
- **WebSocket 인증** — 헤더를 쓸 수 없으므로 `Sec-WebSocket-Protocol: bearer.<token>` 폴백을 쓴다
- **토큰 복원 중 리다이렉트 보류** — `isRestoring` 가드가 없으면 앱 시작 시 성급하게 `/login`으로 튕긴다
- **rate limit은 전면 적용이 아니다.** 플러그인이 `global: false`라 라우트별로 명시한 곳만 걸린다. 현재 걸린 것은 세션 쓰기 3개(`POST /sessions` 10/분 · `POST /sessions/:id/messages` 30/분 · `POST /sessions/:id/ui-actions` 60/분 — LLM 비용 경로)와 인증 3개(`register`·`login` 5/분, `refresh` 20/분)뿐이다. **프로젝트 CRUD·github-token·knowledge 수정·결정 제출 등 나머지 쓰기 라우트는 무제한**이다. GET에는 어디에도 안 걸려 있다
- **rate limit 키는 `trustProxy`가 결정한다.** 기본 키가 `req.ip`인데 그 값이 소켓 주소인지 `X-Forwarded-For`인지를 `TRUST_PROXY`가 가른다. 프록시 없이 켜면 클라이언트가 헤더를 바꿔가며 버킷을 새로 잡아 브루트포스 방어가 사라지고, 프록시 뒤에서 끄면 전 사용자가 버킷 하나를 공유해 한 명의 실패가 전원을 잠근다. **양방향으로 틀릴 수 있으므로 배포 형태에 맞춰 명시한다** — 기본값 false
- **CORS는 `MODE=local`에서도 전면 허용이 아니다.** `makeCorsOriginCheck`가 Origin 부재(Electron 프로덕션 `file://`·서버 간 호출)·문자열 `null`·로컬호스트(포트 무관)·`ALLOWED_ORIGINS`만 통과시킨다. 좁힐 때 Electron 경로를 깨면 다음 사람이 `origin: true`로 되돌리므로 그 네 경로는 `cors-origin.test.ts`가 개별로 고정한다. `MODE=remote`는 allowlist 전용이고, 비어 있으면 **기동을 거부**한다
- **워크스페이스 경로 판정은 `projects/workspace-path.ts` 가 단일 출처다.** 등록 진입점이 셋인데(PATCH `/projects/:id/workspace` · POST `/internal/.../register-project` · Redis 게이트웨이) 검사가 서로 달랐다 — `..`·절대경로 검사가 첫 번째에만 있었고, **LLM 이 `register_project` 도구로 값을 정하는 게이트웨이**에는 없었다. 그 판정을 `WorkspaceService` 메서드로 두면 안 된다: 라우트 테스트 3개가 그 클래스를 통째로 mock 하므로 검증기가 무력화된다(실제로 그랬다). 라우트가 순수 모듈을 **직접 import** 한다
- **판정은 `process.platform` 이 아니라 입력 문자열의 모양으로 한다.** 서버가 Linux 컨테이너와 사용자 OS 양쪽에서 돌고(Electron 이 `spawn` 한다) 저장값은 DB 를 거쳐 다른 OS 프로세스로 간다. 호스트 OS 로 판정하면 CI(ubuntu) 그린과 로컬(win32) 그린이 서로 다른 것을 검증하게 되고, win32 네이티브 `path.normalize(/a/b)` 는 POSIX 입력을 `a` 로 재작성한다. 이전 `!localPath.startsWith(/)` 는 Windows 절대경로를 **전부 거부**하고 `//?/C:/Windows` 는 통과시켰다
- **I/O 검사(`assertReadableDirectory`)는 `workspaceType=local` 에만 건다.** github 등록 3곳 중 2곳이 `void cloneRepo(...)` 로 clone 을 던지고 즉시 `workspacePath` 를 확정하므로 그 시점에 목적지가 존재하지 않는다. 존재 검사를 clone 목적지에 걸면 github 등록이 항상 실패한다
- **소유권 게이트** — 프로젝트 스코프 쓰기는 미소유 시 **404**로 단락한다. 존재 여부를 흘리지 않기 위한 의도적 선택이라 403이 아니다(서버 코드에 `status(403)`은 0건). 단 **`GET /projects/:projectId/knowledge`와 `GET .../decisions/pending`은 이 pre-handler를 타지 않는다** — 프로젝트 스코프인데 열린 읽기다

## 헬스체크

`/health` 는 liveness(정적 200), `/health/ready` 는 readiness다. compose healthcheck 는 후자를 친다.

- **`health/readiness.ts` 는 shared 사본이다.** Orchestrator 만 `@xzawed/agent-streams` 를 의존하지 않아(소비처 8곳 중 유일) 복제가 유일한 선택이고, 동일성은 `scripts/check-replicated-blocks.js` 가 `readiness-core` 로 강제한다. 고칠 것이 생기면 **shared 원본을 먼저** 고치고 마커 구간을 그대로 옮긴다 — 손으로 다시 쓰면 반드시 어긋난다
- **`projectGateway` 는 DB 풀이 없으면 생성조차 되지 않는다**(`server.ts` 의 `if (dbPool)` 안). 그래서 접근자가 `undefined` 를 돌려주고 그것은 장애가 아니라 미구성이다 — `server.ts` 는 `projectGatewayRef` 를 라우트 등록보다 먼저 선언해 두고 생성 시점에 채운다
- **readiness 의 Redis ping 은 전용 연결을 써야 한다(S4.3 실측).** 공유 클라이언트는 `StreamConsumer` 가 `XREADGROUP ... BLOCK 2000` 으로 점유하는데, ioredis 는 한 연결에서 명령을 **직렬화**하므로 그 위의 `ping()` 은 블록이 풀릴 때까지 큐에 선다 — readiness 예산 1000ms 보다 블록 2000ms 가 길어 **항상** 초과한다. 증상은 조용하고 치명적이다: 세션이 없을 때는 200 이다가 **첫 세션이 생기는 순간 영구 503**(실측 — 재시작 직후 6/6 → 세션 1개 후 0/6 → 전용 연결로 고친 뒤 10/10). compose healthcheck 는 30초×3 이라 **첫 대화 ~90초 뒤** 컨테이너가 unhealthy 로 뒤집히고 Launcher 는 그걸로 `running` 을 판정한다 — 정상 동작 중인 스택이 사용자에게 "죽었다"고 보고된다. `getProbeRedisClient` 가 그 전용 연결이고, **readiness 가 물어야 하는 것은 "Redis 가 닿는가"이지 "공유 연결이 지금 한가한가"가 아니다** — 소비 루프 생존은 `loopProbe` 가 따로 본다
- **Redis ping 만으로는 부족하다.** 기동 시 Redis 가 죽어 있으면 `xgroup CREATE` 가 소비 루프 **밖**에서 throw 해 게이트웨이가 영구 정지하는데 ioredis 재연결은 계속되므로 `ping()` 은 나중에 PONG 을 준다

## 함정

E2E·테스트 공통 패턴은 [docs/development/testing-patterns.md](../docs/development/testing-patterns.md)에 있다. 여기엔 이 서비스에서만 나오는 것만 둔다.

- **앱은 단일 인스턴스다. 락은 `whenReady()` 앞에서 판정된다.** 두 번째 인스턴스는 창이 하나 더 뜨는 정도가 아니라 userData 의 JSON 세 개(`settings.json`·`mcp-servers.json`·`disabled-plugins.json`)를 전부 '전체 로드 → 메모리 수정 → 전체 덮어쓰기'로 다루므로 나중에 저장한 쪽이 상대의 변경을 통째로 지운다. 락을 못 얻은 인스턴스는 **어떤 핸들러도 등록하지 않고** 종료한다 — `before-quit` 을 락 블록 밖에 두면 진 인스턴스가 이긴 인스턴스의 서버를 죽이는 경로가 열린다. 분기는 `single-instance.test.ts`, 창 복원은 `window-focus.ts`+테스트가 고정한다
- **E2E 는 전용 userData 디렉토리로 띄운다.** 락이 userData 경로 단위라, 격리하지 않으면 개발자가 앱을 열어 둔 채 `pnpm test:e2e` 를 돌릴 때 **모든 launch 가 즉시 quit** 되어 `firstWindow()` 가 타임아웃한다(CI 는 컨테이너라 무사하다 — 로컬에서만 재현되는 실패다). `e2e/isolated-user-data.ts` 가 launch 3지점에 `--user-data-dir` 을 준다. 새 launch 지점을 만들면 그것도 거쳐야 한다
- **종료는 '우아한' 것이 아니라 '경계가 있는' 것이다.** `shutdown.ts` 의 워치독이 5초 예산을 넘기면 `exit(1)` 로 강제 종료한다. 워치독이 없으면 신호 핸들러를 붙이는 것이 **오히려 나쁘다** — Fastify 기본 `keepAliveTimeout` 이 72초(Node 기본의 14.4배)라 인플라이트 요청 하나로 `app.close()` 가 ~71초를 기다리는데 Docker 유예는 기본 10초다. 결말은 여전히 SIGKILL 이고 종료 시간만 늘어난다
- **`onClose` 훅은 등록 역순(LIFO)으로 실행된다.** 실측 확인. `closePool`(가장 먼저 등록)이 소비자 정지 훅들보다 **나중에** 도는 것이 이 순서에 의존한다 — 새 `onClose` 훅을 추가할 때 등록 위치가 실행 순서를 뒤집는다는 것을 기억한다
- **`electronApp.evaluate()`로 ipcMain 핸들러를 교체하지 않는다.** nav 클릭 등 UI 인터랙션 이후에 쓰면 Electron 내부 nav 이벤트 큐가 블로킹된다. test 모드에서 `main.tsx`가 `window.__integrationsStore`를 노출하므로 `page.evaluate()`로 상태를 직접 주입한다
- **`page.route()`는 HTTP만 가로챈다.** `ws://`는 차단할 수 없으므로 WebSocket 에러 경로는 HTTP 엔드포인트 mock으로 대신 시뮬레이션한다
- **MemoryRouter라 `page.waitForURL()`이 동작하지 않는다.** BrowserRouter가 아니므로 DOM testid나 `waitFor({ state: 'visible' })`로 네비게이션 완료를 확인한다
- **`page.reload()` 전에 locale을 선주입한다.** `addInitScript()`로 localStorage에 넣지 않으면 CI에서 i18n 초기화 타이밍이 어긋난다
- **브라우저 모드 테스트는 실제 Chromium을 띄운다.** `@testing-library/react`를 쓸 때 `afterEach(cleanup)`을 명시하지 않으면 렌더가 누적된다
- **i18n 키는 ko/en/ja 세 곳을 동시에 고친다.** 앱은 `packages/app/src/renderer/src/locales/`, 서버는 `packages/server/src/locales/`, 공유 UI는 `packages/ui/src/locales/`에 각각 있다. `/i18n-add` 스킬이 세 파일을 함께 건드리고, CI `i18n-check` 잡이 불일치를 막는다

## 실패 의미론 — 조용히 삼키는 곳

**이 서비스에는 실패를 성공처럼 보이게 하는 지점이 있다.** 저장소 전반의 "무음 통과 금지" 원칙과 어긋나므로 알고 있어야 한다.

- **`POST /sessions/:id/ui-actions`는 발행 실패 시 502를 반환한다 — fail-closed.** 이 라우트에서 발행은 유일한 액션이고 승인 게이트 결정·명확화 응답이 여기로 나가므로, 202로 삼키면 사람이 승인을 눌렀는데 아무 일도 안 일어나고 클라이언트는 성공으로 본다. `build` 경로와 같은 원칙이다
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
