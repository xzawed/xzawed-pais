# CLAUDE.md — xzawedShared

7개 에이전트 서비스(Planner·Developer·Designer·Tester·Builder·Watcher·Security)가 공유하는 라이브러리 `@xzawed/agent-streams`. 서버가 아니라 패키지다 — 포트도 `.env.example`도 없다.

## 명령

```bash
pnpm install
pnpm build        # tsc → dist/
pnpm typecheck
pnpm test <파일>
```

`dev` 스크립트는 없다.

## 소비자에게 미치는 영향

**이 패키지를 고치면 소비자 7곳이 조용히 stale해진다.** 소비자는 `file:../xzawedShared`로 참조하는데 `file:` 의존은 install 시점에 `node_modules`로 **복사**된다. 여기서 `pnpm build`를 해도 그 복사본은 다음 install까지 갱신되지 않는다.

```bash
bash ../scripts/sync-shared.sh   # 빌드 + 7개 서비스 복사본 일괄 갱신
```

CI·Docker는 매번 fresh install이라 이 함정이 없다. **로컬에서만 재현되는 종류의 혼란**이므로, 신규 export를 추가한 뒤 소비자에서 "그런 이름 없다"는 오류를 만나면 이걸 먼저 의심한다.

Manager도 이 패키지를 쓰지만 경로가 다르고(`file:../../../xzawedShared`) `sync-shared.sh`의 순회 대상이 **아니다**.

## 모듈 지도

공개 표면의 정본은 `src/index.ts`다. 이름 목록을 여기 복사하지 않는다 — 복사본은 반드시 어긋난다.

| 모듈 | 책임 |
|---|---|
| `streams/base-consumer.ts` | 소비 골격. 바운드 재시도 → DLQ 격리, 멱등 소비 dedup. 전송은 EventBus에 위임 |
| `streams/dlq.ts` | DLQ 계약 단일출처(`dlqStreamKey`·`idemKey`·`DlqMessageSchema`) + 운영 도구 `redriveDlq` |
| `streams/event-bus.ts` | 전송 추상화. `RedisEventBus` 구현과 발행·소비 포트 타입 |
| `streams/session-dispatcher.ts` | 세션 게이트웨이 스트림에서 세션별 소비자를 띄우는 디스패처 |
| `streams/collaboration.ts` | 에이전트 handle 골격(`runCollaborativeHandle`·`createCollaborativeHandler`)과 `CollabMessage` 봉투 타입 |
| `workspace-guard.ts` | `validateWorkspaceRoot`(파일시스템 루트 거부)·`resolveWorkspaceRoot` |
| `types/agent-query.ts` | 교차질의 계약. `collaborationPayloadFields`가 답변자 스키마의 공통 필드 |
| `types/event-envelope.ts` | 이벤트소싱 메타데이터(`eventId`·`correlationId`·`causationId`·`idempotencyKey`). **스트림 봉투와 다른 것이다** |
| `types/work-package.ts` | WorkPackage 계약. `risk`·`inputs`·`outputs`·`epicId`·`attributionCounters` |
| `claude/answer-query.ts` | Claude 호출 헬퍼. `callClaudeTextWithUsage`는 usage를 노출해 비용 서킷의 입력이 된다 |
| `claude/knowledge.ts` | 응답에서 도메인 지식 배열 추출 |
| `prompt/domain-knowledge.ts` | 위키 지식을 프롬프트에 주입하는 포매터 |
| `task-graph/` | `buildTaskGraph`·`topoSort`·`detectCycle`·`readyNodes`·`oracleSatisfiedSet` |
| `decomposition/` | `coverageMatrix`·`contentHashId`·`mergeKeepInflight` |
| `budget/` | `costOf`(usage→USD)·`BudgetCircuitBreaker`·`MODEL_PRICING` |
| `resilience/` | `ProviderCircuitBreaker`·`Bulkhead`·운영 모드 FSM(`desiredMode`·`nextMode`) |
| `risk/` | 리스크 분류 채점 코어(`scoreClassification`·`combineRisk`·`routeModels`·`evaluateHumanGate`) |

## 순수 코어 경계

`task-graph/`·`decomposition/`·`budget/`·`resilience/`·`risk/`는 **LLM 호출도 I/O도 하지 않는다.** 입력을 받아 값을 반환할 뿐이라 단위 테스트가 싸고 결정론적이다.

이 경계는 **관례이지 코드로 강제되지 않는다.** 이 디렉토리에 `ioredis`나 `@anthropic-ai/sdk` import를 넣는 순간 소비자의 테스트가 실제 연결을 시도하기 시작한다. 새 코드를 여기 두기 전에 그 대가를 확인한다.

## 함정

- **`risk/index.js`가 export하는 이름 중 일부는 `src/index.ts`로 re-export되지 않는다.** `FULL_CONFIDENCE_SUPPORT`·`MEDIUM_SCORE_THRESHOLD`·`HIGH_SCORE_THRESHOLD`·`STAKES_SCORE_THRESHOLD`·`LOW_CONFIDENCE_THRESHOLD`·`CombineOptions`·`RouteOptions` 7개가 그렇다. 소비자에서 안 보이면 배럴에는 있는데 최상위 index에 없는 것이다.
- **`CollabMessage`는 TypeScript 타입일 뿐 강제되지 않는다.** 각 서비스가 자기 `types.ts`에 Zod로 다시 선언하므로 tsc가 이 경계를 교차검증하지 못한다. 봉투를 바꾸면 `/contract-drift-check`로 대조한다.
- **`EventEnvelopeSchema`를 스트림 봉투로 착각하지 않는다.** 전자는 이벤트소싱 인과 추적용이고, 서비스 간 메시지 봉투는 `CollabMessage` 쪽이다.
- **`WorkPackage`의 id는 content-hash 파생이라 `risk`를 포함하지 않는다.** 그래서 리스크 등급이 바뀌어도 id가 유지되고 재진입이 안정적이다. 해시 입력을 바꾸면 기존 그래프의 모든 id가 갈린다.
- **peer dependency는 `zod >=3`·`ioredis >=5`다.** 소비자가 설치하는 버전을 쓰므로 여기서 major를 올릴 때는 7개 소비자 전부를 확인한다.

## 참고

- 저장소 공통 규칙 → [루트 CLAUDE.md](../CLAUDE.md)
- 테스트 함정(블로킹 I/O mock 등) → [docs/development/testing-patterns.md](../docs/development/testing-patterns.md)
