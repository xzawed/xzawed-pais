# 실행

플랫폼을 로컬·Docker·원격에서 띄우는 방법. 여기 적힌 명령은 전부 실행해서 확인한 것이다.

## 먼저 알아야 할 세 가지

이 세 줄을 모르면 어떤 가이드를 따라도 실패한다.

- **저장소 루트에 `package.json`이 없다.** 11개 독립 pnpm 프로젝트이고 루트에서 `pnpm install`을 할 대상이 없다.
- **루트에 `.env.example`이 없다.** 그런데 `docker compose`는 루트 `.env`의 `POSTGRES_PASSWORD`를 요구한다.
- **`.env` 파일은 `docker compose`만 읽는다.** 저장소 어디도 `dotenv`를 쓰지 않고, `--env-file=.env`가 붙은 것은 에이전트 7종의 `dev` 스크립트뿐이다. **Orchestrator·Manager를 `pnpm dev`로 띄울 때 그 서비스의 `.env`는 아무 효과가 없다** — 환경변수를 셸에 직접 실어야 한다.

## 경로 A — Docker 전체 스택

가장 짧은 성공 경로. Redis·Postgres 포함 11개 컨테이너가 뜬다.

```bash
# 1. 9개 서비스 .env 생성 — 없으면 첫 서비스에서 즉시 죽는다
for s in Orchestrator Manager Planner Developer Designer Tester Builder Watcher Security; do
  cp xzawed$s/.env.example xzawed$s/.env
done

# 2. 각 .env에 ANTHROPIC_API_KEY 채우기 (Watcher는 불필요 — 빈 파일이어도 되지만 존재해야 한다)

# 3. 루트 .env — compose가 보간에 실패해 config조차 안 된다
echo 'POSTGRES_PASSWORD=<원하는값>' > .env

docker compose up -d
```

`compose`의 `environment:`가 `env_file:`을 이긴다. `REDIS_URL`·`PORT`·`WORKSPACE_ROOT`·`MANAGER_URL`·`DATABASE_URL`은 compose가 이미 주입하므로, 각 `.env`가 실제로 공급하는 것은 **`ANTHROPIC_API_KEY`와 원하는 플래그**뿐이다.

| 컨테이너 | 포트 | 비고 |
|---|---|---|
| `postgres` · `redis` | 5432 · 6379 | 볼륨 `postgres-data`·`redis-data` |
| `orchestrator` | 3000 | `manager`의 healthy를 기다린다 |
| `manager` | 3001 | |
| `planner`·`developer`·`designer`·`tester`·`builder`·`watcher`·`security` | 3002–3008 | 볼륨 `workspace` 공유 |

**Manager가 죽으면 Orchestrator는 영원히 안 뜬다** — `depends_on: condition: service_healthy`다. Manager 실패의 1순위 원인은 `ANTHROPIC_API_KEY` 부재다.

**Docker에는 브라우저 UI가 없다.** Orchestrator Dockerfile은 `packages/web/dist`를 복사하지 않으므로 `SERVE_WEB=true`도 소용없다. UI는 Electron 앱(경로 B)뿐이다.

이미지를 개별로 빌드할 때는 **반드시 저장소 루트에서** 한다. 모든 `COPY`가 루트 기준이다.

```bash
docker build -f xzawedOrchestrator/Dockerfile -t xzawed-orchestrator .   # 성공
cd xzawedOrchestrator && docker build .                                   # 실패
```

## 경로 B — 인프라만 Docker, 서비스는 소스

개발할 때 쓰는 경로.

```bash
docker compose up -d redis postgres        # 루트 .env의 POSTGRES_PASSWORD 필요

cd xzawedShared && pnpm install && pnpm build && cd ..   # 나머지의 선행조건
bash scripts/sync-shared.sh                # 에이전트 7종 node_modules 복사본 갱신
```

`xzawedShared`는 에이전트 7종과 **Manager**의 의존성이다. Orchestrator는 자기 `packages/shared`를 쓰므로 무관하다. `sync-shared.sh`가 순회하는 것은 에이전트 7종뿐이다(Manager 제외).

```bash
# Manager — env를 셸에 직접 싣는다
cd xzawedManager/packages/server
ANTHROPIC_API_KEY=sk-... REDIS_URL=redis://localhost:6379 \
DATABASE_URL=postgres://xzawed:<pw>@localhost:5432/xzawed_orchestrator \
pnpm dev

# Orchestrator — 다른 터미널
cd xzawedOrchestrator/packages/server
ANTHROPIC_API_KEY=sk-... REDIS_URL=redis://localhost:6379 \
MANAGER_URL=http://localhost:3001 pnpm dev
```

