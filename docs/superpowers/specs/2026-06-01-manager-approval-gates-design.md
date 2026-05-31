# 단계별 사용자 승인 게이트 — 설계

- 작성일: 2026-06-01
- 상태: 승인 대기
- 브랜치: `feat/manager/approval-gates`
- 범위: 서브프로젝트 A1 (승인 게이트 코어). A2·A3·B는 후속.

## 1. 목표

사용자 지시 → 에이전트 파이프라인이 **각 단계마다 사용자 승인을 받고 진행**하도록 한다. 기본은 수동 승인이며, 게이트별로 자동 모드를 허용한다.

목표 흐름:
```
사용자 의도 입력
  → Planner 실행 → 기획안 → ⛔ 승인
  → Designer 실행 → UI/UX 데모 시연 → ⛔ 승인
  → Developer 실행 → ⛔ 승인
  → Tester / Builder … → 각 단계 ⛔ 승인
  → GitHub 배포 → ⛔ 승인
```
각 게이트: 기본 수동(사용자 확인), 게이트별 자동 전환 가능. 사용자 행동 = 승인 / 수정요청 / 중단.

## 2. 현재 상태와 갭 (코드 근거)

`info_request → 사용자 응답 → 재개`라는 **기술 인프라는 완비**돼 있으나, Manager의 Claude 루프가 **자동 진행 모드**라 승인 게이트로 조립돼 있지 않다.

| 단계 | 현재 | 근거 |
|---|---|---|
| 입력 → Manager 전달 | ✅ 완성 | `xzawedOrchestrator/packages/server/src/api/sessions.route.ts:120-131` (`task_request` 발행) |
| 계획 후 승인 게이트 | ❌ 없음 | `xzawedManager/packages/server/src/tools/redis-agent-handler.ts:101-104` (완료 즉시 `return output`) |
| 자동 다음 단계 진행 | ⚠️ 게이트 없음 | `xzawedManager/packages/server/src/claude/runner.ts:222-280` (Claude가 다음 도구 자율 선택) |
| 데모 렌더링 | ⚠️ 저장만 | `xzawedOrchestrator/.../store/chat.store.ts:11-12,85` (uiSpec 저장, 렌더 없음) |
| 배포 승인 | ❌ 없음 | — |

재사용 가능 인프라:
- 사용자 대기/재개: `session.store.ts`의 `waitForInfo`/`resolveInfo:42-50`
- 명확화 중계: `runner.ts:148-160` (`ClarificationNeededError` → `info_request` 발행)
- 재실행 경로: `runner.ts:162-177` (`clarificationContext`로 핸들러 재실행)
- UI 응답: `ChatView.tsx:184-220`(렌더), `:101-109`(전송)

## 3. 접근 — 코드로 강제하는 게이트 (보강된 B안)

Claude 루프와 에이전트 유연성은 유지하되, **게이트는 프롬프트가 아니라 Manager 코드에서 결정론적으로 삽입**한다. Claude가 게이트를 건너뛸 경로 자체를 없앤다.

핵심: 에이전트 디스패치 도구의 실행 후처리에 게이트 미들웨어를 둔다. 도구 결과를 Claude에 반환하기 **전에** 게이트를 통과시킨다.

```
Claude가 에이전트 도구(plan-task/design-ui/develop-code/…) 호출
  → RedisAgentHandler가 실제 에이전트 실행 (기존)
  → ⛔ 게이트 미들웨어 (코드 레벨, 도구 결과 반환 직전):
       세션 게이트 설정 조회 (defaultMode + stage override)
       ├─ manual → info_request 발행 → waitForInfo 대기
       │     ├─ 승인     → 도구 결과를 Claude에 반환 (루프 계속)
       │     ├─ 수정요청 → 피드백을 clarificationContext에 담아 같은 도구 재실행 → 다시 게이트
       │     └─ 중단     → 세션 종료 (abort)
       └─ auto   → 게이트 없이 즉시 결과 반환
```

대안 비교(기각):
- 명시적 상태머신(A안): 결정론적이나 Claude 자율 루프를 통째로 재설계. 변경 과대.
- 순수 프롬프트 강제: 비결정론적 — "기본 수동 승인" 보장 불가. 기각.

## 4. A1 상세 설계

### 4.1 게이트 대상 정의
게이트는 **에이전트 디스패치 도구**에만 적용한다: `plan_task`, `design_ui`, `develop_code`, `run_tests`, `build_project`, `watch_changes`, `security_audit`. 보조 도구(`register_project`, `switch_project`, `github_ops`)는 비대상. (배포 `deploy_project`는 A3에서 별도 게이트.)

### 4.2 게이트 설정 저장소
세션별 상태에 추가:
```ts
interface GateConfig {
  defaultMode: 'manual' | 'auto'   // 기본 manual
  overrides: Record<string, 'manual' | 'auto'>  // stage(도구명) → mode
}
```
- 위치: `session.store.ts`의 세션 상태에 `gateConfig` 필드 추가.
- 초기값: `{ defaultMode: 'manual', overrides: {} }`.
- 변경 경로: 세션 시작 시 Orchestrator가 전달(payload), 또는 게이트 응답 시 "이 단계는 앞으로 자동" 옵션으로 override 갱신.
- 해석: `effectiveMode(stage) = overrides[stage] ?? defaultMode`.

