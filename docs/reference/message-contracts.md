[홈](../README.md) > [레퍼런스](./rest-api.md) > 메시지 계약

# Redis Streams 메시지 계약

> 이 문서는 xzawedPAIS 서비스 간 Redis Streams 통신의 **단일 진실 공급원(Single Source of Truth)**이다. 모든 서비스는 이 계약을 따라야 하며, 새 메시지 타입을 추가할 때 반드시 이 문서를 함께 업데이트한다.

스트림 키 형식: `{출발지}:to-{목적지}:{sessionId}` / Consumer Group: `{목적지}-consumers`

---

## 공통 기반 타입

모든 메시지가 공유하는 기반 구조다.

```typescript
interface BaseMessage {
  sessionId: string    // UUID — 세션 격리 단위
  messageId: string    // UUID — 중복 처리 방지
  timestamp: number    // Unix milliseconds
}

interface UserContext {
  userId: string
  projectId: string
  workspaceRoot: string                              // 파일 I/O 기준 경로
  githubRepo?: { owner: string; repo: string; branch: string }
}
```

---

## Orchestrator → Manager

**스트림 키:** `orchestrator:to-manager:{sessionId}`  
**Consumer Group:** `manager-consumers`

### 수신 타입

```typescript
type OrchestratorMessageType = 'task_request' | 'info_response' | 'abort'

// task_request — 새 작업 요청
interface TaskRequestMessage extends BaseMessage {
  type: 'task_request'
  payload: {
    intent: string                    // 필수 — 정제된 사용자 의도 (1–4000자)
    context: Record<string, unknown>  // 필수 — 대화 히스토리 등
    priority: 'normal' | 'high'       // 필수
    userContext?: UserContext          // 선택 — projectId 설정 시 포함
  }
}

// info_response — Manager의 정보 요청에 대한 사용자 응답
interface InfoResponseMessage extends BaseMessage {
  type: 'info_response'
  payload: {
    answer: string    // 필수
  }
}

// abort — 작업 중단 요청
interface AbortMessage extends BaseMessage {
  type: 'abort'
  payload: Record<string, never>
}

type OrchestratorToManagerMessage = TaskRequestMessage | InfoResponseMessage | AbortMessage
```

| 타입 | 설명 |
|------|------|
| `task_request` | 새 작업 시작 — Claude tool-calling 루프 시작 |
| `info_response` | 사용자가 `info_request` 응답을 제출함 (동적 UI 폼 포함) |
| `abort` | 진행 중인 루프 즉시 중단 |

---

## Manager → Orchestrator

**스트림 키:** `manager:to-orchestrator:{sessionId}`  
**Consumer Group:** `orchestrator-consumers`

```typescript
type ManagerMessageType = 'status_update' | 'info_request' | 'task_complete' | 'error'

interface ManagerToOrchestratorMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: ManagerMessageType
  payload: {
    agentId: string    // 필수 — 어느 에이전트의 메시지인지 ('manager', 'planner' 등)
    content: string    // 필수 — 사람이 읽을 수 있는 상태 메시지
    uiSpec?: UISpec    // 선택 — info_request 시 동적 UI 폼 스펙
  }
}

interface UISpec {
  type: 'form' | 'mockup_viewer' | 'progress_board'
  title?: string
  fields?: UIField[]
  submitAction?: string
  content?: string
}

interface UIField {
  id: string
  type: 'text' | 'textarea' | 'select' | 'checkbox_group' | 'number'
  label: string
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
}
```

| 타입 | WebSocket 이벤트 | 설명 |
|------|------------------|------|
| `status_update` | `agent_status` | 도구 호출 시작·완료 진행 상황 |
| `info_request` | `agent_info_request` | 추가 사용자 입력 요청 (uiSpec 포함 가능) |
| `task_complete` | `agent_done` | 모든 처리 완료 — Consumer 종료 트리거 |
| `error` | `agent_error` | 처리 실패 — Consumer 종료 트리거 |

---

## Manager → Planner

**스트림 키:** `manager:to-planner:{sessionId}`  
**Consumer Group:** `planner-consumers`

```typescript
type ManagerToPlannerMessage = {
  sessionId: string    // UUID 형식 강제
  messageId: string
  timestamp: number
  type: 'plan_request' | 'abort'
  payload: {
    intent: string                    // 필수 — 1자 이상 4000자 이하
    context: Record<string, unknown>  // 필수
    priority: 'normal' | 'high'       // 필수
    userContext?: UserContext          // 선택
  }
}
```

---

## Planner → Manager

**스트림 키:** `planner:to-manager:{sessionId}`