DB 마이그레이션은 기동 시 자동 실행된다. Orchestrator와 Manager는 **같은 DB를 공유**한다(테이블명 충돌 없음).

## 첫 요청

```bash
curl localhost:3000/health
# {"status":"ok","timestamp":...}

curl -X POST localhost:3000/sessions -H 'Content-Type: application/json' -d '{"userId":"u1"}'
# 201 {"sessionId":"..."}

curl -X POST localhost:3000/sessions/<id>/messages -H 'Content-Type: application/json' -d '{"content":"hello"}'
# 202 {"messageId":"...","status":"accepted"}
```

**`POST messages`는 202만 준다. 답변은 REST로 오지 않는다.** 응답은 WebSocket `ws://localhost:3000/ws/sessions/{id}`로 `connected` → `chunk` × N → `done` 순으로 흐른다. curl만 쓰면 `GET /sessions/:id/messages`에 사용자 메시지 1건만 남고 어시스턴트 응답은 영영 안 온다.

- WS 경로는 **UUID v4만** 받는다. REST 쪽 정규식이 더 느슨해서, REST로 만들어진 세션 id가 WS에서 거부될 수 있다.
- 세션당 동시 처리 1건 — 처리 중 재요청은 409.
- 쓰기 rate limit(IP 키잉): `POST /sessions` 10/분 · `POST messages` 30/분 · `POST ui-actions` 60/분. GET은 무제한이고 나머지 쓰기 라우트에도 걸려 있지 않다.

## Electron 데스크톱 UI

```bash
cd xzawedOrchestrator && pnpm build      # 선행 필수
cd packages/app && pnpm dev
```

설정 `mode`가 기본값 `'local'`이면 Electron이 `packages/server/dist/index.js`를 자식 프로세스로 spawn한다. 그래서 **`pnpm build`가 선행돼야 하고**, spawn된 서버는 부모의 `process.env`를 상속할 뿐 `.env`를 읽지 않으므로 **Electron을 띄우는 셸에 `ANTHROPIC_API_KEY`가 export돼 있어야 한다.**

기본 `gateMode`는 `'manual'`이다 — 모든 게이트 단계에서 사람 승인 카드가 뜬다.

**입력창의 모드 토글은 기본이 Chat이다.** Chat은 대화형 질의응답이고, 자율 태스크그래프로 가는 것은 Build뿐이다. 다만 **Build를 눌러도 `ORCHESTRATOR_DECOMPOSE_ENABLED`가 꺼져 있으면 조용히 일반 chat으로 떨어진다** — `shouldDecompose(mode, decomposeEnabled)`가 `mode === 'build' && decomposeEnabled`이고 후자의 기본값이 `false`다. "Build를 눌렀는데 일반 답변만 온다"의 원인이 이것이고, 켜는 방법은 아래 자율 스택이다.

## 설정 계약

각 서비스 `src/config.ts`의 Zod 스키마가 진실원천이다. 여기엔 **기동을 거부하는 조건**만 적는다.

| 서비스 | 조건 | 결과 |
|---|---|---|
| Orchestrator | `CLAUDE_MODE=api`(기본) | `ANTHROPIC_API_KEY` 필수 |
| Orchestrator | `CLAUDE_MODE=remote` | `REMOTE_CLI_URL` 또는 `REMOTE_HOST` 중 하나 |
| Orchestrator | `CLAUDE_MODE=remote` + `REMOTE_CLI_URL` 없음(SSH 갈래) | `REMOTE_HOST`·`REMOTE_USER`·`REMOTE_KEY_PATH` **3개 전부** |
| Orchestrator | `AUTH=jwt` | `SERVICE_JWT_SECRET`·`USER_JWT_SECRET` **둘 다** 32자 이상 |
| Manager | 항상 | `ANTHROPIC_API_KEY` 필수 — `CLAUDE_MODE` 탈출구가 없다 |
| Manager | `MODE=remote` | `SERVICE_JWT_SECRET` 필수 |
| Manager | `PAIS_PROFILE=autonomous` | `SERVICE_JWT_SECRET`(32자) + `DATABASE_URL` |
| 에이전트 7종 | 항상 | `WORKSPACE_ROOT` 필수. 없으면 `ZodError: path:["workspaceRoot"] Required` |

