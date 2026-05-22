[홈](../README.md) > [시작하기](./) > 설치

# 설치

xzawedPAIS를 로컬 환경에서 실행하기 위한 환경 구성과 설치 절차를 설명한다.

---

## 사전 요구 사항

### 필수

| 도구 | 최소 버전 | 설치 |
|------|-----------|------|
| Node.js | 22.0.0 | [nodejs.org](https://nodejs.org/) 또는 `nvm install 22` |
| pnpm | 10.0.0 | `npm install -g pnpm` |
| Git | — | [git-scm.com](https://git-scm.com/) |
| Redis | 7.0 | 아래 설치 방법 참고 |

> Redis는 서비스 간 메시지 전달에 필수다. Redis 없이는 에이전트 간 통신이 불가능하다.

### 선택

| 도구 | 용도 |
|------|------|
| Claude CLI (`@anthropic-ai/claude-code`) | `CLAUDE_MODE=cli` 사용 시 필요 |
| Docker + Docker Compose | 전체 스택을 컨테이너로 실행할 때 필요 |

---

## 1단계: Node.js 버전 확인

```bash
node --version
# v22.0.0 이상이어야 한다

pnpm --version
# 10.0.0 이상이어야 한다
```

`pnpm`이 설치되어 있지 않으면 다음을 실행한다.

```bash
npm install -g pnpm
```

---

## 2단계: Redis 설치

### macOS (Homebrew)

```bash
brew install redis
brew services start redis
```

### Ubuntu / Debian

```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

### Windows (WSL2 권장)

```bash
# WSL2 터미널에서
sudo apt-get install redis-server
sudo service redis-server start
```

### Redis 연결 확인

```bash
redis-cli ping
# PONG
```

`PONG`이 출력되면 Redis가 정상 동작 중이다.

---

## 3단계: 저장소 클론

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais
```

---

## 4단계: 의존성 설치

### xzawedShared 먼저 빌드

독립 에이전트 서비스(Planner, Developer, Designer, Tester, Builder, Watcher, Security)는 공유 라이브러리 `@xzawed/agent-streams`에 의존한다. 해당 서비스를 실행하기 전에 반드시 먼저 빌드한다.

```bash
cd xzawedShared && pnpm install && pnpm build && cd ..
```

### Orchestrator / Manager (Turborepo)

```bash
cd xzawedOrchestrator
pnpm install
pnpm build
```

```bash
cd xzawedManager
pnpm install
pnpm build
```

### 나머지 에이전트 서비스

Planner, Developer, Designer, Tester, Builder, Watcher, Security 각 디렉토리에서 동일하게 실행한다.

```bash
cd xzawedPlanner   # 또는 xzawedDeveloper, xzawedDesigner 등
pnpm install
pnpm build
```

---

## 5단계: 환경 변수 설정

각 서비스 디렉토리에 `.env.example`이 있다. `.env`로 복사한 뒤 필요한 값을 입력한다.

```bash
# 예: Orchestrator
cp xzawedOrchestrator/.env.example xzawedOrchestrator/.env
```

`xzawedOrchestrator/.env` 최소 구성:

```env
# Claude 실행 모드: api | cli | remote (기본값: api)
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6

# Redis
REDIS_URL=redis://localhost:6379

# Manager 서비스 URL
MANAGER_URL=http://localhost:3001

# 서버
PORT=3000
MODE=local
AUTH=none
```

`xzawedManager/.env` 최소 구성:

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3001
MODE=local
```

나머지 에이전트 서비스도 각각의 `.env.example`을 복사하여 `ANTHROPIC_API_KEY`와 `REDIS_URL`을 설정한다. xzawedWatcher는 Claude API를 사용하지 않으므로 `ANTHROPIC_API_KEY`가 필요 없다.

> 설정 옵션 전체 목록은 [환경 변수 레퍼런스](../reference/environment-variables.md)와 [설정 가이드](../guides/configuration.md)를 참고한다.

---

## 6단계: 서버 실행 확인

### Orchestrator

```bash
cd xzawedOrchestrator/packages/server
pnpm dev
```

```
xzawedOrchestrator server running on port 3000
CLAUDE_MODE=api | MODE=local
```

별도 터미널에서 헬스체크를 실행한다.

```bash
curl http://localhost:3000/health
```

```json
{"status":"ok","timestamp":1748000000000}
```

---

## 문제 해결

### `pnpm install` 실패

```bash
rm -rf node_modules **/node_modules
pnpm install
```

### TypeScript 빌드 오류: `Cannot find module '@xzawed/agent-streams'`

xzawedShared를 아직 빌드하지 않았다. [4단계: 의존성 설치](#4단계-의존성-설치)의 xzawedShared 빌드를 먼저 실행한다.

```bash
cd xzawedShared && pnpm install && pnpm build
```

### Redis 연결 오류

`redis-cli ping`으로 Redis 동작 여부를 확인한다. Redis가 실행 중이 아니면 [2단계: Redis 설치](#2단계-redis-설치)를 다시 확인한다.

### Node.js 버전 오류: `The engine "node" is incompatible`

`node --version`이 `v22.0.0` 미만이면 Node.js를 업그레이드해야 한다. `nvm`을 사용하면 다음과 같이 전환한다.

```bash
nvm install 22
nvm use 22
```

---

## 다음 단계

- [퀵스타트](quickstart.md) — 서버를 시작하고 첫 메시지를 전송한다
- [설정 가이드](../guides/configuration.md) — 모든 환경 변수와 시나리오별 설정 예제
- [로컬 배포](../guides/local-deployment.md) — 개인 PC 환경 최적화
