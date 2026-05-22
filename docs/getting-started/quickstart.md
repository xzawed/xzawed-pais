[홈](index.md) > 퀵스타트

# 퀵스타트

5분 안에 xzawedOrchestrator 서버를 실행하고 첫 번째 세션을 만드는 방법을 안내합니다.

---

## Prerequisites

시작 전에 아래 항목이 설치되어 있는지 확인하세요.

| 항목 | 최소 버전 | 확인 명령 |
|------|-----------|-----------|
| Node.js | 22.0.0 | `node --version` |
| pnpm | 9.0.0 | `pnpm --version` |
| Git | — | `git --version` |

> **Note:** Redis와 Claude CLI는 선택 사항입니다. Redis가 없으면 인메모리 폴백을, Claude CLI가 없으면 `CLAUDE_MODE=api`로 전환하세요.

---

## 1단계: 저장소 클론 및 설치

```bash
git clone https://github.com/xzawed/xzawed-pais.git
cd xzawed-pais
pnpm install
```

---

## 2단계: 환경변수 설정

```bash
cp .env.example .env
```

기본 설정(`.env.example`)으로 로컬 환경에서 즉시 실행 가능합니다. Claude API를 사용하려면 `.env`를 열어 수정하세요.

```env
# Claude CLI가 없는 경우: api 모드로 변경
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 3단계: 서버 시작

```bash
cd packages/server
pnpm dev
```

아래와 같은 출력이 나오면 성공입니다.

```
xzawedOrchestrator server running on port 3000
CLAUDE_MODE=cli | MODE=local
```

---

## 4단계: 서버 상태 확인

```bash
curl http://localhost:3000/health
```

```json
{"status":"ok","timestamp":1747267200000}
```

---

## 5단계: 첫 번째 세션 만들기

새 대화 세션을 생성합니다.

```bash
curl -X POST http://localhost:3000/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId": "my-user"}'
```

```json
{"sessionId":"550e8400-e29b-41d4-a716-446655440000"}
```

반환된 `sessionId`로 메시지를 전송합니다.

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

## 6단계: WebSocket으로 실시간 응답 받기

서버는 메시지를 비동기로 처리하고 WebSocket으로 결과를 스트리밍합니다.

```javascript
// 브라우저 또는 Node.js WebSocket 클라이언트
const ws = new WebSocket(`ws://localhost:3000/ws/sessions/${SESSION_ID}`);

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

```json
{"type":"connected","sessionId":"550e8400-..."}
{"type":"chunk","content":"네, 쇼핑몰 서비스 구현을 도와드리겠습니다."}
{"type":"done"}
```

---

## 다음 단계

- [설치 가이드](guides/installation.md) — Redis, Claude CLI 등 전체 환경 구성
- [설정 옵션 완전 가이드](guides/configuration.md) — 모든 설정 값 설명
- [아키텍처 개요](concepts/architecture.md) — 시스템 구조 이해
- [REST API 레퍼런스](reference/rest-api.md) — 전체 API 엔드포인트

---

## 관련 문서

- [환경변수 목록](reference/environment-variables.md)
- [Claude 실행 모드](concepts/claude-runners.md)
- [세션 수명주기](concepts/sessions.md)
