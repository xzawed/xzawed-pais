[홈](../index.md) > [개념](.) > 동적 UI 패널

# 동적 UI 패널

동적 UI 패널은 서버(지휘자)가 클라이언트(Electron 앱)에 JSON 명세를 전달하면 클라이언트가 이를 실시간으로 렌더링하는 **서버 주도 UI 시스템**입니다.

---

## 동적 UI 패널이란?

일반적인 정적 UI와 달리, 동적 UI 패널은 지휘자의 판단에 따라 **필요할 때만 필요한 UI를 생성**합니다.

예를 들어, 사용자가 "쇼핑몰 만들어줘"라고 하면 지휘자는 더 구체적인 요구사항이 필요하다고 판단하고 체크박스와 드롭다운으로 구성된 양식을 우측 패널에 렌더링할 수 있습니다.

```
사용자 입력: "쇼핑몰 만들어줘"
         │
         ▼
지휘자: 요구사항 수집 필요
         │
         ▼ WebSocket 푸시 (ui_spec JSON 포함)
         │
Electron 앱 우측 패널:
┌─────────────────────────┐
│  서비스 구성 요구사항    │
│                          │
│  서비스 유형            │
│  ┌──────────────────┐   │
│  │ 커머스         ▼ │   │
│  └──────────────────┘   │
│                          │
│  필요 기능 (복수 선택)   │
│  ☑ 상품 관리            │
│  ☑ 결제                 │
│  □ 리뷰·평점            │
│  □ 재고 관리            │
│                          │
│  추가 요구사항           │
│  ┌──────────────────┐   │
│  │                  │   │
│  └──────────────────┘   │
│                          │
│         [제출]           │
└─────────────────────────┘
```

---

## UISpec JSON 포맷

서버가 WebSocket 메시지에 포함하여 전달하는 JSON 구조입니다.

```typescript
interface UISpec {
  type: UISpecType          // 패널 종류
  title?: string            // 패널 제목
  fields?: UIField[]        // form 전용: 입력 필드 목록
  submitAction?: string     // form 전용: 제출 시 서버로 보낼 액션 이름
  content?: string          // mockup_viewer, progress_board 전용
}

type UISpecType = 'form' | 'mockup_viewer' | 'progress_board'
```

### 예시: 요구사항 수집 양식

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
      "label": "필요 기능 (복수 선택)",
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
      "placeholder": "특별히 필요한 기능이나 참고할 서비스를 입력해주세요"
    }
  ],
  "submitAction": "submit_requirements"
}
```

---

## UIField 포맷

```typescript
interface UIField {
  id: string               // 필드 식별자 (submitAction 시 키로 사용)
  type: UIFieldType        // 필드 타입
  label: string            // 화면에 표시될 레이블
  required?: boolean       // 필수 여부 (기본: false)
  options?: UISelectOption[] // select, checkbox_group 전용
  placeholder?: string     // text, textarea 전용
}

interface UISelectOption {
  value: string
  label: string
}
```

---

## 지원 컴포넌트 목록

| `type` 값 | 컴포넌트 | 설명 |
|-----------|----------|------|
| `form` | 양식 | 구조화된 입력 수집. `fields` 배열로 구성 |
| `mockup_viewer` | 목업 뷰어 | 디자이너 에이전트가 생성한 UI 목업 확인·피드백 |
| `progress_board` | 진행 현황판 | 각 에이전트의 작업 진행 상태 실시간 표시 |

### UIField 타입 목록

| `type` 값 | 컴포넌트 | 옵션 필드 |
|-----------|----------|-----------|
| `text` | 텍스트 입력 | `placeholder` |
| `textarea` | 여러 줄 텍스트 입력 | `placeholder` |
| `select` | 드롭다운 선택 | `options` |
| `checkbox_group` | 체크박스 다중 선택 | `options` |
| `number` | 숫자 입력 | — |

---

## 동적 UI 폼 제출

사용자가 폼을 작성하고 제출하면 Electron 앱이 아래 API를 호출합니다.

```bash
POST /sessions/{sessionId}/ui-actions
Content-Type: application/json

{
  "action": "submit_requirements",
  "data": {
    "service_type": "ecommerce",
    "features": ["products", "payment"],
    "notes": "한국어 결제 수단 필수"
  }
}
```

지휘자는 이 데이터를 받아 추가 정보 수집 또는 xzawedManager로의 작업 전달을 진행합니다.

---

## 다음 단계

- [REST API 레퍼런스](../reference/rest-api.md) — ui-actions 엔드포인트 상세
- [WebSocket 프로토콜](../reference/websocket.md) — ui_spec 푸시 이벤트 포맷

---

## 관련 문서

- [세션 수명주기](sessions.md)
- [시스템 아키텍처](architecture.md)
