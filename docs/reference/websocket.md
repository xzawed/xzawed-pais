[홈](../index.md) > [레퍼런스](.) > WebSocket 프로토콜

# WebSocket 프로토콜

xzawedOrchestrator는 WebSocket을 통해 Claude 응답 스트리밍과 태스크 상태 업데이트를 실시간으로 클라이언트에 푸시합니다.

---

## 연결 방법

### 엔드포인트

```
ws://localhost:3000/ws/sessions/{sessionId}        (로컬)
wss://your-server.com/ws/sessions/{sessionId}      (원격, TLS 필수)
```

### 연결 예시

```javascript
// 브라우저 또는 Node.js
const sessionId = "550e8400-e29b-41d4-a716-446655440000";
const ws = new WebSocket(`ws://localhost:3000/ws/sessions/${sessionId}`);

ws.onopen = () => {
  console.log("WebSocket 연결됨");
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};

ws.onerror = (error) => {
  console.error("WebSocket 오류:", error);
};

ws.onclose = (event) => {
  console.log("WebSocket 연결 종료:", event.code, event.reason);
};
```

```javascript
// Node.js (ws 패키지)
import WebSocket from "ws";

const ws = new WebSocket(
  `ws://localhost:3000/ws/sessions/${sessionId}`
);

ws.on("message", (data) => {
  const message = JSON.parse(data.toString());
  handleMessage(message);
});
```

---

## 서버 → 클라이언트 이벤트

### connected

세션에 성공적으로 연결된 직후 전송됩니다.

```json
{
  "type": "connected",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### chunk

Claude의 응답 텍스트 스트리밍입니다. 메시지가 완료될 때까지 여러 번 전송됩니다.

```json
{
  "type": "chunk",
  "content": "네, 쇼핑몰 서비스 구현을 도",
  "messageId": "660f9500-..."
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"chunk"` | 이벤트 타입 |
| `content` | string | 스트리밍 텍스트 청크 |
| `messageId` | string | 현재 메시지의 ID |

---

### done

Claude 응답 스트리밍이 완료되었습니다.

```json
{
  "type": "done",
  "messageId": "660f9500-..."
}
```

---

### ui_spec

지휘자가 동적 UI 패널을 렌더링하도록 요청합니다. 사용자의 추가 입력이 필요할 때 전송됩니다.

```json
{
  "type": "ui_spec",
  "messageId": "660f9500-...",
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
          {"value": "ecommerce", "label": "커머스"},
          {"value": "saas", "label": "SaaS"}
        ]
      }
    ],
    "submitAction": "submit_requirements"
  }
}
```

UISpec 포맷 상세는 [동적 UI 패널](../concepts/dynamic-ui.md) 문서를 참고하세요.

---

### task_update

xzawedManager로부터 작업 진행 상황 업데이트를 수신했을 때 전송됩니다.

```json
{
  "type": "task_update",
  "agentId": "xzawedDeveloper",
  "status": "in_progress",
  "content": "사용자 인증 모듈 코드 생성 완료. 파일 저장 중 (45%).",
  "progress": 45
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"task_update"` | 이벤트 타입 |
| `agentId` | string | 업데이트를 보낸 에이전트 ID |
| `status` | `"in_progress"` \| `"completed"` \| `"error"` | 태스크 상태 |
| `content` | string | 상태 설명 텍스트 |
| `progress` | number (0-100) | 진행률 (optional) |

---

### error

처리 중 오류가 발생했습니다.

```json
{
  "type": "error",
  "message": "Claude CLI 실행 실패: command not found",
  "code": "CLI_NOT_FOUND"
}
```

---

## 클라이언트 → 서버 메시지

현재 클라이언트에서 서버로 전송할 수 있는 메시지는 다음과 같습니다. (메시지 전송은 REST API를 사용하는 것이 권장됩니다.)

### ack (클라이언트 확인)

```json
{
  "id": "message-id-to-ack"
}
```

서버는 ack를 수신하면 확인 메시지를 반환합니다.

```json
{
  "type": "ack",
  "messageId": "message-id-to-ack"
}
```

---

## 이벤트 흐름 예시

```
클라이언트                          서버
    │                               │
    │── WebSocket 연결 ─────────────►│
    │                               │
    │◄── {"type":"connected"} ──────│
    │                               │
    │── REST POST /messages ────────►│ (별도 HTTP 요청)
    │                               │
    │◄── {"type":"chunk",...} ──────│
    │◄── {"type":"chunk",...} ──────│
    │◄── {"type":"chunk",...} ──────│
    │◄── {"type":"done",...} ───────│
    │                               │
    │  (xzawedManager 작업 진행 중) │
    │                               │
    │◄── {"type":"task_update",...} │
    │◄── {"type":"task_update",...} │
    │                               │
    │  (추가 정보 필요)              │
    │                               │
    │◄── {"type":"ui_spec",...} ────│
    │                               │
    │── REST POST /ui-actions ──────►│ (폼 제출)
    │                               │
    │◄── {"type":"chunk",...} ──────│
    │◄── {"type":"done",...} ───────│
```

---

## 재연결 처리

네트워크 오류나 서버 재시작 시 자동으로 재연결하는 클라이언트 코드 예시입니다.

```javascript
function connectWithRetry(sessionId, maxRetries = 5) {
  let retries = 0;

  function connect() {
    const ws = new WebSocket(`ws://localhost:3000/ws/sessions/${sessionId}`);

    ws.onopen = () => {
      retries = 0;
      console.log("연결됨");
    };

    ws.onclose = (event) => {
      if (retries < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries), 30000);
        console.log(`${delay}ms 후 재연결 시도 (${retries + 1}/${maxRetries})`);
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
- [동적 UI 패널](../concepts/dynamic-ui.md) — ui_spec 포맷 상세

---

## 관련 문서

- [세션 수명주기](../concepts/sessions.md)
- [MCP 도구 레퍼런스](mcp-tools.md)
