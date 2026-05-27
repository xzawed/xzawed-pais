[홈](../README.md) > [레퍼런스](.) > WebSocket

# WebSocket

xzawedOrchestrator는 WebSocket을 통해 Claude 응답 스트리밍과 에이전트 상태 업데이트를 실시간으로 전송합니다.

---

## 연결

**엔드포인트:**

```
ws://localhost:3000/ws/sessions/{sessionId}       (로컬)
wss://your-server.com/ws/sessions/{sessionId}     (원격, TLS 필수)
```

세션이 존재하지 않으면 서버가 오류 메시지를 전송하고 연결을 종료합니다.

`USER_JWT_SECRET` 설정 시 인증이 필요합니다. 브라우저 WebSocket은 커스텀 헤더를 지원하지 않으므로 `Sec-WebSocket-Protocol: bearer.<accessToken>` 형식으로 전달합니다.

**브라우저 연결 예시:**

```javascript
const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const ws = new WebSocket(`ws://localhost:3000/ws/sessions/${sessionId}`);

ws.onopen = () => console.log("연결됨");
ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
ws.onerror = (err) => console.error("오류:", err);
ws.onclose = (event) => console.log("종료:", event.code, event.reason);
```

**Node.js 연결 예시 (`ws` 패키지):**

```javascript
import WebSocket from "ws";
const ws = new WebSocket(`ws://localhost:3000/ws/sessions/${sessionId}`);
ws.on("message", (data) => handleMessage(JSON.parse(data.toString())));
```

---

## 서버 → 클라이언트 이벤트

### connected

세션 연결 직후 전송됩니다.

```json
{ "type": "connected", "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

### chunk

Claude 응답 텍스트 스트리밍입니다. 메시지 완료 전까지 여러 번 전송됩니다.

```json
{ "type": "chunk", "messageId": "660f9500-...", "content": "네, 쇼핑몰 서비스 구현을 도" }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"chunk"` | 이벤트 타입 |
| `messageId` | string | 현재 메시지 ID |
| `content` | string | 스트리밍 텍스트 청크 |

---

### done

Claude 응답 스트리밍 완료 시 전송됩니다.

```json
{ "type": "done", "messageId": "660f9500-..." }
```

---

### status

xzawedManager에 태스크를 전달하는 중 임시 상태를 알립니다.

```json
{ "type": "status", "content": "전달 중..." }
```

---

### agent_status

xzawedManager가 하위 에이전트 진행 상황(`status_update`)을 보고할 때 전송됩니다.

```json
{ "type": "agent_status", "agentId": "xzawedDeveloper", "content": "사용자 인증 모듈 코드 생성 중..." }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"agent_status"` | 이벤트 타입 |
| `agentId` | string | 업데이트를 보낸 에이전트 ID |
| `content` | string | 상태 설명 텍스트 |

---

### agent_done

xzawedManager의 작업이 완료(`task_complete`)되었을 때 전송됩니다.

```json
{ "type": "agent_done", "agentId": "xzawedDeveloper", "content": "쇼핑몰 백엔드 API 구현 완료." }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"agent_done"` | 이벤트 타입 |
| `agentId` | string | 완료 에이전트 ID |
| `content` | string | 완료 결과 텍스트 |

---

### agent_error

xzawedManager가 오류(`error`)를 보고할 때 전송됩니다.

```json
{ "type": "agent_error", "agentId": "xzawedDeveloper", "content": "빌드 실패: TypeScript 컴파일 오류" }
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"agent_error"` | 이벤트 타입 |
| `agentId` | string | 오류 에이전트 ID |
| `content` | string | 오류 설명 텍스트 |

---

### agent_info_request

에이전트가 추가 정보(`info_request`)를 요청할 때 전송됩니다. `uiSpec`이 포함된 경우 클라이언트는 동적 폼을 렌더링하고 `POST /sessions/:id/ui-actions`로 제출합니다.

```json
{
  "type": "agent_info_request",
  "agentId": "xzawedPlanner",
  "content": "서비스 구성 요구사항을 입력해 주세요.",
  "uiSpec": {
    "type": "form",
    "title": "서비스 구성 요구사항",
    "fields": [
      {
        "id": "service_type",
        "type": "select",
        "label": "서비스 유형",
        "required": true,
        "options": [
          { "value": "ecommerce", "label": "커머스" },
          { "value": "saas", "label": "SaaS" }
        ]
      }
    ],
    "submitAction": "submit_requirements"
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"agent_info_request"` | 이벤트 타입 |
| `agentId` | string | 요청 에이전트 ID |
| `content` | string | 안내 텍스트 |
| `uiSpec` | object (optional) | 동적 폼 명세. 없으면 텍스트 안내만 표시 |

---

### error

처리 중 오류가 발생했습니다.

```json
{ "type": "error", "content": "Claude CLI 실행 실패: command not found" }
```

---

## 클라이언트 → 서버 메시지

### ack

클라이언트 확인 메시지입니다. 서버는 ack를 수신하면 응답을 반환합니다.

**클라이언트 전송:**

```json
{ "id": "message-id-to-ack" }
```

**서버 응답:**

```json
{ "type": "ack", "messageId": "message-id-to-ack" }
```

메시지 전송은 REST API(`POST /sessions/:id/messages`)를 사용하는 것이 권장됩니다.

---

## 이벤트 흐름

```
클라이언트                               서버
    │                                    │
    │── WebSocket 연결 ─────────────────►│
    │◄── {"type":"connected"} ───────────│
    │                                    │
    │── REST POST /messages ────────────►│ (별도 HTTP 요청)
    │◄── {"type":"chunk",...} ───────────│
    │◄── {"type":"chunk",...} ───────────│
    │◄── {"type":"status","content":"전달 중..."}─│
    │◄── {"type":"done",...} ────────────│
    │                                    │
    │  (xzawedManager 처리 진행 중)      │
    │◄── {"type":"agent_status",...} ────│
    │◄── {"type":"agent_status",...} ────│
    │                                    │
    │  (에이전트가 추가 정보 요청)        │
    │◄── {"type":"agent_info_request",...}───│
    │── REST POST /ui-actions ──────────►│ (폼 제출)
    │                                    │
    │◄── {"type":"agent_done",...} ──────│
```

---

## 재연결

```javascript
function connectWithRetry(sessionId, maxRetries = 5) {
  let retries = 0;

  function connect() {
    const ws = new WebSocket(`ws://localhost:3000/ws/sessions/${sessionId}`);

    ws.onopen = () => {
      retries = 0;
    };

    ws.onclose = () => {
      if (retries < maxRetries) {
        // 지수 백오프 + jitter (최대 30초)
        const delay = Math.min(1000 * Math.pow(2, retries), 30000) * (0.5 + Math.random() * 0.5);
        setTimeout(connect, delay);
        retries++;
      }
    };

    return ws;
  }

  return connect();
}
```

---

## 다음 단계

- [REST API 레퍼런스](rest-api.md) — 메시지 전송 API
- [MCP 도구 레퍼런스](mcp-tools.md) — MCP 세션 관리
