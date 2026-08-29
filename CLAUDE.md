# CLAUDE.md

xzawedPAIS는 AI 멀티 에이전트 오케스트레이션 플랫폼이다. 사용자가 원하는 것을 자연어로 설명하면 특화된 Claude 에이전트들이 계획·개발·디자인·테스트·빌드·모니터링을 나눠 수행한다.

**모든 서비스가 이 단일 저장소에 있고, 서비스 간 통신은 Redis Streams만 쓴다.** 서로 직접 import하지 않는다(CI `module-boundaries` 잡이 강제).

> **기본 동작은 대화형 챗 + 사람 승인 게이트다.** 자율 Task Graph 아크·검증 채널·의사결정/오라클/리스크/릴리스/배포/강등 체인은 **전부 플래그 뒤에 있고 기본 off**다. 무엇이 기본 실행되고 무엇이 휴면인지는 [docs/LIVE_VS_FLAGGED.md](docs/LIVE_VS_FLAGGED.md)가 단일 진실원천이다. 자율 스택은 `PAIS_PROFILE=autonomous`(+JWT·DB)로 켠다.

## 서비스

각 서비스의 구조·계약·함정은 자기 `CLAUDE.md`에 있다. 이 표는 색인이지 요약이 아니다.

| 서비스 | 포트 | 역할 |
|---|---|---|
| [Orchestrator](xzawedOrchestrator/CLAUDE.md) | 3000 | 사용자 지시 수신·정제, Electron UI, 승인·결정 표면 |
| [Manager](xzawedManager/CLAUDE.md) | 3001 | Claude tool-calling 루프, 에이전트 디스패치, 자율 아크 |
| [Shared](xzawedShared/CLAUDE.md) | — | 에이전트 공통 라이브러리 `@xzawed/agent-streams` |
| [Planner](xzawedPlanner/CLAUDE.md) | 3002 | intent → 실행 가능한 Step[] 분해 |
| [Developer](xzawedDeveloper/CLAUDE.md) | 3003 | 코드 생성·수정, 파일 I/O |
| [Designer](xzawedDesigner/CLAUDE.md) | 3004 | UI 컴포넌트 스펙 설계 |
| [Tester](xzawedTester/CLAUDE.md) | 3005 | 테스트 실행·분석 |
| [Builder](xzawedBuilder/CLAUDE.md) | 3006 | 빌드 감지·실행 |
| [Watcher](xzawedWatcher/CLAUDE.md) | 3007 | 파일 변경 감시·이벤트 스트리밍 |
| [Security](xzawedSecurity/CLAUDE.md) | 3008 | OWASP 보안 감사 |
| [Launcher](xzawedLauncher/CLAUDE.md) | — | 비개발자용 설치·실행 런처(Electron) |

## 명령

**저장소 루트에 `package.json`이 없다.** 모든 명령은 서비스 디렉토리에서 실행한다.

Turborepo는 Orchestrator·Manager **둘뿐**이다.

```bash
cd xzawedOrchestrator && pnpm install && pnpm build   # turbo run build
cd packages/server && pnpm dev                        # tsx watch
cd packages/server && pnpm test <파일>
```

에이전트 7종(Planner·Developer·Designer·Tester·Builder·Watcher·Security)은 단일 패키지다.

```bash
cd xzawedPlanner && pnpm install && pnpm dev          # tsx watch
pnpm build                                            # tsc → dist/
pnpm test <파일>
```

예외 둘. **`xzawedShared`에는 `dev` 스크립트가 없다**(라이브러리 — `build`·`test`만). **`xzawedLauncher`는 pnpm 워크스페이스**라 `dev`가 `pnpm --filter @xzawed/launcher-app dev`(electron-vite)이고 `build`는 shared→app 2단계 필터 체인이다.

**독립 서비스는 `xzawedShared`를 먼저 빌드해야 한다.** `@xzawed/agent-streams`를 `file:../xzawedShared`로 참조하는데, `file:` 의존은 install 시점에 `node_modules`로 **복사**된다. shared를 재빌드해도 그 복사본은 다음 install까지 stale로 남는다(CI·Docker는 매번 fresh install이라 무관).

```bash
bash scripts/sync-shared.sh   # shared 빌드 + 소비자 8곳(Manager 포함) 복사본 일괄 갱신
```

## 공통 기술 스택

