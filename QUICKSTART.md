# xzawedPAIS 빠른 시작 가이드

> 개발 경험이 없어도 따라할 수 있도록 작성된 가이드입니다.

---

## 이 서비스는 무엇인가요?

xzawedPAIS는 **"쇼핑몰 만들어줘"** 처럼 원하는 것을 말하면 AI가 자동으로 계획, 코드 작성, 테스트까지 수행해주는 플랫폼입니다.

내부적으로 9개의 AI 에이전트가 협력하며 동작하고, 모두 함께 실행되어야 정상 작동합니다.

---

## 시작하기 전에 — 필요한 것

아래 3가지를 먼저 준비해주세요.

### 1. Docker Desktop 설치 (필수)

Docker는 복잡한 설치 없이 서비스를 한 번에 실행할 수 있게 해주는 도구입니다.

1. https://www.docker.com/products/docker-desktop 접속
2. 운영체제에 맞는 버전 다운로드 (Windows / Mac)
3. 설치 후 Docker Desktop 실행
4. 화면 하단에 **초록색 고래 아이콘** 이 나타나면 준비 완료

> ✅ **확인 방법:** 터미널(명령 프롬프트)을 열고 아래를 입력해보세요.
> ```
> docker --version
> ```
> `Docker version 27.x.x` 같은 내용이 나오면 성공입니다.

---

### 2. Anthropic API 키 발급 (필수)

이 서비스는 Claude AI를 사용합니다. API 키가 없으면 AI가 동작하지 않습니다.

1. https://console.anthropic.com 접속 후 회원가입
2. 로그인 → 좌측 메뉴 **API Keys** 클릭
3. **Create Key** 버튼 클릭
4. 생성된 키 복사 (예: `sk-ant-api03-...`)

> ⚠️ **주의:** API 키는 한 번만 표시됩니다. 반드시 메모장 등에 따로 저장해두세요.

---

### 3. 이 저장소 다운로드

터미널을 열고 아래 명령을 입력합니다.

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais
```

> Git이 없다면 GitHub 페이지에서 **Code → Download ZIP** 으로 다운로드 후 압축을 풀어도 됩니다.

---

## 실행하기

### 1단계 — 환경 설정 파일 만들기

각 서비스 폴더에 `.env` 파일을 만들어야 합니다.  
아래 명령을 터미널에서 한 줄씩 실행하세요.

**Mac / Linux:**
```bash
for svc in xzawedOrchestrator xzawedManager xzawedPlanner xzawedDeveloper \
           xzawedDesigner xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  cp $svc/.env.example $svc/.env
done
```

**Windows (PowerShell):**
```powershell
foreach ($svc in @("xzawedOrchestrator","xzawedManager","xzawedPlanner","xzawedDeveloper",
                    "xzawedDesigner","xzawedTester","xzawedBuilder","xzawedWatcher","xzawedSecurity")) {
  Copy-Item "$svc/.env.example" "$svc/.env"
}
```

---

### 2단계 — API 키 입력하기

방금 만든 `.env` 파일들 각각을 메모장(또는 텍스트 편집기)으로 열고,  
아래 줄을 찾아 `sk-ant-...` 부분을 본인의 API 키로 교체하세요.

```
ANTHROPIC_API_KEY=sk-ant-여기에-실제-키를-입력하세요
```

> 💡 **팁:** 9개 파일 모두 동일한 키를 사용합니다.

---

### 3단계 — 전체 서비스 실행하기

터미널에서 저장소 폴더로 이동 후 아래 명령 하나만 입력합니다.

```bash
docker compose up --build
```

처음 실행 시 이미지를 빌드하므로 **5~10분** 정도 소요될 수 있습니다.

아래와 같은 메시지들이 보이면 정상 실행 중입니다.

```
✅ orchestrator  | Server running on port 3000
✅ manager       | Server running on port 3001
✅ planner       | Server running on port 3002
...
```

> 서비스를 종료하려면 터미널에서 `Ctrl + C` 를 누르세요.

---

## 동작 확인 (테스트)

모든 서비스가 실행된 상태에서 **새 터미널 창**을 열고 아래를 확인합니다.

### 서비스 상태 확인

브라우저에서 아래 주소를 열어보세요. `{"status":"ok"}` 가 나오면 정상입니다.

| 서비스 | 주소 |
|--------|------|
| Orchestrator | http://localhost:3000/health |
| Manager      | http://localhost:3001/health |
| Planner      | http://localhost:3002/health |
| Developer    | http://localhost:3003/health |
| Designer     | http://localhost:3004/health |
| Tester       | http://localhost:3005/health |
| Builder      | http://localhost:3006/health |
| Watcher      | http://localhost:3007/health |
| Security     | http://localhost:3008/health |

모든 주소에서 `{"status":"ok"}` 응답이 확인되면 **전체 시스템이 정상 동작 중**입니다.

---

### 자동 테스트 실행 (선택)

각 서비스의 코드가 정상인지 확인하는 자동 테스트를 실행할 수 있습니다.

먼저 **Node.js와 pnpm** 설치가 필요합니다.

- Node.js: https://nodejs.org (LTS 버전 설치)
- pnpm: Node.js 설치 후 터미널에서 `npm install -g pnpm` 입력

설치 후 테스트 실행:

```bash
# 예시: 보안 에이전트 테스트
cd xzawedSecurity
pnpm install
pnpm test
```

아래와 같이 나오면 성공입니다.

```
✓ 45 tests passed
```

> 전체 337개 테스트는 GitHub Actions CI에서 자동으로 실행됩니다.  
> Pull Request를 생성하면 자동으로 검사가 시작됩니다.

---

## 자주 묻는 문제

### ❌ `docker: command not found`
→ Docker Desktop이 설치되지 않았거나 실행되지 않은 상태입니다.  
Docker Desktop을 실행하고 초록색 아이콘이 뜨면 다시 시도하세요.

### ❌ `Error: ANTHROPIC_API_KEY is missing`
→ `.env` 파일에 API 키가 입력되지 않았습니다.  
2단계로 돌아가 모든 서비스의 `.env` 파일을 확인하세요.

### ❌ 포트가 이미 사용 중 (`port is already allocated`)
→ 3000~3008번 포트 중 이미 사용 중인 것이 있습니다.  
다른 프로그램을 종료하거나, Docker Desktop에서 실행 중인 컨테이너를 먼저 중지하세요.

### ❌ 빌드 중 오류 발생
→ 터미널에서 아래를 실행해 캐시를 초기화 후 다시 시도하세요.
```bash
docker compose down
docker compose up --build --force-recreate
```

---

## 다음 단계

- 전체 API 사용법: [`docs/reference/rest-api.md`](docs/reference/rest-api.md)
- 시스템 구조 이해: [`docs/concepts/`](docs/concepts/)
- 기여 방법: [`CONTRIBUTING.md`](CONTRIBUTING.md)
