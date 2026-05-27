[홈](../README.md) > [개념](./overview.md) > 엔드투엔드 요청 흐름

# 엔드투엔드 요청 흐름

사용자가 "쇼핑몰 결제 기능을 추가해줘"라고 입력했을 때 xzawedPAIS 전체 시스템이 어떻게 동작하는지 Redis Streams 메시지 단위로 추적한다. Orchestrator의 의도 정제부터 Manager Claude 루프, Planner → Developer → Builder 에이전트 순차 실행, 결과 반환까지의 전체 경로를 설명한다.

---

## 전체 흐름 요약

```
사용자 입력
    │ POST /sessions/:id/messages
    ▼
[Orchestrator] ─── 의도 정제 (Claude API) ─→ "결제 기능을 추가해 주세요"
    │ orchestrator:to-manager:{sessionId}
    ▼
[Manager] ─── Claude tool-calling 루프 시작
    │ plan_task 도구 호출
    │ manager:to-planner:{sessionId}
    ▼
[Planner] ─── Step[] 분해: [개발 단계, 테스트 단계, 빌드 단계]
    │ planner:to-manager:{sessionId}
    ▼
[Manager] ─── develop_code 도구 호출
    │ manager:to-developer:{sessionId}
    ▼
[Developer] ─── 파일 생성·수정
    │ developer:to-manager:{sessionId}
    ▼
[Manager] ─── build_project 도구 호출
    │ manager:to-builder:{sessionId}
    ▼
[Builder] ─── 빌드 실행
    │ builder:to-manager:{sessionId}
    ▼
[Manager] ─── task_complete 발행
    │ manager:to-orchestrator:{sessionId}
    ▼
[Orchestrator] ─── WebSocket으로 결과 전달
    │
    ▼
사용자 화면 업데이트
```

---

## 1단계: 사용자 입력 → Orchestrator

사용자가 Electron 앱 채팅 입력창에 "쇼핑몰 결제 기능을 추가해줘"를 입력하면:

1. **세션 생성** — `POST /sessions` 요청으로 UUID 세션이 생성된다. 세션 생성 시 Orchestrator는 `producer.publishSessionGateway(sessionId)`를 호출하여 모든 에이전트 서비스가 이 세션을 사전 준비할 수 있도록 게이트웨이 스트림(`manager:to-{agent}:sessions`)에 알린다.

2. **메시지 전송** — `POST /sessions/:id/messages`에 `content: "쇼핑몰 결제 기능을 추가해줘"`가 도달하면 즉시 `202 Accepted`를 반환하고 비동기 처리를 시작한다.

3. **Claude 의도 정제** — `ClaudeRunner.send()`가 대화 히스토리를 포함하여 Claude에 스트리밍 요청을 보낸다. 응답 청크는 WebSocket으로 실시간 전송된다. `structureIntent()`가 사용자 입력을 1–2문장의 명확한 의도로 정제한다:

   > "결제 모듈을 프로젝트에 추가하고 관련 파일을 생성해 주세요."

4. **Manager에 전달** — `StreamProducer.publish()`가 다음 메시지를 Redis Streams에 발행한다:

```
스트림 키: orchestrator:to-manager:{sessionId}
Consumer Group: manager-consumers

{
  sessionId: "a1b2c3d4-...",
  messageId: "uuid-...",
  timestamp: 1748390400000,
  type: "task_request",
  payload: {
    intent: "결제 모듈을 프로젝트에 추가하고 관련 파일을 생성해 주세요.",
    context: { history: [...] },
    priority: "normal",
    userContext: {
      userId: "user-uuid",
      projectId: "project-uuid",
      workspaceRoot: "/home/user/myshop"
    }
  }
}
```

---

## 2단계: Manager Claude tool-calling 루프

Manager의 `StreamConsumer`가 `XREADGROUP`으로 메시지를 수신하고 Zod 스키마 검증 후 `ClaudeRunner.run()`을 시작한다.

```
while (iterations++ < MAX_ITERATIONS) {   // 최대 50회
  response = await claude.messages.create({ tools, messages })

  if (stop_reason === 'tool_use') {
    // 도구 실행 → 결과 추가 → 다음 iteration
  } else if (stop_reason === 'end_turn') {
    // 완료 → task_complete 발행
  }
}
```

**도구 실행 전후 상태 공유:** 각 도구 호출 시작·완료마다 `status_update`를 `manager:to-orchestrator:{sessionId}`에 발행한다. 이를 통해 Orchestrator는 WebSocket을 통해 실시간 진행 상황을 사용자에게 전달한다.

---

## 3단계: Planner 호출

Claude가 `plan_task` 도구를 선택하면:

```
스트림 키: manager:to-planner:{sessionId}
Consumer Group: planner-consumers

{
  type: "plan_request",
  payload: {
    intent: "결제 모듈을 프로젝트에 추가하고 관련 파일을 생성해 주세요.",
    context: { history: [...] },
    priority: "normal"
  }
}
```

Planner는 Claude API를 호출하여 intent를 실행 가능한 `Step[]`로 분해한다:

```json
{
  "steps": [
    {
      "id": "step-1",
      "title": "결제 모듈 파일 생성",
      "agentType": "developer",
      "estimatedMinutes": 5,
      "dependencies": []
    },
    {
      "id": "step-2",
      "title": "빌드 확인",
      "agentType": "builder",
      "estimatedMinutes": 2,
      "dependencies": ["step-1"]
    }
  ],
  "estimatedTime": "약 7분"
}
```