TypeScript strict 공통. **Fastify 5** · **ioredis 5** · **Zod 3** · **@anthropic-ai/sdk** · **Vitest 4** (`pool: 'forks'` 프로세스 격리) · **pnpm 10** (npm/yarn 금지).

Orchestrator 추가: React 19 + Electron 43 + Zustand, Tailwind v4, shadcn/ui, Playwright E2E, MCP SDK, Octokit, i18next(ko/en/ja).

버전은 각 `package.json`이 진실원천이다. 문서에 복사하지 않는다.

## Redis Streams

```
{출발지}:to-{목적지}:{sessionId}   →   소비자 그룹: {목적지}-consumers
```

모든 메시지는 `{ sessionId, messageId, timestamp, type, payload }` 봉투를 쓴다. 재시도·DLQ 격리·멱등 소비는 shared `BaseConsumer`가 담당한다.

**이 봉투는 강제되지 않는다.** shared의 `CollabMessage`는 TypeScript 타입일 뿐이고 각 서비스가 자기 `types.ts`에 Zod로 다시 선언한다(제약도 제각각이다). tsc가 이 경계를 교차검증하지 못하므로 봉투를 바꿀 때는 `/contract-drift-check`로 대조한다. 참고로 `EventEnvelopeSchema`는 이것과 **다른 것**이다 — 이벤트소싱 메타데이터(`eventId`·`correlationId`·`causationId`·`idempotencyKey` 등)이지 스트림 봉투가 아니다.

## 환경 변수

