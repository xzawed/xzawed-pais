[홈](../README.md) > [개념](.) > 동적 UI 패널

# 동적 UI 패널

동적 UI 패널은 서버(Orchestrator)가 JSON 명세를 WebSocket으로 전송하면 Electron 앱이 이를 실시간으로 렌더링하는 서버 주도 UI 시스템이다.

---

## 동작 원리

정적 UI와 달리, 동적 UI 패널은 에이전트 파이프라인의 요청에 따라 필요할 때만 생성된다.

```
사용자: "쇼핑몰 만들어줘"
    │
    ▼
Orchestrator: 요구사항 수집 필요
    │
    ▼ WebSocket → agent_info_request (uiSpec 포함)
    │
Electron 앱 우측 패널:
┌─────────────────────────┐
│  서비스 구성 요구사항    │
│                         │
│  서비스 유형 [커머스 ▼] │
│                         │
│  필요 기능              │
│  ☑ 상품 관리           │
│  ☑ 결제                │
│  □ 리뷰·평점           │
│                         │
│         [제출]          │
└─────────────────────────┘
```

Manager가 `info_request` 메시지를 보내면 `payload.uiSpec`이 포함된다. Orchestrator의 StreamConsumer는 이를 수신하고 WebSocket으로 `agent_info_request` 이벤트를 푸시한다. Electron 앱의 `DynamicPanel` 컴포넌트가 `uiSpec`을 파싱하여 실시간으로 렌더링한다.

---

## UISpec 타입

```typescript
// packages/shared/src/types/ui-spec.ts
export interface UISpec {
  type: UISpecType
  title?: string
  fields?: UIField[]        // type: 'form' 전용
  submitAction?: string     // type: 'form' 전용, 제출 시 intent로 사용
  content?: string          // type: 'mockup_viewer' | 'progress_board' 전용
}

export type UISpecType = 'form' | 'mockup_viewer' | 'progress_board'
```

### UISpec 타입 목록

| `type` 값 | 렌더링 | 설명 |
|-----------|--------|------|
| `form` | 입력 양식 | 구조화된 데이터 수집. `fields` 배열로 필드 구성 |
| `mockup_viewer` | 목업 뷰어 | Designer 에이전트가 생성한 UI 목업 확인·피드백 |
| `progress_board` | 진행 현황판 | 에이전트 작업 진행 상태 실시간 표시 |

---

## UIField 타입

```typescript
export interface UIField {
  id: string
  type: UIFieldType
  label: string
  required?: boolean
  options?: UISelectOption[]  // type: 'select' | 'checkbox_group' 전용
  placeholder?: string        // type: 'text' | 'textarea' 전용
}

export interface UISelectOption {
  value: string
  label: string
}

export type UIFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox_group'
  | 'number'
```

### UIField 타입 목록

| `type` 값 | 컴포넌트 | 추가 필드 |
|-----------|----------|-----------|
| `text` | 텍스트 입력 | `placeholder` |
| `textarea` | 여러 줄 텍스트 입력 | `placeholder` |
| `select` | 드롭다운 선택 | `options` |
| `checkbox_group` | 체크박스 다중 선택 | `options` |
| `number` | 숫자 입력 | — |

---

## UISpec 예시

```json
{
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
        {"value": "saas", "label": "SaaS"},
        {"value": "landing", "label": "랜딩 페이지"}
      ]
    },
    {
      "id": "features",
      "type": "checkbox_group",
      "label": "필요 기능",
      "options": [
        {"value": "products", "label": "상품 관리"},
        {"value": "payment", "label": "결제"},
        {"value": "reviews", "label": "리뷰·평점"},
        {"value": "inventory", "label": "재고 관리"}
      ]
    },
    {
      "id": "notes",
      "type": "textarea",
      "label": "추가 요구사항",
      "placeholder": "특별히 필요한 기능이나 참고할 서비스를 입력하세요"
    }
  ],
  "submitAction": "submit_requirements"
}
```

---

## 폼 제출 흐름

사용자가 폼을 작성하고 제출하면 Electron 앱은 `POST /sessions/:id/ui-actions`를 호출한다.

```bash
POST /sessions/{sessionId}/ui-actions
Content-Type: application/json
Authorization: Bearer <token>

{
  "action": "submit_requirements",
  "data": {
    "service_type": "ecommerce",
    "features": ["products", "payment"],
    "notes": "한국어 결제 수단 필수"
  }
}
```

```json
HTTP 202
{"status": "accepted"}
```

서버는 이 데이터를 `type: 'info_response'` 메시지로 `orchestrator:to-manager:{sessionId}` 스트림에 발행한다.

```typescript
await producer.publish({
  sessionId,
  messageId: crypto.randomUUID(),
  timestamp: Date.now(),
  type: 'info_response',
  payload: {
    intent: action,        // submitAction 값
    context: data ?? {},   // 폼 데이터
    priority: 'normal',
  },
})
```

---

## 관련 문서

- [세션 수명주기](sessions.md) — `waiting_user` 상태와의 관계
- [Redis Streams 메시징](redis-streams.md) — `info_request` / `info_response` 메시지 포맷
- [REST API 레퍼런스](../reference/rest-api.md) — ui-actions 엔드포인트 상세
- [WebSocket 프로토콜](../reference/websocket.md) — `agent_info_request` 이벤트 포맷
- [시스템 아키텍처](architecture.md)
