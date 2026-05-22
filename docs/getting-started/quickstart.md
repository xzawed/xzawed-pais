[홈](../README.md) > [시작하기](./) > 퀵스타트

# 퀵스타트

저장소 클론부터 첫 메시지 전송까지의 최단 경로를 설명한다.

---

## 사전 요구 사항

| 항목 | 최소 버전 | 확인 명령 |
|------|-----------|-----------|
| Node.js | 22.0.0 | `node --version` |
| pnpm | 10.0.0 | `pnpm --version` |
| Redis | 7.0 | `redis-cli ping` |
| Git | — | `git --version` |

환경이 구성되어 있지 않으면 [설치](installation.md)를 먼저 완료한다.

---

## 1단계: 저장소 클론 및 의존성 설치

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais
```

공유 라이브러리를 먼저 빌드한다.

```bash
cd xzawedShared && pnpm install && pnpm build && cd ..
```

Orchestrator와 Manager 의존성을 설치한다.

```bash
cd xzawedOrchestrator && pnpm install && pnpm build && cd ..
cd xzawedManager && pnpm install && pnpm build && cd ..
```

---

## 2단계: 환경 변수 설정

```bash
cp xzawedOrchestrator/.env.example xzawedOrchestrator/.env
cp xzawedManager/.env.example xzawedManager/.env
```

`xzawedOrchestrator/.env`를 편집하여 API 키를 입력한다.

```env
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
MANAGER_URL=http://localhost:3001
PORT=3000
MODE=local
AUTH=none
```

`xzawedManager/.env`를 편집한다.

```env
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
REDIS_URL=redis://localhost:6379
PORT=3001
MODE=local
```

---

## 3단계: 서비스 시작

터미널을 두 개 열고 각각 실행한다.

**터미널 1 — Manager:**

```bash
cd xzawedManager/packages/server
pnpm dev
```

```
xzawedManager server running on port 3001
```

**터미널 2 — Orchestrator:**

```bash
cd xzawedOrchestrator/packages/server
pnpm dev
```

```
xzawedOrchestrator server running on port 3000
CLAUDE_MODE=api | MODE=local
```

---

## 4단계: 헬스체크 확인

```bash
curl http://localhost:3000/health
```

```json
{"status":"ok","timestamp":1748000000000}
```

---

## 5단계: 세션 생성

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "my-user"}'
```

```json
{"sessionId":"550e8400-e29b-41d4-a716-446655440000"}
```

---

## 6단계: 메시지 전송

반환된 `sessionId`로 메시지를 전송한다.

```bash
SESSION_ID="550e8400-e29b-41d4-a716-446655440000"

curl -X POST http://localhost:3000/sessions/$SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "쇼핑몰 서비스를 만들고 싶어요."}'
```

```json
{"messageId":"...","status":"accepted"}
```

---

## 7단계: WebSocket으로 실시간 응답 수신

서버는 메시지를 비동기로 처리하고 WebSocket으로 결과를 스트리밍한다.

```javascript
const ws = new WebSocket(`ws://localhost:3000/ws/sessions/${SESSION_ID}`);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

수신되는 이벤트 예시:

```json
{"type":"connected","sessionId":"550e8400-..."}
{"type":"chunk","content":"요구사항 파악을 시작합니다."}
{"type":"done"}
```

WebSocket 이벤트 타입 전체 목록은 [WebSocket 레퍼런스](../reference/websocket.md)를 참고한다.

---

## 다음 단계

- [설정 가이드](../guides/configuration.md) — 모든 환경 변수 설명과 시나리오별 예제
- [플랫폼 개요](../concepts/overview.md) — 에이전트 계층 구조와 동작 원리
- [REST API 레퍼런스](../reference/rest-api.md) — 전체 API 엔드포인트
- [Claude 실행 모드](../concepts/claude-runners.md) — `api` / `cli` / `remote` 비교