```typescript
interface Step {
  id: string
  title: string
  description: string
  agentType: 'developer' | 'designer' | 'tester' | 'builder' | 'watcher' | 'security'
  dependencies: string[]    // 선행 step의 id[] — 빈 배열이면 즉시 실행 가능
  estimatedMinutes: number  // 0초과 480분 이하
}

interface PlannerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'plan_complete' | 'info_request' | 'error'
  payload: {
    steps?: Step[]           // plan_complete 시 포함
    estimatedTime?: string   // plan_complete 시 포함 (예: "약 10분")
    content: string          // 필수 — 요약 메시지
    uiSpec?: UISpec          // info_request 시 포함
  }
}
```

---

## Manager → Developer

**스트림 키:** `manager:to-developer:{sessionId}`  
**Consumer Group:** `developer-consumers`

```typescript
type ManagerToDeveloperMessage = {
  sessionId: string    // UUID 형식 강제
  messageId: string
  timestamp: number
  type: 'develop_request' | 'abort'
  payload: {
    plan: string                      // 필수 — 구현할 계획 텍스트
    projectPath: string               // 필수 — workspaceRoot 기준 경로
    context: Record<string, unknown>  // 필수
    userContext?: UserContext          // 선택
  }
}
```

---

## Developer → Manager

**스트림 키:** `developer:to-manager:{sessionId}`

```typescript
interface FileChange {
  path: string
  operation: 'create' | 'modify' | 'delete'
  content?: string    // delete 시 없음
}

interface DeveloperToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'develop_complete' | 'error'
  payload: {
    artifacts?: string[]    // 선택 — 생성·수정된 파일 경로 목록
    summary?: string        // 선택 — 작업 요약
    content: string         // 필수 — 완료 메시지
  }
}
```

---

## Manager → Designer

**스트림 키:** `manager:to-designer:{sessionId}`  
**Consumer Group:** `designer-consumers`

```typescript
type ManagerToDesignerMessage = {
  sessionId: string    // UUID 형식 강제
  messageId: string
  timestamp: number
  type: 'design_request' | 'abort'
  payload: {
    intent: string                    // 필수 — UI 설계 요청 (1자 이상 4000자 이하)
    context: Record<string, unknown>  // 필수
    targetFramework?: string          // 선택 — 예: 'react', 'vue'
    designSystem?: string             // 선택 — 예: 'shadcn', 'material'
    userContext?: UserContext          // 선택
  }
}
```

---

## Designer → Manager

**스트림 키:** `designer:to-manager:{sessionId}`

```typescript
interface ComponentSpec {
  name: string
  description: string
  props: Record<string, string>
  children?: ComponentSpec[]    // z.lazy()로 재귀 정의
  cssClasses?: string[]
}

interface DesignerToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'design_complete' | 'error'
  payload: {
    components?: ComponentSpec[]    // 선택 — 생성된 컴포넌트 스펙
    uiSpec?: UISpec                 // 선택 — 동적 UI 스펙
    content: string                 // 필수
  }
}
```

---

## Manager → Tester

**스트림 키:** `manager:to-tester:{sessionId}`  
**Consumer Group:** `tester-consumers`

```typescript
type ManagerToTesterMessage = {
  sessionId: string    // UUID 형식 강제
  messageId: string
  timestamp: number
  type: 'test_request' | 'abort'
  payload: {
    projectPath: string                // 필수
    testCommand?: string               // 선택 — 없으면 의존성 기반 자동 감지
    testFiles?: string[]               // 선택 — 특정 파일만 실행
    context: Record<string, unknown>   // 필수
    userContext?: UserContext           // 선택
  }
}
```

---

## Tester → Manager

**스트림 키:** `tester:to-manager:{sessionId}`

```typescript
interface TestFailure {
  file: string
  testName: string
  message: string
  suggestion: string    // Claude가 생성한 수정 제안
}

interface TesterToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'test_complete' | 'error'
  payload: {
    success?: boolean        // 선택 — 전체 테스트 통과 여부
    passed?: number          // 선택
    failed?: number          // 선택
    failures?: TestFailure[] // 선택 — 실패한 테스트 상세
    duration?: number        // 선택 — 실행 시간 (ms)
    content: string          // 필수
  }
}
```

---

## Manager → Builder

**스트림 키:** `manager:to-builder:{sessionId}`  
**Consumer Group:** `builder-consumers`

```typescript
type ManagerToBuilderMessage = {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_request' | 'abort'
  payload: {
    projectPath: string               // 필수
    target: 'development' | 'production'  // 필수
    command?: string                  // 선택 — 없으면 의존성 기반 자동 감지
    context: Record<string, unknown>  // 필수
    userContext?: UserContext          // 선택
  }
}
```

---

## Builder → Manager

