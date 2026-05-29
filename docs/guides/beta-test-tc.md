# xzawedPAIS 베타 테스트 TC (Test Cases)

> **목적**: 실제 Electron GUI 환경에서 컨텍스트 기반 산출물(파일) 생성까지 전 파이프라인이 정상 동작하는지 단계별로 검증한다.  
> **원칙**: 이전 단계가 통과되지 않으면 다음 단계로 진행하지 않는다.

---

## 사전 환경 구성

### 필수 조건

| 항목 | 값 | 확인 방법 |
|---|---|---|
| Node.js | ≥ 20 | `node --version` |
| pnpm | ≥ 9 | `pnpm --version` |
| Docker Desktop | 실행 중 | Docker Desktop 트레이 아이콘 |
| `ANTHROPIC_API_KEY` | 시스템 환경변수에 설정 | `echo $ANTHROPIC_API_KEY` (bash) / `$env:ANTHROPIC_API_KEY` (PowerShell) |

### 환경변수 설정 (1회)

```powershell
# PowerShell — 현재 터미널 세션에 적용
$env:ANTHROPIC_API_KEY = "sk-ant-api03-..."
$env:CLAUDE_MODE = "api"
$env:WORKSPACE_ROOT = "/workspace"
$env:MANAGER_URL = "http://localhost:3001"
$env:REDIS_URL = "redis://localhost:6379"
```

> **주의**: `.env` 파일은 `node --env-file=.env` 실행 시에만 로드된다.  
> Electron이 서버를 자동 실행할 때는 시스템 환경변수만 참조하므로  
> 반드시 위 환경변수가 설정된 터미널에서 Electron을 실행해야 한다.

---

## Stage 0: 서비스 전제조건 확인

**목적**: Docker 에이전트 서비스 9개 + Redis가 모두 정상 기동되어 있는지 확인한다.

### TC-0-1: Docker 서비스 헬스 체크

```bash
# 모든 서비스 헬스 상태 확인
curl http://localhost:3001/health   # Manager
curl http://localhost:3002/health   # Planner
curl http://localhost:3003/health   # Developer
curl http://localhost:3004/health   # Designer
curl http://localhost:3005/health   # Tester
curl http://localhost:3006/health   # Builder
curl http://localhost:3007/health   # Watcher
curl http://localhost:3008/health   # Security
```

**기대 결과**: 각 응답이 `{"status":"ok"...}` 형태  
**실패 시**: `docker compose up -d` 실행 후 재확인

### TC-0-2: Redis 연결 확인

```bash
docker exec xzawed-pais-redis-1 redis-cli ping
```

**기대 결과**: `PONG`

### TC-0-3: Orchestrator 서버 빌드 상태 확인

```bash
ls f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedPAIS\xzawedOrchestrator\packages\server\dist\index.js
```

**기대 결과**: 파일 존재  
**실패 시**: `cd xzawedOrchestrator/packages/server && pnpm build`

---

## Stage 1: Electron 앱 실행 및 초기 화면 진입

**목적**: AUTH=none 모드에서 Electron이 로그인 화면을 거치지 않고 바로 Chat 화면으로 진입하는지 확인한다.

### TC-1-1: Electron Dev 모드 실행

```powershell
# 환경변수가 설정된 터미널에서 실행
cd f:\DEVELOPMENT\SOURCE\CLAUDE\xzawedPAIS\xzawedOrchestrator
pnpm install        # 처음 실행 시
cd packages/app && pnpm dev
```

**기대 결과**:
- Electron 창이 열린다
- 창 타이틀이 `xzawedOrchestrator` 또는 `Electron`
- 개발자 도구에서 `http://localhost:5173` renderer 로드 확인

### TC-1-2: 초기 화면 진입 경로 확인

**검증 방법**: Electron 창에서 Ctrl+Shift+I → Console 탭 확인

**기대 결과**:
- 로그인/회원가입 화면이 나타나지 않음
- Chat 레이아웃(사이드바 + 빈 채팅 영역)이 표시됨
- Console에 `[App] restore error:` 또는 `404` 에러가 나타나도 정상 (AUTH=none 의도된 동작)
- Console에 `[AUTH=none] navigating to /chat` 류의 로그 또는 화면이 `/chat` 경로로 이동

