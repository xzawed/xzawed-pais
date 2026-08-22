# CLAUDE.md — xzawedShared

`@xzawed/agent-streams`. 서버가 아니라 패키지다 — 포트가 없다.

**소비자는 8곳이다** — 에이전트 7종(Planner·Developer·Designer·Tester·Builder·Watcher·Security)과 **Manager**. Orchestrator는 쓰지 않는다.

이 패키지는 두 층이 한 지붕에 있다.

| 층 | 모듈 | 쓰는 곳 |
|---|---|---|
| **에이전트 런타임 공통** | `streams/`(base-consumer·event-bus·session-dispatcher·collaboration) · `claude/` · `prompt/` · `workspace-guard` · `types/agent-query` | 에이전트 7종 |
| **Manager 자율 아크의 순수 코어** | `task-graph/` · `decomposition/` · `budget/` · `resilience/` · `risk/` · `types/work-package` · `types/event-envelope` · `streams/dlq`의 redrive | **Manager 전용 — 에이전트는 한 줄도 import하지 않는다** |

수치로 보면 Manager의 프로덕션 import가 에이전트 7종 합계보다 많다. "에이전트 공통 라이브러리"로만 이해하면 코드의 절반을 놓친다.

## 명령

```bash
pnpm install
pnpm build        # tsc → dist/
pnpm test <파일>
```

`dev`도 `typecheck`도 없다 — scripts는 `build`·`test`·`test:coverage` 셋뿐이다.

## 소비자에게 미치는 영향

**이 패키지를 고치면 소비자 7곳이 조용히 stale해진다.** 소비자는 `file:../xzawedShared`로 참조하는데 `file:` 의존은 install 시점에 `node_modules`로 **복사**된다. 여기서 `pnpm build`를 해도 그 복사본은 다음 install까지 갱신되지 않는다.

```bash
bash ../scripts/sync-shared.sh   # 빌드 + 7개 서비스 복사본 일괄 갱신
```

CI·Docker는 매번 fresh install이라 이 함정이 없다. **로컬에서만 재현되는 종류의 혼란**이므로, 신규 export를 추가한 뒤 소비자에서 "그런 이름 없다"는 오류를 만나면 이걸 먼저 의심한다.

Manager도 이 패키지를 쓰지만 경로가 다르고(`file:../../../xzawedShared`) `sync-shared.sh`의 순회 대상이 **아니다**. shared를 고친 뒤 Manager에서 새 export를 쓰려면 `cd xzawedManager && pnpm install`을 별도로 돌리고, 스크립트 실행만으로 통과를 주장하지 말고 복사본을 실제로 대조한다.

## 모듈 지도

공개 표면의 정본은 `src/index.ts`다. 이름 목록을 여기 복사하지 않는다 — 복사본은 반드시 어긋난다.

| 모듈 | 책임 |
|---|---|
| `streams/base-consumer.ts` | 소비 골격. 바운드 재시도 → DLQ 격리, 멱등 소비 dedup. 전송은 EventBus에 위임 |
| `streams/dlq.ts` | DLQ 계약 단일출처(`dlqStreamKey`·`idemKey`·`DlqMessageSchema`) + 운영 도구 `redriveDlq` |
| `streams/event-bus.ts` | 전송 추상화. `RedisEventBus` 구현과 발행·소비 포트 타입 |
| `streams/session-dispatcher.ts` | 세션 게이트웨이 스트림에서 세션별 소비자를 띄우고 **내리는** 디스패처. 개통·종료 계약(`GatewayStartSchema`·`GatewayEndSchema`)의 정본 |
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

## BaseConsumer의 실패 의미론

**세 갈래로 갈리고, 그중 하나는 흔적이 남지 않는다.**

| 입력 | 처리 |
|---|---|
| 구조적 결함 — `data` 필드 없음 · 값 없음 · 크기 상한 초과 | **`console.error` 후 ack+skip. DLQ에도 안 간다** |
| JSON 파싱 실패 · 스키마 무효 | 재시도 없이 즉시 DLQ(`invalid_schema`) |
| 핸들러 throw | 바운드 백오프 재시도 후 DLQ(`handler_failed`) |

**DLQ를 뒤져도 안 나오는 메시지가 있다**는 뜻이다. 첫 줄이 그것이다.

그 밖에 알아야 할 것.