`WORKSPACE_ROOT`가 파일시스템 루트(`/`·`C:\`)인지는 Orchestrator에서 **기동 시 검사되지 않는다** — 세션을 만들 때 비로소 실패한다.

## 원격 배포

`MODE`의 실제 효과는 아래가 전부이고, 두 서비스가 서로 반대로 동작한다.

| 대상 | `MODE=remote`의 효과 |
|---|---|
| Orchestrator | Fastify 로거 **켜짐** |
| Orchestrator | CORS가 `ALLOWED_ORIGINS` **allowlist 전용** — 로컬호스트 예외가 사라진다 |
| Orchestrator | `AUTH=jwt`·`ALLOWED_ORIGINS` 둘 다 없으면 **기동 거부** |
| Manager | `SERVICE_JWT_SECRET` 없으면 기동 거부 |
| Manager | 로거·`trustProxy` 에 아무 영향이 없다 — 둘 다 `MODE` 와 무관한 축이다 |
| 에이전트 7종 | 아무것도 하지 않는다 — 파싱만 한다 |

`MODE=local`의 CORS는 **전면 허용이 아니다.** Origin 헤더 부재(Electron 프로덕션의 `file://`·서버 간 호출),
문자열 `null` Origin, 로컬호스트(포트 무관), 그리고 `ALLOWED_ORIGINS`에 적은 값만 통과한다. 임의의 웹사이트가
사용자 브라우저를 통해 로컬 오케스트레이터를 호출하던 경로는 닫혔다.

**`TRUST_PROXY=true`는 리버스 프록시 뒤에서만 켠다.** 켜면 Fastify가 `X-Forwarded-For`를 클라이언트 IP로
채택하는데, 프록시가 없으면 그 헤더는 클라이언트가 임의로 쓰는 값이라 IP 키 rate limit이 무력화된다.
반대로 프록시 뒤에서 끄면 전 사용자가 버킷 하나를 공유해 한 명의 로그인 실패가 전원을 잠근다.
인증 없이 열려 있는 엔드포인트는 `/health` 하나가 아니다 — `/auth/register`·`/auth/login`·`/auth/refresh`와 `GET /projects/:id/decisions/pending`도 열려 있다.

`docker-compose.prod.yml`(GHCR 사전빌드 이미지)은 Launcher가 쓰는 파일이고, 저장소 루트와 `xzawedLauncher/packages/app/resources/`에 **사본 두 벌**이 있다(패키징 대상은 후자다). 둘은 orchestrator의 `CLAUDE_MODE` 기본값만 다르므로, 한쪽만 고치면 Launcher는 그대로 깨진 채 남는다.

그 스택의 태세 기준선은 '인증을 걸었는가'가 아니라 **'이 기계 밖에서 닿는가'**다 — 사용자 PC에서 도는
로컬 스택이기 때문이다. 호스트 포트를 여는 앱 서비스는 orchestrator 하나뿐이고 **루프백에만** 묶인다
(`127.0.0.1:3000:3000`). 나머지 8개는 compose 네트워크 안에서 서비스명으로만 통신한다.

**`ANTHROPIC_API_KEY`는 필수다.** 미설정이든 빈 문자열이든 `docker compose`가 즉시 거부한다.
키를 요구하는 서비스는 **8개**다 — 에이전트 6종과 Manager는 무조건(`z.string().min(1)`), orchestrator는
`CLAUDE_MODE=api`일 때다(루트 사본의 기본값이 `api`, Launcher 사본은 `cli`).

**미설정과 빈 문자열은 compose 안에서 다른 장치가 막는다.** `secrets.*.environment`는 **미설정만**
거부한다(`environment variable "ANTHROPIC_API_KEY" required by secret ... is not set`). 빈 문자열이면
compose는 그냥 뜨고 `/run/secrets/anthropic_api_key`가 **아예 생기지 않아**, 각 서비스가
`ANTHROPIC_API_KEY_FILE`을 읽다 throw하고 `restart: unless-stopped`가 되살려 크래시 루프가 된다.
그것을 막는 것이 파일 상단의 `x-require-anthropic-api-key: ${ANTHROPIC_API_KEY:?...}`다 — 둘은 한 쌍이다.

키는 env 가 아니라 `/run/secrets/anthropic_api_key` 로 마운트되며 각 서비스는 `ANTHROPIC_API_KEY_FILE`
로 읽는다 — env 로 넣으면 `docker inspect`의 `Config.Env`에 평문으로 남는다.
확인 방법은 `ANTHROPIC_API_KEY=<값> docker compose -f docker-compose.prod.yml config`이며, 렌더된
출력에서 값이 나타나는 곳은 서비스에 붙지 않는 `x-require-anthropic-api-key` 한 줄뿐이다.

> **prod compose 는 두 벌이다.** 루트와 `xzawedLauncher/packages/app/resources/`. Launcher가 실제로
> 띄우는 것은 **후자**이므로(`process.resourcesPath`) 루트만 고치면 배포 스택은 그대로다. 두 사본의
> 동일성은 `node scripts/check-compose-parity.js`가 강제하고, 의도된 차이는 그 스크립트의 `ALLOWED`에
> 선언한다(현재 1건 — `CLAUDE_MODE` 기본값).
`POSTGRES_PASSWORD`는 Launcher가 최초 실행 시 생성해 `userData/db-password`에 보관하고 compose에 주입한다. **직접 `docker compose -f docker-compose.prod.yml`을 돌릴 때는 그 값을 손수 줘야 한다** — 파일이 `${POSTGRES_PASSWORD:?}`로 요구하고, 일부 서비스만 지정해도 보간은 파일 전체에 걸린다.

## 자율 스택

```bash
PAIS_PROFILE=autonomous   # + Manager에 SERVICE_JWT_SECRET(32자) · DATABASE_URL
```

Manager가 켜는 것은 `TASK_MANAGER_ENABLED`·`MANAGER_DECOMPOSE_ENABLED`·`MANAGER_TASK_WORKER`·`MANAGER_WP_VERIFY`와 예산 상한(워크플로 $5·일 $50)·lease 가시성 600초다. Orchestrator가 켜는 것은 `ORCHESTRATOR_DECOMPOSE_ENABLED` **하나뿐**이다. 개별 env를 미리 설정해 두면 그쪽이 프로필을 이긴다.

고급 검증 채널(conformance·impact·property·mutation·security)과 decision·oracle·risk 체인은 **의도적으로 안 켠다** — 사람이 시드한 오라클·golden·리스크 승인이 있어야 의미가 있기 때문이다.

미지 프로필은 명확히 거부한다: `Unknown PAIS_PROFILE: 'x'. Known profiles: autonomous`.

무엇이 기본 실행되고 무엇이 플래그 뒤에 있는지는 [LIVE_VS_FLAGGED.md](../LIVE_VS_FLAGGED.md)가 단일 진실원천이다. 여기 복제하지 않는다.

compose에는 `PAIS_PROFILE`을 넣는 자리가 없다 — Docker에서 켜려면 각 서비스 `.env`에 넣어야 한다.

## 함정

- **Manager는 `pnpm build && pnpm start`로 DB를 켜면 깨진다.** `db/pool.ts`가 마이그레이션 디렉토리를 컴파일된 자기 모듈 위치 기준으로 잡는데, `tsc`는 `.sql`을 복사하지 않고 Manager에는 Orchestrator와 달리 `postbuild` 복사 스크립트가 없다. 실측: `src/db/migrations` 17개 · `dist/db/migrations` **0개** → `ENOENT: ... scandir 'dist/db/migrations'`로 기동 실패. `pnpm dev`(tsx)와 Docker는 정상이다 — Dockerfile이 따로 복사한다.
- **에이전트 `.env.example`의 `WORKSPACE_ROOT` 기본값이 Windows 절대경로다**(Developer·Tester·Watcher·Security). Linux·macOS에서 그대로 쓰면 잘못된 경로를 가리킨다. Docker에서는 compose가 덮어써서 드러나지 않는다.
- **Redis가 없으면 인메모리로 폴백하지 않는다.** `REDIS_URL`은 기본값이 있어 "미설정" 상태 자체가 없고, 폴백 코드도 없다. Redis 없이 띄우면 `ECONNREFUSED`가 무한 반복되고 세션 게이트웨이 발행이 조용히 실패한다. 인메모리 폴백은 **세션 스토어**(`DATABASE_URL` 부재 시) 얘기다.
- **MCP 서버는 별개 데모다.** `packages/server` MCP 진입점은 자체 인메모리 세션 스토어를 쓰며 REST·WS 플랫폼과 상태를 공유하지 않는다.
- **승인 결정이 조용히 사라질 수 있다.** `POST /sessions/:id/ui-actions`의 Redis 발행 실패는 202로 삼켜진다.