**실패 케이스 - 로그인 화면이 보이는 경우**:
- Console에서 `/auth/me` 응답 상태코드 확인
- 404가 아닌 경우: Orchestrator 서버의 `AUTH` 환경변수가 `none`인지 확인
- 서버가 응답하지 않는 경우: Stage 0 재확인

### TC-1-3: 상태바 서버 상태 확인

**검증 방법**: Electron 창 하단 StatusBar

**기대 결과**:
- 서버 상태가 `running` (녹색 점 또는 "서버 실행 중" 텍스트)
- `stopped` 상태인 경우: Orchestrator 서버가 port 3000에서 응답하는지 확인

---

## Stage 2: 세션 생성 및 WebSocket 연결

**목적**: 사이드바의 세션 생성 버튼이 동작하고 WebSocket이 연결되는지 확인한다.

### TC-2-1: 새 세션 생성

**검증 방법**: Electron 창의 Sidebar에서 `＋ 새 세션` 버튼 클릭

**기대 결과**:
- 버튼 클릭 후 로딩 상태 표시 (버튼 비활성화 + 로딩 텍스트)
- 세션 목록에 새 세션 항목 나타남
- 채팅 영역에 빈 메시지 입력창이 표시됨 (이전의 "세션이 없습니다" 메시지 사라짐)

**실패 케이스**:
- "세션이 없습니다" 메시지가 유지되는 경우:
  ```bash
  curl -s -X POST http://localhost:3000/sessions \
    -H "Content-Type: application/json" \
    -d '{"userId":"test"}'
  ```
  수동으로 API 호출하여 응답 확인. `{"sessionId":"..."}` 가 반환되면 UI 버그.

### TC-2-2: WebSocket 연결 확인

**검증 방법**: Electron 개발자 도구 → Network 탭 → WS 필터

**기대 결과**:
- `ws://localhost:3000/ws/sessions/{sessionId}` 연결이 `101 Switching Protocols` 로 수립
- Status: `connected` (WS frame 수신 확인)

**서버 측 확인**:
```bash
# Orchestrator 서버 로그에서 WS 연결 확인
# server 프로세스 터미널 출력에서 WebSocket upgrade 로그 확인
```

---

## Stage 3: Orchestrator 직접 응답 스트리밍

**목적**: 사용자 메시지가 전송되면 Orchestrator Claude가 직접 스트리밍 응답을 내보내는지 확인한다.  
(아직 Manager 파이프라인 동작 전 단계)

### TC-3-1: 간단한 질의 메시지 전송

**검증 방법**: 메시지 입력창에 아래 텍스트 입력 후 Enter

```
안녕하세요. 현재 서비스 상태를 알려주세요.
```

**기대 결과**:
1. 메시지 전송 직후: 입력창 비활성화 + 점 세 개 로딩 애니메이션 표시 (`streaming-indicator`)
2. ~1-3초 내: Claude 응답 텍스트가 실시간 스트리밍으로 나타남 (글자 단위)
3. 응답 완료 후: `agent_status` 로그라인이 PipelineStrip에 나타남
4. `agent_done` 수신 후: 최종 응답 메시지 카드 표시

**실패 케이스 - 응답이 없는 경우**:
- Console 오류 확인: `ANTHROPIC_API_KEY` 관련 에러면 환경변수 미설정
- `[WS] Error:` 로그면 WebSocket 연결 끊김 (TC-2-2 재확인)

### TC-3-2: 스트리밍 중단 복구 확인

**검증 방법**: 메시지 전송 중 다시 입력 시도

**기대 결과**:
- 스트리밍 중에는 메시지 입력창이 비활성화됨 (`disabled` 상태)
- 스트리밍 완료 후 입력창 활성화

---

## Stage 4: Manager 파이프라인 실행 (plan → develop → complete)

**목적**: 코드 생성 요청이 Orchestrator → Manager → Planner → Developer 파이프라인을 통해 실제 파일을 생성하는지 확인한다.

> **전제**: Stage 3이 통과되어야 한다.

### TC-4-1: 실제 코드 생성 요청 전송

**검증 방법**: 메시지 입력창에 아래 내용 입력