**스트림 키:** `builder:to-manager:{sessionId}`

```typescript
interface BuildError {
  file?: string       // 선택 — 오류 발생 파일
  line?: number       // 선택 — 오류 발생 줄 번호
  message: string     // 필수
  suggestion: string  // 필수 — Claude가 생성한 수정 제안
}

interface BuilderToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'build_complete' | 'build_progress' | 'error'
  payload: {
    success?: boolean      // 선택 — build_complete 시 포함
    output?: string        // 선택 — 빌드 로그 전체
    artifacts?: string[]   // 선택 — 생성된 파일 경로
    duration?: number      // 선택 — 빌드 시간 (ms)
    errors?: BuildError[]  // 선택 — 실패 시 오류 목록
    content: string        // 필수
  }
}
```

> `build_progress` 타입은 빌드 실행 중 stdout/stderr 청크를 실시간으로 스트리밍할 때 사용한다.

---

## Manager → Watcher

**스트림 키:** `manager:to-watcher:{sessionId}`  
**Consumer Group:** `watcher-consumers`

```typescript
type ManagerToWatcherMessage = {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'watch_request' | 'stop_watch' | 'abort'
  payload: {
    projectPath: string        // 필수
    triggers: string[]         // 필수 — 상대경로 glob 패턴 (절대경로·'..' 포함 불가)
    debounceMs?: number        // 선택 — 기본 300ms (정수, 0 이상)
    context: Record<string, unknown>  // 필수
    userContext?: UserContext   // 선택
  }
}
```

> **보안**: `triggers` 항목은 절대경로와 `..` 경로 이동을 Zod 단계에서 차단한다.

---

## Watcher → Manager

**스트림 키:** `watcher:to-manager:{sessionId}`

```typescript
interface FileEvent {
  path: string
  event: 'add' | 'change' | 'unlink'
  timestamp: number
}

interface WatcherToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'watch_started' | 'file_changed' | 'watch_stopped' | 'error'
  payload: {
    watcherId?: string      // 선택 — 감시 인스턴스 ID
    changes?: FileEvent[]   // 선택 — file_changed 시 포함
    content: string         // 필수
  }
}
```

---

## Manager → Security

**스트림 키:** `manager:to-security:{sessionId}`  
**Consumer Group:** `security-consumers`

```typescript
type ManagerToSecurityMessage = {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'audit_request' | 'abort'
  payload: {
    artifacts: string[]              // 필수 — 감사 대상 파일 경로 (상대경로, '..' 불가)
    projectPath: string              // 필수 — 의존성 감사 기준 경로
    severity: 'low' | 'medium' | 'high'  // 필수 — 최소 보고 심각도
    context: Record<string, unknown> // 필수
    userContext?: UserContext         // 선택
  }
}
```

> **보안**: `artifacts` 항목은 절대경로와 `..` 경로 이동을 Zod 단계에서 차단한다.

---

## Security → Manager

**스트림 키:** `security:to-manager:{sessionId}`

```typescript
interface SecurityIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  category: string
  file: string
  line?: number
  description: string
  suggestion: string
  cwe?: string    // 선택 — CWE 번호 (예: 'CWE-79')
}

interface SecurityToManagerMessage {
  sessionId: string
  messageId: string
  timestamp: number
  type: 'audit_complete' | 'error'
  payload: {
    issues?: SecurityIssue[]   // 선택 — 발견된 보안 이슈 목록
    score?: number             // 선택 — 0-100 (높을수록 안전)
    summary?: string           // 선택 — 요약 메시지
    content: string            // 필수
  }
}
```

> 보안 점수 계산식: `Math.max(0, 100 - (critical×40 + high×15 + medium×5 + low×1))`

---

## 세션 게이트웨이 스트림

`SessionDispatcher`가 에이전트별로 구독하는 게이트웨이 스트림이다. 새 세션이 생성될 때 Orchestrator가 이 스트림에 메시지를 발행하면 각 에이전트가 per-session Consumer를 동적으로 생성한다.

**스트림 키:** `manager:to-{agent}:sessions`  
**Consumer Group:** `{agent}-dispatcher`

```typescript
interface SessionGatewayMessage {
  sessionId: string    // 신규 세션 ID
}
```

대상 에이전트: `planner`, `developer`, `designer`, `tester`, `builder`, `watcher`, `security` (7개)

---

## 관련 문서

- [Redis Streams 메시징](../concepts/redis-streams.md) — ACK 기반 신뢰성, 스트림 소스 구현
- [엔드투엔드 흐름](../concepts/end-to-end-flow.md) — 실제 메시지 순서 추적
- [동적 UI](../concepts/dynamic-ui.md) — UISpec JSON 포맷 상세
