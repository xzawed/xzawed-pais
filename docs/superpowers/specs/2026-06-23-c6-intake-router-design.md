# C6 인텐트 라우터 (intake) 설계

- 날짜: 2026-06-23
- 상태: 승인됨 (구현 대기)
- 범위: xzawedOrchestrator (shared types · StreamProducer · sessions.route · server config). **Manager 변경 0**.

## 1. 배경·문제

post-#332 재감사가 지목한 **키스톤(C6)**: `decompose_request`를 발행하는 생산자가 repo 전체에 **0개**. Orchestrator는 `userContext`(userId·projectId·workspaceRoot)를 다 조립하고도([sessions.route.ts `publishTaskToManager`](../../xzawedOrchestrator/packages/server/src/api/sessions.route.ts)) 무조건 `task_request`(대화형 ClaudeRunner tool-loop)만 발행한다. Manager는 `decompose_request`를 소비할 준비(consumer.ts `DecomposeRequestSchema` + `handleDecomposeRequest`)가 되어 있으나 입력이 도착하지 않아, **P1d→P2→P3→P4→P5 자율 태스크그래프 아크 전체가 런타임 도달 불가**(테스트 ~1104 pass는 코드 완성도이지 활성도 아님). C6가 intake 라우터를 추가해 분해 경로를 **처음으로 라이브 경로에서 생산 가능**하게 한다.

## 2. 목표·비목표

**목표**: 사용자가 **명시 모드 신호**(`mode:'build'`)로 보낸 메시지를 `decompose_request`로 라우팅(자율 태스크그래프). 기본 `chat`(또는 미지정)은 **현행 대화형 흐름 byte-identical**. 플래그(`ORCHESTRATOR_DECOMPOSE_ENABLED`) off→회귀 0.

**비목표(YAGNI·후속)**:
- **UI 모드 토글**(앱에서 build 선택) — 즉시 후속 슬라이스(C0→C1 백엔드-먼저-UI-나중 선례). 이 슬라이스는 API `mode` 필드까지.
- **LLM 의도 분류기**(브레인스토밍 Approach B) — 명시 신호 위 미래 계층.
- **build 모드 structureIntent 정제** — MVP는 원 사용자 요청을 그대로 분해 intent로(Manager 다단계 분해가 epics→stories→WP 처리).
- **re-decompose 정합(E10)**·재분해 트리거 — 별도.

## 3. 결정(승인됨)

1. **명시 모드 신호**: POST `/sessions/:id/messages` body에 `mode?: 'chat' | 'build'`(기본 `chat`). `gateMode` 패턴 미러.
2. **build 모드는 대화형 runner를 건너뛴다**: build = 자율 빌드라 잡담 응답 불필요. intent = 원 사용자 요청(`req.body.content`).
3. **백엔드 전용 슬라이스**: `mode`는 API 레벨로 먼저. UI 토글은 후속.
4. **플래그 게이팅**: `ORCHESTRATOR_DECOMPOSE_ENABLED`(기본 false). off면 `mode:'build'`도 무시·chat 폴백 → **바이트 동일·회귀 0**.

## 4. 아키텍처

### 4.1 shared types (`packages/shared/src/types/streams.ts`)
- `OrchestratorMessageType`에 `'decompose_request'` 추가.
- `OrchestratorToManagerMessage` 유니언에 분기 추가:
```ts
| {
    sessionId: string
    messageId: string
    timestamp: number
    type: 'decompose_request'
    payload: { intent: string; userContext?: UserContext }
  }
```
`UserContext`는 기존 export 재사용. `StreamProducer.publish(message: OrchestratorToManagerMessage)`는 유니언만 받으므로(런타임 스키마 없음·JSON.stringify 후 xadd) **타입 확장만으로 새 타입 발행 허용**(producer 코드 무변경, 컴파일만).

### 4.2 userContext 빌더 추출 (DRY)
현재 `publishTaskToManager`(sessions.route.ts:91-138) 안에 묻혀 있는 userContext 조립(project workspace 조회·`assertNotFilesystemRoot`·`default`/env 폴백)을 **순수 헬퍼 `buildUserContext(session, pool, envFallback): Promise<UserContext>`로 추출**해 task_request·decompose_request 양쪽이 공유(CPD0). 동작 불변(task_request 회귀 0). 산출 workspaceRoot는 절대경로(Manager `AbsoluteUserContextSchema` refine 충족).