```
/workspace/tc-test/ 경로에 간단한 Node.js 계산기 앱을 만들어주세요.
다음 파일들을 생성해주세요:
- calculator.js (add, subtract, multiply, divide 함수)
- index.js (메인 실행 파일, 계산 예제 포함)
- package.json (name: tc-calculator, main: index.js)
```

**기대 결과 — UI 변화 순서**:

| 시간 | UI 이벤트 | 설명 |
|---|---|---|
| 0s | 로딩 애니메이션 | Orchestrator Claude 처리 중 |
| 1-5s | 스트리밍 텍스트 | Orchestrator Claude 응답 (의도 분석) |
| 5-15s | `[STATUS] 작업을 Manager에게 전달합니다` | Redis 발행 완료 |
| 10-30s | `[MANAGER] 계획 수립 중...` 류 agent_status | Planner 호출 |
| 30-90s | `[MANAGER] 코드 생성 중...` 류 agent_status | Developer 호출 |
| 90-180s | agent_done 메시지 표시 | 파이프라인 완료 |

**실패 케이스 - Manager 연결 오류**:
```bash
# Manager가 Redis 메시지를 받는지 확인
docker logs xzawed-pais-manager-1 --tail 30
```
`SessionConsumer started for session {id}` 로그가 없으면:
→ Orchestrator 서버의 `MANAGER_URL` 환경변수 또는 Redis 연결 문제

**실패 케이스 - Planner/Developer timeout**:
- 120초 초과 시 Manager가 timeout 에러를 반환
- Docker 컨테이너 재시작 필요: `docker compose restart developer planner`

### TC-4-2: 파이프라인 로그 확인

**검증 방법**: Electron 창의 PipelineStrip (채팅 영역 상단의 단계별 표시줄) 또는 RightPanel 로그

**기대 결과**:
- plan_task → develop_code 단계 표시
- 각 에이전트 상태 메시지 순서대로 표시

---

## Stage 5: 실제 파일 생성 검증

**목적**: 파이프라인이 완료된 후 Docker workspace 볼륨에 실제 파일이 생성되었는지 확인한다.

### TC-5-1: Docker workspace 볼륨 파일 확인

```bash
# Windows PowerShell에서 실행
docker run --rm -v "xzawed-pais_workspace:/vol" alpine ls -la /vol/tc-test/
```

**기대 결과**:
```
drwxr-xr-x    2 root     root          ...  tc-test/
-rw-r--r--    1 root     root          ...  calculator.js
-rw-r--r--    1 root     root          ...  index.js
-rw-r--r--    1 root     root          ...  package.json
```

**실패 시**: 파일이 없는 경우 Developer 로그 확인
```bash
docker logs xzawed-pais-developer-1 --tail 50
```

### TC-5-2: 생성 파일 내용 확인

```bash
# calculator.js 내용 확인
docker run --rm -v "xzawed-pais_workspace:/vol" alpine cat /vol/tc-test/calculator.js

# index.js 내용 확인
docker run --rm -v "xzawed-pais_workspace:/vol" alpine cat /vol/tc-test/index.js

# package.json 내용 확인
docker run --rm -v "xzawed-pais_workspace:/vol" alpine cat /vol/tc-test/package.json
```

**기대 결과**:
- `calculator.js`: `add`, `subtract`, `multiply`, `divide` 함수 포함
- `index.js`: calculator import 및 계산 예제 코드 포함
- `package.json`: `name: "tc-calculator"` 포함

### TC-5-3: 실행 가능성 확인 (선택)

```bash
docker run --rm -v "xzawed-pais_workspace:/vol" node:20-alpine \
  node /vol/tc-test/index.js
```

**기대 결과**: 계산 결과 출력 (에러 없이)

---

## TC 결과 체크리스트