각 서비스의 `.env.example`을 `.env`로 복사한다 — 단 **`xzawedShared`·`xzawedLauncher`에는 없다**(전자는 라이브러리, 후자는 Electron 앱).

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=<서비스별>
MODE=local
```

Watcher는 Claude API를 쓰지 않아 API 키가 불필요하다. 서비스별 전체 목록은 각 `src/config.ts`의 Zod 스키마가 갖는다.

## 테스트 함정

코드만 봐서는 알 수 없는 것들. 상세와 E2E 패턴은 [docs/development/testing-patterns.md](docs/development/testing-patterns.md).

- **블로킹 I/O mock은 `setImmediate`로 macrotask를 양보해야 한다.** `xreadgroup`을 `mockResolvedValue(null)`로 즉시 resolve하면 마이크로태스크 루프가 macrotask 큐를 굶겨 `stop()`이 영영 호출되지 않고 OOM으로 죽는다.
- **자기 ioredis 클라이언트를 만드는 서비스는 테스트에서 재연결을 꺼야 한다.** `retryStrategy: process.env['VITEST'] === 'true' ? () => null : undefined`. 안 그러면 무한 재연결이 이벤트 루프를 살려둔다. 현재 해당하는 것은 **Manager·Orchestrator 둘뿐**이고, 에이전트 7종은 자기 클라이언트 없이 shared `BaseConsumer`를 쓴다.
- **E2E 선택자는 `data-testid` 전용이다.** i18n 적용 후 텍스트 기반 선택자는 로케일이 바뀌면 깨진다.
- **`.count()`는 auto-wait가 없다.** 즉시 스냅샷이라 렌더 전 0을 읽는다. **열린 Dependabot PR 15건을 전부 red로 만든 CI 상시 실패의 원인이었다.** 재시도가 걸리는 `expect(...).not.toHaveCount(0)`을 쓴다.
- **통합 테스트는 DB·Redis가 없으면 skip된다.** 로컬 그린이 CI 그린이 아니다 — skip 수를 항상 확인한다. **CI에서는 `REQUIRE_INTEGRATION=1`로 게이트를 fail-closed로 만든다** — vitest는 전부 skip돼도 **exit 0**이라, 인프라 컨테이너를 붙여 놓고 env를 빠뜨리면 그 잡이 아무것도 안 돌고 초록이 된다(Manager→Planner 메시지 계약 테스트가 CI 어디서도 실행되지 않은 채 오래 있었다). Manager `test/vitest-global-setup.ts`가 게이트가 닫히면 throw한다. 게이트의 env 목록은 **"하나라도 있으면 그 게이트의 테스트가 전부 돈다"**를 만족해야 한다 — 관대하면 경고는 침묵하는데 테스트는 skip된다.

## 보안 불변식

상세와 근거는 [docs/development/security-patterns.md](docs/development/security-patterns.md).

- **프로덕션 `src/`의 명령 실행은 `spawn(bin, args, {shell:false})`.** 10개 spawn 지점 전부 준수한다. 빌드 래퍼(`packages/app/scripts/dev.js`)와 훅(`.claude/hooks/branch-check.mjs`)은 `shell:true`를 쓰는데, LLM 입력이 닿지 않는 개발 도구라 예외다 — **`src/`에 들이지 않는다**
- Redis 페이로드의 커맨드 필드는 allowlist 검증. `package.json` scripts 값을 신뢰하지 않는다 — 의존성 기반 하드코딩 명령만 쓴다
- **주 소비자(shared `BaseConsumer`, Orchestrator·Manager `StreamConsumer`)는 Zod `safeParse` 후 처리**하고 실패 시 DLQ 격리 또는 `xack` 후 skip한다(프로세스 중단 금지). 단 `SessionDispatcher`·`WatcherEventConsumer`는 `JSON.parse` + 필드 duck-typing이라 Zod를 거치지 않는다 — 새 인바운드 경로를 만들 때는 duck-typing을 답습하지 말고 스키마를 붙인다
- **`xack`은 어떤 경로로든 보장된다.** `StreamConsumer`는 `handler(msg)`를 `try/finally`로 감싸고, `BaseConsumer`는 배치를 `finally`로 감싸며 `handleMessage`를 never-throw로 유지한다(PEL 누수 방지)
- LLM 생성 경로는 절대경로 금지, `workspaceRoot` 기준 상대경로로 강제. `validateWorkspaceRoot`가 파일시스템 루트를 거부하는데 **기동 시 호출하는 것은 에이전트 7종뿐**이다 — Manager는 `ensureWorkspace`에서, Orchestrator는 자체 `assertNotFilesystemRoot`로 각각 다른 지점에서 막는다
- **상대경로라는 것만으로는 봉쇄가 아니다.** 빈 상대경로(`.`·`''`·`a/..`)는 루트 자신을 가리키고, 리프만 `realpath`하면 중간 심볼릭 링크가 새어 나간다. 판정은 존재하는 최근접 조상 기준으로 하고 파생 경로에도 같이 건다 — 상세는 [security-patterns](docs/development/security-patterns.md)
- **`userContext`는 서버가 정하는 값이다.** `resolveWorkspaceRoot`가 이 값을 설정보다 우선하므로 LLM 도구 입력에 실려 오면 모델이 워크스페이스를 고르게 된다. `publishRequest`가 도구 입력에서 벗겨낸다
- `fetch`·`shell.openExternal` URL은 파싱 후 프로토콜·접두사 검증(SSRF·open redirect)
- Electron: 민감 자격증명을 렌더러에 노출 금지, MCP `args`의 위험 플래그 차단
- Dockerfile: runner 스테이지에 `USER node`, 모든 `pnpm install`에 `--ignore-scripts`

## 개발 워크플로우

**모든 작업은 PR로 진행한다.** `master` 직접 push 금지.

> master에 직접 커밋하면 SonarCloud "New Code" 계산 기준이 꼬여 소급 PR로도 CPD 통과가 어려워진다.

브랜치: `feat|fix|docs|chore/<서비스>/<설명>`

PR 전 필수 — [`/pr-ready`](.claude/commands/pr-ready.md) 스킬이 자동화한다.

```bash
pnpm build && pnpm test                        # 해당 서비스
pnpm audit --audit-level=moderate              # dev 포함. --prod만 보면 놓친다
npx jscpd@3.5.10 --config .jscpd.json <경로...>  # 0 clones. **경로를 반드시 준다**
node scripts/check-replicated-blocks.js        # 복제 계약 블록 동일성
node scripts/check-compose-parity.js           # prod compose 두 사본 동일성
node scripts/check-i18n.js                     # ko/en/ja 일치
node scripts/check-docs.js                     # 링크 실존 · CLAUDE.md 200줄·이력 마커 0
```

훅은 `bash scripts/install-hooks.sh`로 설치한다(pre-commit tsc, pre-push CPD+audit). 별도로 `.claude/settings.json`이 Claude Code 훅 5개를 등록한다 — `post-edit`·`mock-guard`(PostToolUse), `grok-risk-signal`·`pre-commit`·`branch-check`(PreToolUse Bash).

의존성 알림이 재발하면 새 취약점보다 **낡은 override 핀**을 먼저 의심한다. 각 서비스 `package.json`의 `pnpm.overrides`로 전이 의존성을 해결하고, `pnpm.auditConfig.ignoreGhsas`는 **ignore를 비운 상태로 audit을 실측해서** 무시 사유의 만료 여부를 재검증한다(추정 금지).

**`overrides`는 정확 버전으로 쓴다** — 범위(`^`·`>=`)는 이미 잠긴 전이 버전을 재해석하지 않아 무효다. 그래서 **정확 핀이 걸린 패키지의 Dependabot PR은 no-op으로 반복 생성된다**(manifest만 바뀌고 설치본은 그대로). 로그에 `Lockfile is up to date, resolution step is skipped`가 보이면 그 초록은 거짓 신호다.

**버전 비호환은 에러 메시지가 아니라 `peerDependencies`로 판정한다.** `ERR_PACKAGE_PATH_NOT_EXPORTED` 류는 "한 단계만 올리면 되겠다"는 오추론을 부른다. `npm view <pkg>@<major> peerDependencies`로 얽힌 패키지들의 범위 **교집합**을 먼저 구한다.

**Dependabot PR이 붉으면 Sonar부터 의심하지 않는다** — sonar 잡은 `if: always()`라 bot PR의 `SONAR_TOKEN` 부재를 가시적 통과로 처리한다. 실제로 터지는 곳은 `--frozen-lockfile`을 도는 서비스 잡이다: **봇이 만든 락파일에는 최상위 `overrides:` 키가 없어** `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`로 거부된다. 로컬에서 `pnpm install --lockfile-only`로 재생성해 사람 브랜치 하나로 합친다.

## 실측 규칙

**수행도 검토도 실제 측정값으로만 판단한다.** 방법(무엇을 언제 어떻게 재는가)은
[작업 방법론](docs/development/methodology.md)이 정본이다. 여기에는 **이 저장소에서만 참인 것**만 남긴다.

1. **바이트는 blob 으로 잰다.** `git cat-file -s $(git rev-parse HEAD:<path>)` — `core.autocrlf=true` 라
   `wc -c` 는 줄 수만큼 부풀려진 값을 준다.
2. **문서가 코드 사실을 복사하면 반드시 어긋난다.** 복사 대신 정본을 가리킨다 — 파일 트리·env 키
   목록·타입 정의·CI 잡 개수가 대표적이다.
3. **PR 초록은 master 초록이 아니다.** 머지 후 master 런을 확인한다 — 저빈도 flake 는 PR 에서
   통과하고 master 에서 터진다.
## AI 협업 규약

역할이 겹치면 둘 다 안 쓰게 되므로 경계를 고정한다.

**역할 표와 위임 경계, 위임 크기, 결과를 받는 법**은
[작업 방법론](docs/development/methodology.md#claude--grok-분담)이 정본이다 — 여기 복제하지 않는다.

위험 신호는 `.claude/hooks/grok-risk-signal.mjs` 가 알리고 정산은 [`/pr-ready`](.claude/commands/pr-ready.md)에서 한다.
## 인프라

- **`/health` 는 liveness, `/health/ready` 는 readiness다. compose healthcheck 27줄이 전부 후자를 친다.** `/health` 는 정적 200이라 의존이 다 죽어도 healthy 를 보고하는데, Launcher 가 그 신호로 `running` 을 판정하고 마법사가 완료를 판정한다 — 기능적으로 죽은 스택이 "완료"로 통과했다. readiness 는 Redis·소비 루프·DB 를 실제로 친다
- **readiness 의 핵심은 Redis ping 이 아니라 소비 루프 상태다.** 기동 시점에 Redis 가 죽어 있으면 `xgroup CREATE` 가 소비 루프 **밖**에서 throw 해 게이트웨이가 영구 정지하는데, ioredis 는 계속 재연결하므로 나중에 `ping()` 은 PONG 을 준다. 살아 있지만 귀머거리인 이 상태는 `isRunning()` 프로브만 잡는다
- **중복 판정은 jscpd 와 SonarCloud 가 서로 다르다.** Sonar CPD 는 **문자열 리터럴을 정규화**해서 비교하므로 서비스명만 다른 사본을 동일한 것으로 센다. jscpd 0 clones 가 Sonar 통과를 보장하지 않는다 — 서비스명으로만 갈리는 파일이 여럿 생기면 그 자리는 공유 함수로 합친다
- **`not_configured` 는 장애가 아니다.** prod compose 는 Manager 에 `DATABASE_URL` 을 주지 않는다 — 미구성을 실패로 세면 실제 배포 구성이 영구 unhealthy 가 된다
- **prod compose 는 두 벌이고 사용자에게 나가는 것은 Launcher 사본이다.** 루트와 `xzawedLauncher/packages/app/resources/` 에 250여 줄이 중복돼 있는데 `docker-manager.ts` 는 `process.resourcesPath` 로 후자를 연다 — **루트만 고치면 배포 스택은 안 고쳐진다.** 의도된 차이는 `CLAUDE_MODE` 기본값 한 줄뿐이고 동일성은 `scripts/check-compose-parity.js` 가 강제한다
- **compose 에서 미설정과 빈 문자열은 다르다.** `secrets.*.environment` 는 **미설정만** 거부한다 — 빈 문자열이면 그냥 뜨고 secret 파일이 안 생겨 소비 서비스가 기동 실패·재시작 루프에 빠진다. 둘 다 막으려면 `${VAR:?}` 보간이 함께 있어야 한다(값이 컨테이너 env 로 새지 않도록 서비스에 붙지 않는 최상위 `x-` 필드에 둔다)

- **Docker**: `docker-compose.yml` — postgres + redis + 9개 앱 서비스(총 11개). 전 서비스 `context: .` + `dockerfile: <서비스>/Dockerfile`. 에이전트 7개에 `WORKSPACE_ROOT=/workspace`, orchestrator에 `MANAGER_URL` 주입. Shared·Launcher는 compose 서비스가 아니다
- **CPD는 경로를 주지 않으면 0개 파일을 스캔한다**(로컬). 서비스별로 좁혀 돌리면 **교차 서비스 클론이 구조적으로 안 보인다** — 저장소 전체를 한 번에 넘겨야 CI와 같은 결과가 나온다. 서비스끼리 import할 수 없어 복제가 유일한 선택인 블록은 `jscpd:ignore-start` + `replicated-block: <id>` 마커로 표시하고, 동일성은 `scripts/check-replicated-blocks.js`가 강제한다
- **compose 스택을 실제로 띄우는 검사는 `compose-smoke` 잡 하나뿐이다(S4.3).** 다른 잡은 Actions `services:` 로 pg·redis 만 붙이고 앱은 in-process 로 돈다 — Dockerfile·compose 배선·서비스 간 실 네트워크 경로는 여기서만 검증된다. **부팅·readiness 는 항상 돌고**(config 의 API 키 검사가 `min(1)` 이라 자리표시자로 기동된다), **챗 1왕복은 `ANTHROPIC_API_KEY` 시크릿이 있을 때만** 돈다. 없으면 요약이 `roundtrip=skipped` 를 말한다 — skip 을 통과로 세지 않는다. `docker-compose.smoke.yml` 오버레이가 머신의 `.env` 차이를 지운다(로컬은 보통 인증 on, `.env.example` 은 off 라 같은 스크립트가 서로 다른 것을 검증했다)
- **CI**: `.github/workflows/ci.yml`이 잡 목록의 정본이다 — 여기 숫자를 복사하지 않는다(복사본은 반드시 어긋난다). `all-checks-pass`의 `needs`가 **필수 잡** 집합이고, PR 전용 잡은 push에서 `skipped`가 정상이라 허용된다
- **Dependabot**: `.github/dependabot.yml` — npm 13개 디렉토리 + github-actions 1개

## 문서

- 전체 인덱스 → [docs/README.md](docs/README.md)
- **작업 방법론(기획·개발·테스트·실측·검토, Claude·Grok 분담) → [docs/development/methodology.md](docs/development/methodology.md)**
- 기본 실행 vs 플래그 게이트 → [docs/LIVE_VS_FLAGGED.md](docs/LIVE_VS_FLAGGED.md)
- 테스트 패턴·E2E → [docs/development/testing-patterns.md](docs/development/testing-patterns.md)
- 보안 패턴 → [docs/development/security-patterns.md](docs/development/security-patterns.md) · 코드 주석의 `M8`·`N6` 라벨 정본 → [invariants.md](docs/development/invariants.md)(전부 강제되는 것은 아니다 — 표의 "강제 지점" 열을 본다)
- SonarCloud → [docs/development/sonarcloud.md](docs/development/sonarcloud.md)