### 4.3 인텐트 분기 (`sessions.route.ts`)
- `POST /sessions/:id/messages` body 타입에 `mode?: 'chat' | 'build'` 추가(`{ content, gateMode?, mode? }`).
- 메시지 처리 IIFE **진입부**(processRunnerChunks 이전)에서 분기:
```
if (capturedMode === 'build' && config.decomposeEnabled) {
  const userContext = await buildUserContext(capturedSession, pool, envFallback)
  const intent = req.body.content            // 원 사용자 요청
  taskStore.create(sessionId, intent)
  await publishDecomposeToManager(producer, sessionId, intent, userContext, getSocket, app.log, capturedLocale)
  getSocket()?.send(JSON.stringify({ type: 'done', messageId: assistantMsgId }))
  return                                       // 대화형 경로 스킵
}
// else: 기존 chat 경로 변경 0 (runner.send → structureIntent → publishTaskToManager)
```
- `publishDecomposeToManager(producer, sessionId, intent, userContext, getSocket, log, locale)` 헬퍼(신규): `decompose_request` 발행 + status 청크(**기존 `t('status.forwarding', locale)` 재사용**·신규 i18n 키 0) + publish 실패 시 `log.warn`(기존 패턴). `assertNotFilesystemRoot`는 `buildUserContext`가 보장.
- 이후 분해 아크의 진행(status_update/task_complete)은 기존 `handleConsumerMessage`가 consumer로 받아 UI에 스트리밍(변경 0).

### 4.4 config·server 배선
- `SessionsRoutesConfig`에 `decomposeEnabled?: boolean` 추가.
- server.ts 부트스트랩이 `process.env.ORCHESTRATOR_DECOMPOSE_ENABLED === 'true'`를 읽어 `sessionsRoutes` 등록(server.ts:153) config에 전달. 미설정/false면 `decomposeEnabled=false`.

## 5. 데이터 흐름

```
POST /sessions/:id/messages { content, mode?, gateMode? }
  ├─ mode==='build' && ORCHESTRATOR_DECOMPOSE_ENABLED
  │    → buildUserContext → decompose_request{ intent: content, userContext }
  │      → orchestrator:to-manager:{sessionId}  → Manager StreamConsumer → handleDecomposeRequest
  │        (MANAGER_DECOMPOSE_ENABLED on이면 다단계 분해→decomposition.emitted→Supervisor 아크)
  │    → status/done 청크 (이후 arc status는 consumer로 스트리밍)
  └─ else (chat·기본·flag off)
       → runner.send 스트리밍 → structureIntent → publishTaskToManager(task_request)   [변경 0]
```

## 6. 에러 처리·엣지

- **flag off + mode build**: build 무시·chat 폴백(바이트 동일).
- **Manager decompose off**(`MANAGER_DECOMPOSE_ENABLED` off): Manager가 기존 M8 봉합으로 요청자에게 `error` 발행(decompose 비활성) → UI에 error 표시. (Orchestrator는 정상 발행·Manager 측 게이트.)
- **decompose_request publish 실패**: `publishTaskToManager`와 동일하게 `log.warn` 후 진행(요청 자체는 202 accepted).
- **projectId 없음(AUTH=none/미선택)**: `buildUserContext`가 `projectId:'default'`·env workspaceRoot로 폴백(현행 동일).
- **build 모드 + abort 동시성**: build는 early-return이라 `processingSessionIds` 가드·finally cleanup 흐름 보존(IIFE try/finally 안에서 분기).

## 7. 테스트 (`api/__tests__/sessions-publish.test.ts` 패턴 미러)

- **mode='build' + decomposeEnabled** → `producer.publish`가 `type:'decompose_request'`·`payload.intent === content`·`payload.userContext` 절대 workspaceRoot로 호출. `task_request` 미발행. runner.send 미호출(대화형 스킵).
- **mode 미지정 / mode='chat'** → 현행 `task_request` 발행(회귀 0).
- **decomposeEnabled=false + mode='build'** → `task_request` 폴백(build 무시).
- **buildUserContext** 단위: project workspace 조회·default 폴백·fs-root 거부(추출 회귀 0).
- shared 타입 컴파일(decompose_request 유니언).

## 8. 수용 기준

1. `mode:'build'` + `ORCHESTRATOR_DECOMPOSE_ENABLED` → `decompose_request`가 `intent`(원 요청)+절대 `userContext`로 발행.
2. chat/미지정/flag-off → `task_request`(현행 byte-identical·회귀 0).
3. **Manager 변경 0**·shared 타입 확장만·신규 migration 0.
4. `ORCHESTRATOR_DECOMPOSE_ENABLED` 기본 false → off 시 회귀 0.
5. UI 토글 없이 API `mode` 필드로 실증(단위 테스트). 라이브 경로에서 `decompose_request` 생산 가능 = 키스톤 dormancy 해소.

## 9. 영향 파일

- `xzawedOrchestrator/packages/shared/src/types/streams.ts` (유니언+타입 확장)
- `xzawedOrchestrator/packages/server/src/api/sessions.route.ts` (`buildUserContext` 추출·`mode` 분기·`publishDecomposeToManager`)
- `xzawedOrchestrator/packages/server/src/server.ts` (flag 읽기·config 전달)
- `xzawedOrchestrator/packages/server/src/api/__tests__/sessions-publish.test.ts` (+ 신규 테스트)
- 문서: 작업 완료 후 CLAUDE.md(루트·Orchestrator) 최신화 + `ORCHESTRATOR_DECOMPOSE_ENABLED` env 문서.

## 10. 후속(이 슬라이스 밖)
- **UI 모드 토글**(앱 build 선택·i18n) — 즉시 다음.
- LLM 의도 분류기·build structureIntent 정제·E10 재분해 정합.