| TC | 항목 | 결과 | 비고 |
|---|---|---|---|
| TC-0-1 | Docker 서비스 9개 헬스 OK | ⬜ PASS / ⬜ FAIL | |
| TC-0-2 | Redis PONG | ⬜ PASS / ⬜ FAIL | |
| TC-0-3 | Orchestrator dist 존재 | ⬜ PASS / ⬜ FAIL | |
| TC-1-1 | Electron 창 정상 실행 | ⬜ PASS / ⬜ FAIL | |
| TC-1-2 | 로그인 화면 없이 Chat 진입 | ⬜ PASS / ⬜ FAIL | |
| TC-1-3 | StatusBar 서버 running | ⬜ PASS / ⬜ FAIL | |
| TC-2-1 | 새 세션 생성 성공 | ⬜ PASS / ⬜ FAIL | |
| TC-2-2 | WebSocket 101 연결 | ⬜ PASS / ⬜ FAIL | |
| TC-3-1 | Orchestrator 스트리밍 응답 | ⬜ PASS / ⬜ FAIL | |
| TC-3-2 | 스트리밍 중 입력 비활성화 | ⬜ PASS / ⬜ FAIL | |
| TC-4-1 | Manager 파이프라인 실행 | ⬜ PASS / ⬜ FAIL | |
| TC-4-2 | PipelineStrip 단계 표시 | ⬜ PASS / ⬜ FAIL | |
| TC-5-1 | workspace에 파일 생성됨 | ⬜ PASS / ⬜ FAIL | |
| TC-5-2 | 파일 내용 요청과 일치 | ⬜ PASS / ⬜ FAIL | |
| TC-5-3 | 실행 시 에러 없음 | ⬜ PASS / ⬜ FAIL | |

---

## 현재 확인된 사전 이슈 및 수정 내역

### 수정 완료 ✅

| 이슈 | 원인 | 수정 파일 | 내용 |
|---|---|---|---|
| AUTH=none 모드에서 Manager로 workspaceRoot 미전달 | `publishTaskToManager`의 `if (session.projectId)` 조건 | `sessions.route.ts` | else 브랜치 추가 — `projectId: 'default', workspaceRoot: envFallback` |
| Electron 자체 실행 서버 CLAUDE_MODE 기본값 오류 | `ServerManager` 기본값 `'cli'` | `server-manager.ts` | `'api'`로 변경, WORKSPACE_ROOT·MANAGER_URL 추가, ELECTRON_RUN_AS_NODE=1 추가 |
| Manager가 `register_project` 루프에서 타임아웃 | workspaceRoot 없으면 Manager가 register_project 호출 | (위 수정으로 해결) | |
| Orchestrator 서버 `.env` WORKSPACE_ROOT 누락 | 초기 환경변수 미설정 | `.env` | `WORKSPACE_ROOT=/workspace` 추가 |

### 현재 상태 검증 완료 ✅

- **세션 생성**: `POST /sessions` → `{"sessionId": "..."}` 정상 반환
- **auth 감지**: `GET /auth/me` → `404` (AUTH=none 모드 정상)
- **파이프라인 E2E**: 세션 `8f06264e`로 `test-output.txt` Docker volume에 생성 확인
- **Agent 헬스**: 9개 서비스 모두 `/health` → `{"status":"ok"}` 응답

### 현재 제한사항 ⚠️

| 항목 | 현황 | 해결방법 |
|---|---|---|
| Docker workspace 파일 Windows 직접 접근 불가 | Named volume은 Windows 파일탐색기에서 미표시 | `docker run --rm -v xzawed-pais_workspace:/vol alpine ls /vol/` 사용 |
| ANTHROPIC_API_KEY 수동 환경변수 설정 필요 | Electron이 `.env` 자동 로드 안 함 | 터미널에서 `$env:ANTHROPIC_API_KEY = "..."` 후 `pnpm dev` |
| ioredis ETIMEDOUT 로그 (백그라운드) | Redis 재시작 후 stale 연결 | 서비스 재시작으로 해결: `docker compose restart` |

---

## 빠른 환경 재시작 명령어

```powershell
# Docker 서비스 재시작 (에이전트 + Redis만, DB 유지)
docker compose restart redis planner developer designer tester builder watcher security manager

# Orchestrator 서버 재빌드 후 재시작
cd xzawedOrchestrator/packages/server
pnpm build
# 기존 프로세스 종료 후:
npx kill-port 3000
node --env-file=.env dist/index.js

# Electron 재실행 (Orchestrator 서버가 실행 중인 터미널과 별도 터미널에서)
cd xzawedOrchestrator/packages/app && pnpm dev
```