- **`handleMessage`는 절대 throw하지 않는다.** 배치 비차단과 PEL 누수 0을 위한 의도된 계약이므로, 여기에 throw를 기대하는 로직을 얹으면 조용히 무시된다.
- **재시도는 `onMessage`를 처음부터 재실행한다.** 핸들러가 멱등하지 않으면 파일 쓰기·빌드·테스트 실행이 중복된다.
- **`stop()`은 즉시 멈추지 않는다.** 정지 요청일 뿐이고 루프 탈출까지는 유휴 시 최대 1초(`blockMs`), 백오프 대기 중이면 최대 30초, `onMessage` 처리 중이면 무제한(핸들러 타임아웃이 없다)이 걸린다. "정지시켰다"와 "정지됐다"를 같은 것으로 다루면 안 된다.
- **`close()`는 멱등이고 되돌릴 수 없다.** 디스패처의 종료 처리와 `handleSessionEntry`의 finally가 둘 다 부를 수 있어 이중 `quit()`을 가드로 막는다. 한 번 정지된 소비자는 `start()`를 다시 불러도 루프에 진입하지 않는다 — 세션마다 새 인스턴스를 만드는 구조라 재사용 재기동은 없다.
- **멱등 소비 dedup 실패는 fail-open이다.** 멱등 저장소가 죽으면 중복 처리가 통과한다. 반대로 처리 중 크래시는 마커가 남아 재전달이 skip되므로 미완성 작업이 유실될 수 있다.

## 함정

- **`src/risk/index.ts`가 export하는 7개는 소비자가 쓸 방법이 없다.** `FULL_CONFIDENCE_SUPPORT`·`MEDIUM_SCORE_THRESHOLD`·`HIGH_SCORE_THRESHOLD`·`STAKES_SCORE_THRESHOLD`·`LOW_CONFIDENCE_THRESHOLD`·`CombineOptions`·`RouteOptions`가 `src/index.ts`로 re-export되지 않는데, `package.json`의 `exports` 맵이 `"."` 하나뿐이라 **딥 임포트도 불가능**하다. 필요하면 루트 배럴에 추가해야 한다.
- **`collaborationPayloadFields`는 4개 필드다** — `clarificationContext`·`query`·`queryKind`·`model`. `model`은 Manager가 WP별 라우팅 모델 id를 주입하는 통로라 빠뜨리면 모델 라우팅이 조용히 죽는다.
- **`CollabMessage`는 TypeScript 타입일 뿐 강제되지 않는다.** 각 서비스가 자기 `types.ts`에 Zod로 다시 선언하므로 tsc가 이 경계를 교차검증하지 못한다. 봉투를 바꾸면 `/contract-drift-check`로 대조한다.
- **`EventEnvelopeSchema`를 스트림 봉투로 착각하지 않는다.** 전자는 이벤트소싱 인과 추적용(Manager 전용)이고, 서비스 간 메시지 봉투는 `CollabMessage` 쪽이다.
- **`WorkPackage`의 id는 content-hash 파생이라 `risk`를 포함하지 않는다.** 리스크 등급이 바뀌어도 id가 유지되고 재진입이 안정적이다. 해시 입력을 바꾸면 기존 그래프의 모든 id가 갈린다.
- **Watcher는 협업 헬퍼를 쓰지 않는다.** Claude를 호출하지 않으므로 `createCollaborativeHandler`·`collaborationPayloadFields`·`answerViaClaude` 셋 다 빠진다. Manager가 교차질의 라우팅 대상에서 watcher를 제외하는 것과 같은 사실이다.
- **peer 범위가 실제보다 넓다.** `zod >=3`·`ioredis >=5`인데 shared 자신은 둘 다 devDependency로만 갖는다. 한 소비자가 zod 4로 올려도 peer 경고 없이 통과하면서 여기 Zod 3 스키마와 런타임에서 어긋날 수 있다.

## 환경 변수

라이브러리지만 **env를 두 개 읽는다**(`streams/base-consumer.ts`). `.env.example`이 없어서 발견하기 어렵다.

| 변수 | 기본 | 효과 |
|---|---|---|
| `SHARED_IDEMPOTENT_CONSUME` | ON | `'false'`로만 끌 수 있는 가역 스위치. 끄면 멱등 소비 dedup 전체가 사라진다 |
| `SHARED_IDEM_TTL_SEC` | 24시간 | 멱등 마커 TTL. NaN·0·음수는 기본값으로 폴백 |

## 참고

- 저장소 공통 규칙 → [루트 CLAUDE.md](../CLAUDE.md)
- 테스트 함정(블로킹 I/O mock 등) → [docs/development/testing-patterns.md](../docs/development/testing-patterns.md)