응답은 `planner:to-manager:{sessionId}`로 반환된다.

---

## 4단계: Developer 호출

Manager Claude가 `develop_code` 도구를 선택하면:

```
스트림 키: manager:to-developer:{sessionId}
Consumer Group: developer-consumers

{
  type: "develop_request",
  payload: {
    plan: "step-1 실행: 결제 모듈 파일 생성...",
    projectPath: "/home/user/myshop",
    context: { steps: [...] }
  }
}
```

Developer는:
1. Claude API로 `FileChange[]` 목록을 생성한다
2. `fileio.applyChange()`로 실제 파일을 생성·수정한다 (삭제는 `.bak` 리네임)
3. `developer:to-manager:{sessionId}`로 결과를 반환한다:

```json
{
  "type": "develop_complete",
  "payload": {
    "artifacts": ["src/payment/payment.service.ts", "src/payment/payment.controller.ts"],
    "summary": "결제 서비스와 컨트롤러 파일 생성 완료",
    "content": "2개 파일 생성 완료"
  }
}
```

---

## 5단계: Builder 호출

Manager Claude가 `build_project` 도구를 선택하면:

```
스트림 키: manager:to-builder:{sessionId}
Consumer Group: builder-consumers

{
  type: "build_request",
  payload: {
    projectPath: "/home/user/myshop",
    target: "development",
    context: {}
  }
}
```

Builder는:
1. `detectBuildInfo()`로 빌드 명령을 자동 감지 (`package.json` → `pnpm run build`)
2. `pnpm run build` 실행 (stdout/stderr를 즉시 `build_progress`로 스트리밍)
3. 빌드 성공 시 `build_complete`를 반환한다

빌드 진행 중 실시간으로 발행되는 중간 메시지:

```
builder:to-manager:{sessionId}
type: "build_progress"
payload.content: "vite v5.0.0 building..."
```

---

## 6단계: 결과 반환 → 사용자 화면

Manager Claude 루프가 `end_turn`에 도달하면 최종 결과를 발행한다:

```
스트림 키: manager:to-orchestrator:{sessionId}
Consumer Group: orchestrator-consumers

{
  type: "task_complete",
  payload: {
    agentId: "manager",
    content: "결제 기능 추가 완료. payment.service.ts와 payment.controller.ts를 생성하고 빌드 성공을 확인했습니다."
  }
}
```

Orchestrator `StreamConsumer`가 이 메시지를 수신하면:
- `TaskStore`에서 태스크 상태를 `completed`로 업데이트
- WebSocket으로 `{ type: "agent_done", content: "..." }` 이벤트 전송
- Consumer 종료 및 삭제

사용자 화면은 WebSocket 이벤트를 받아 에이전트 타임라인 카드를 업데이트한다.

---

## 시간 분포 (참고값)

전형적인 단순 기능 추가 요청의 처리 시간:

| 단계 | 소요 시간 |
|------|-----------|
| Orchestrator 의도 정제 | 2–5초 |
| Manager → Planner (Step 분해) | 5–15초 |
| Manager → Developer (코드 생성) | 10–30초 |
| Manager → Builder (빌드) | 10–60초 |
| **전체** | **30초–2분** |

> 복잡한 기능(여러 파일 수정, 테스트 실행, 보안 감사 포함)은 3–10분이 소요될 수 있다.  
> Claude API 응답 시간은 모델·토큰 수·서버 부하에 따라 달라진다.

---

## 중단(Abort) 처리

사용자가 처리 중 작업을 취소하면:

1. Orchestrator가 `producer.publish({ type: "abort" })`를 `orchestrator:to-manager:{sessionId}`에 발행한다

2. Manager `StreamConsumer`가 `abort` 메시지를 수신하면 `SessionStore.abort(sessionId)`를 호출한다

3. `AbortController.abort()`가 현재 실행 중인 Claude API 요청을 중단한다:
   ```typescript
   // runner.ts
   if (signal?.aborted) throw new Error('Session aborted')
   ```

4. 하위 에이전트가 현재 작업 중이라면:
   - Manager가 해당 에이전트 스트림에 `abort` 메시지를 추가로 발행한다
   - 각 에이전트는 `abort` 타입을 수신하면 즉시 처리를 중단하고 Consumer를 종료한다

5. Orchestrator `StreamConsumer`는 연결을 종료하고 `TaskStore`에서 태스크 상태를 `failed`로 기록한다

> **주의**: 이미 파일시스템에 기록된 변경사항(`FileChange` 실행 완료 후)은 abort로 롤백되지 않는다. Developer가 생성한 파일들은 `.bak` 리네임 방식으로 추적되며 수동 복구가 가능하다.

---

## 관련 문서

- [시스템 아키텍처](architecture.md) — 전체 서비스 구성
- [Redis Streams 메시징](redis-streams.md) — ACK 기반 신뢰성, 스트림 키 구조
- [세션 관리](sessions.md) — 세션 상태 머신
- [메시지 계약](../reference/message-contracts.md) — 서비스별 TypeScript 인터페이스 전체 목록
- [동적 UI](dynamic-ui.md) — `info_request` 폼 패턴