### 4.3 게이트 미들웨어
- 위치: `redis-agent-handler.ts` — 에이전트 완료(`completeType`) 후 `return output` 직전에 게이트 훅 삽입. 게이트 로직 자체는 별도 모듈(`gates/approval-gate.ts`)로 분리해 핸들러는 호출만.
- 입력: `{ sessionId, stage(도구명), output(산출물 요약) }`.
- 동작: `effectiveMode`가 manual이면 `requestApproval()` → 사용자 응답까지 대기. auto면 즉시 통과.
- 산출물 요약: 각 단계 결과에서 사용자가 판단할 핵심을 추출(계획=Step[] 요약, 디자인=UISpec 요약 등). 상세 렌더링은 A2.

### 4.4 승인 요청·응답 라우팅
- 요청: 기존 `info_request` 메시지 타입을 재사용하되, payload에 `kind: 'approval'`, `stage`, `summary`, `mode` 추가. (기존 `kind: 'clarification'`과 구분)
- 응답: 기존 `info_response` 재사용. payload에 `decision: 'approve' | 'revise' | 'abort'`와 `feedback?`(수정 시) 추가.
- 라우팅:
  - approve → `resolveInfo`로 대기 해제, 도구 결과 Claude에 반환.
  - revise → 같은 도구를 `clarificationContext: feedback`으로 재실행(기존 `runner.ts:162-177` 경로 활용) → 재실행 후 다시 게이트.
  - abort → 세션 abort(기존 `sessionStore.abort` + 정리).

### 4.5 Orchestrator UI
- `ChatView.tsx`의 `pendingInfoRequest` 렌더링을 확장: `kind === 'approval'`이면 단계명 + 산출물 요약 + **[승인][수정요청][중단]** 버튼 + (수정 시) 피드백 textarea.
- 전송: 기존 `handleInfoResponseSend`(`:101-109`)를 확장해 `decision`·`feedback` 포함.
- "이 단계 앞으로 자동" 체크박스(선택) → `gateConfig.overrides` 갱신 요청.

### 4.6 데이터 흐름 (예: 계획 단계)
```
사용자 입력 → task_request → Manager Claude 루프
  → Claude가 plan_task 호출 → Planner 실행 → 계획 산출
  → [게이트: manual] info_request{kind:approval, stage:plan_task, summary} → Orchestrator → UI
  → 사용자 [승인] → info_response{decision:approve} → resolveInfo
  → 계획 결과를 Claude에 반환 → Claude가 design_ui 호출 → …(반복)
```

## 5. 범위 경계 (YAGNI)

| 포함 (A1) | 제외 (후속) |
|---|---|
| 모든 에이전트 단계 결정론적 게이트 | 데모 정적 목업 렌더링 (A2) |
| 전역 기본 모드 + 게이트별 override | GitHub 배포 게이트 (A3) |
| 승인/수정/중단 라우팅 | VSCode 내장 (B) |
| 산출물 요약(텍스트) 표시 | 게이트별 세밀한 권한·역할 |

## 6. 성공 기준

1. 기본(manual) 모드에서 각 에이전트 단계 완료 후 사용자 승인 없이는 다음 단계로 진행하지 않는다 (결정론적 — Claude가 건너뛰지 못함).
2. 게이트별 auto override 시 해당 단계는 자동 통과한다.
3. 수정요청 시 같은 단계가 피드백을 반영해 재실행되고 다시 게이트로 온다.
4. 중단 시 세션이 정리되고 후속 단계가 실행되지 않는다.
5. 기존 `info_request`(clarification) 동작이 깨지지 않는다 (회귀 없음).
6. 단위 테스트로 게이트 미들웨어의 manual/auto/revise/abort 경로를 검증한다.

## 7. 위험 및 대응

- **기존 clarification과 충돌**: `kind` 필드로 명확히 분기. 기존 경로 회귀 테스트 필수.
- **재실행 무한 루프**: 수정요청 반복에 상한(예: 단계당 N회) 또는 사용자 중단으로만 종료. 상한 도달 시 게이트에서 안내.
- **게이트 누락(비결정론)**: 게이트를 핸들러 후처리에 코드로 삽입하므로 Claude 프롬프트와 무관. 단위 테스트로 "manual인데 통과" 케이스 차단.
- **세션 상태 정합성**: `gateConfig`는 기존 세션 상태 저장소에 통합, abort/완료 시 함께 정리.

## 8. 산출물

- 본 설계 문서
- (구현 시) `xzawedManager/packages/server/src/gates/approval-gate.ts` 신규
- `session.store.ts` gateConfig 추가, `redis-agent-handler.ts` 게이트 훅, 메시지 타입 확장
- Orchestrator `ChatView.tsx` 승인 UI 확장
- 게이트 경로 단위 테스트

## 9. 후속 (이 설계 범위 밖, 별도 사이클)

- **A2**: Designer UISpec → 정적 목업 렌더링(데모 시연)을 Orchestrator UI에 표시 + 게이트 연동.
- **A3**: GitHub 배포(`deploy_project`) 전 승인 게이트.
- **B**: 오픈소스 VSCode 내장 빌드/실행 환경.
