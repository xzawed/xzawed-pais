# P2-2 워킹 스켈레톤 분해 생산자 (Manager 내장) 설계

- 날짜: 2026-06-08
- 서비스: `xzawedManager`(packages/server)
- 로드맵: senario ROADMAP Phase 2 — **PM Agent 분해 파이프라인**의 두 번째 슬라이스(생산자). P2-1 결정론 코어(#263) 다음. P1d Supervisor(#262)가 소비자로 대기 중.
- 선행 사양: `xzawedPAIS_handoff_spec.md` §6(분해 파이프라인) · WORKFLOW.md(INTAKE→DECOMPOSING) · `2026-06-08-p2-1-decomposition-core-design.md`.

## 1. 목표 & 비범위

**워킹 스켈레톤**: `intent → 단일 구조화 LLM 호출 → WP[](P2-1 content-hash ID) → decomposition.emitted 발행 → 이미 배선된 Supervisor가 소비·영속`을 **end-to-end로, flag 뒤·최소 리스크**로 증명한다. 파이프 자체·생산자 위치(Manager 내장)·스트림/봉투 계약을 검증하는 것이 목적. §6 P1~P5 정교함(에픽·세로 슬라이스·deliverable 도출·커버리지 repair 루프·역할 분할·간선 추론)은 **후속 슬라이스**.

**PO 결정(2026-06-08)**: ①첫 슬라이스 = 워킹 스켈레톤 ②생산자 위치 = **Manager 내장 모듈** ③트리거 = **신규 `decompose_request` 타입**(레거시 task_request와 분리) ④의존 표현 = **LLM 임시 ref → content-hash 리맵**(실 DAG).

**범위(이 슬라이스)**:
- `decompose/map.ts` — 순수 `toWorkPackages(llmWps): WorkPackage[]`(content-hash ID·ref→id 리맵·미지 ref 드롭·스키마 검증).
- `decompose/producer.ts` — `produceDecomposition(...)`(주입형 Claude 호출 → 파싱/검증 → `toWorkPackages` → `makeEnvelope` → `manager:decomposition:main` 발행) + 시스템 프롬프트 + Zod 응답 스키마 + fallback.
- 트리거 배선: `decompose_request` 메시지 타입(union·streams 타입) + `sessions.route.ts` flag-gated 분기.
- config flag `MANAGER_DECOMPOSE_ENABLED`(기본 false).
- 단위 테스트(순수 map·Claude mock producer·트리거 on/off) + (선택) skip-if-no-DB 통합.

**비범위(후속, 엄격 제외)**:
- §6 P1~P5 LLM 정교함: 에픽 식별·INVEST 세로 슬라이스·deliverable 인벤토리·커버리지 매트릭스 repair 루프(`coverageMatrix` 호출)·역할 분할 린트·간선 추론. → P2-3+.
- Wiki Agent 리스크 분류·모델 라우팅(§5). → 별도 슬라이스.
- Orchestrator UI가 `decompose_request`를 보내는 UX 배선. → 후속(스켈레톤은 핸들러+생산자까지; 테스트/수동 Redis 트리거로 end-to-end 검증).
- 워커 완료 신호 생산자(`wp.completion`). → P3 실행 에이전트.
- decomposition.emitted를 트랜잭셔널 아웃박스(manager_outbox) 경유 발행. → 스켈레톤은 직접 스트림 발행, 아웃박스 하드닝은 후속.
- oracleRef 채움(P3 Oracle). 스켈레톤 WP는 `oracleRef:null` → DoR 미충족 → 실 워커 디스패치는 P3 대기(Supervisor는 소비·영속·readyNodes 계산까지 동작; readyNodes는 ∅).

## 2. 데이터 흐름

```
orchestrator:to-manager:{sessionId}  --decompose_request{intent}-->  [flag MANAGER_DECOMPOSE_ENABLED]
   → produceDecomposition(intent, workflowId=sessionId)
       → callClaudeText(시스템 프롬프트, intent)         # 단일 호출
       → parse + DecompositionLlmSchema.safeParse         # 실패 시 fallback(단일 WP)
       → toWorkPackages(llm.workPackages)                 # 순수: content-hash id·ref 리맵
       → makeEnvelope(workflowId, stepId='decomposition.emitted', attemptId=0)
       → publish('manager:decomposition:main', {envelope, type:'decomposition.emitted', payload:{workPackages}})
   → (Supervisor) DecompositionConsumer 소비 → buildTaskGraph → upsertGraph → handleDispatch(readyNodes=∅, oracleRef null)
```

## 3. 컴포넌트 설계

### 3.1 순수 매핑 (`decompose/map.ts`)

LLM은 최종 content-hash ID를 모르므로 **임시 ref로 의존을 표현**한다. 순수 함수가 ID 부여·리맵을 담당.

```ts
import { contentHashId, WorkPackageSchema } from '@xzawed/agent-streams'
import type { WorkPackage } from '@xzawed/agent-streams'

/** LLM이 emit하는 WP 초안(임시 ref·content-hash 전). */
export interface LlmWorkPackage {
  ref: string                    // 로컬 임시 id(의존 상호참조용, 최종 id 아님)
  storyId: string
  owningRole: string
  acceptanceCriteria: string[]
  dependsOn: string[]            // 다른 WP의 ref 목록
}

/**
 * LLM 초안 → 디스패치 가능 WorkPackage[]. 각 WP에 content-hash id 부여 후 dependsOn(ref)을 id로 리맵.
 * 미지 ref는 드롭(dangling 방지). oracleRef=null(P3)·status='draft'. 결과는 WorkPackageSchema 검증 통과.
 */
export function toWorkPackages(llmWps: LlmWorkPackage[]): WorkPackage[]
```
- 각 wp: `id = contentHashId({storyId, owningRole, acceptanceCriteria})`.
- `refToId: Map<ref, id>` 구축(같은 ref 중복 시 첫 항목 유지). `dependencies = dependsOn.map(ref → refToId.get(ref)).filter(정의됨)`(미지 ref·자기참조 드롭).
- `WorkPackageSchema.parse`로 각 WP 검증(불변식 위반은 throw — 호출자 producer가 fallback).
- 충돌(동일 content-hash 두 WP)·사이클은 **막지 않고** 통과 → 소비자(P1d-2)가 `buildTaskGraph`/`detectCycle`로 `decomposition.inconsistent` 에스컬레이션(이미 구현). 생산자는 well-formed WP[]만 보장.

### 3.2 생산자 (`decompose/producer.ts`)

```ts
import { z } from 'zod'
import { callClaudeText, makeEnvelope } from '@xzawed/agent-streams'
import type { ClaudeLike } from '@xzawed/agent-streams'
import { toWorkPackages, type LlmWorkPackage } from './map.js'

export const DECOMPOSE_STREAM = 'manager:decomposition:main'

export type DecomposePublish = (stream: string, message: Record<string, unknown>) => Promise<unknown>

export interface ProduceDeps {
  claude: ClaudeLike
  model: string
  publish: DecomposePublish
  now?: () => number
}

/** intent → 단일 LLM 분해 → WP[] → decomposition.emitted 발행. 워크플로 1건. */
export async function produceDecomposition(
  intent: string,
  workflowId: string,
  deps: ProduceDeps,
): Promise<{ emitted: number }>
```
- 시스템 프롬프트(영문, Planner runner 선례): "Decompose the intent into work packages. Return ONLY JSON `{workPackages:[{ref,storyId,owningRole,acceptanceCriteria,dependsOn}]}`. ref는 로컬 임시 id, dependsOn은 다른 ref." owningRole 후보는 자유 string(WorkPackageSchema.owningRole 자유 string·WP0 #3 미결).
- `callClaudeText`로 호출(@xzawed/agent-streams 공통, Planner와 동일 패턴·타임아웃 race).
- 텍스트에서 `{`~`}` 추출 → `JSON.parse` → `DecompositionLlmSchema.safeParse`. 실패/빈 배열 → **fallback**: intent 한 줄을 단일 `LlmWorkPackage`로(`ref:'wp-1', storyId:'story-1', owningRole:'developer', acceptanceCriteria:[intent], dependsOn:[]`).
- `toWorkPackages` throw 시도 fallback.
- `makeEnvelope({correlationId: workflowId, causationId: null, workflowId, stepId:'decomposition.emitted', attemptId:0}, deps.now?.())` → `publish(DECOMPOSE_STREAM, {envelope, type:'decomposition.emitted', payload:{workPackages}})`. 페이로드는 Supervisor `DecompositionEmittedSchema`와 정확히 일치.
- 반환 `{emitted: workPackages.length}`.

`DecompositionLlmSchema`(producer 내부): `z.object({ workPackages: z.array(z.object({ ref: z.string().min(1), storyId: z.string().min(1), owningRole: z.string().min(1), acceptanceCriteria: z.array(z.string()).default([]), dependsOn: z.array(z.string()).default([]) })) })`.

### 3.3 트리거 배선

- **`types/streams.ts`**: `OrchestratorMessageType`에 `'decompose_request'` 추가 + `DecomposeRequestMessage` 인터페이스(`payload:{intent:string}`).
- **`streams/consumer.ts`**: `DecomposeRequestSchema`(sessionId·messageId·timestamp·`type:literal('decompose_request')`·`payload:{intent:z.string().min(1)}`)를 `OrchestratorToManagerMessageSchema` union에 추가.
- **`api/sessions.route.ts`** `startManagedSession` 핸들러: `else if (msg.type === 'decompose_request')` 분기 추가 — **`opts.decompose`가 주입돼 있으면**(=flag on) `produceDecomposition(msg.payload.intent, sessionId, opts.decompose)` 실행 → `task_complete`(content: `분해 완료: N WP emitted`) 발행 → task_request와 동일 정리(consumer.stop·sessionStore.delete·activeConsumers.delete). `opts.decompose` 미주입(flag off)이면 무시(ack만, 레거시 회귀 0).
- **`SessionsRouteOptions`/`makeSessionStarter`**: optional `decompose?: ProduceDeps` 주입(존재 자체가 enable 게이트 — 별도 enabled 필드 불필요). 누락 시 분기 미작동.

### 3.4 config & 배선 (`config.ts`/`server.ts`)
- `MANAGER_DECOMPOSE_ENABLED`(`z.enum(['true','false']).default('false')` → boolean) flag.
- `server.ts`: flag on이면 `decompose: ProduceDeps` 구성 — `claude=new Anthropic({apiKey})`, `model=config.CLAUDE_MODEL`, `publish=(stream,msg)=>producer.publishRaw(stream, msg)`(직접 스트림 발행, OutboxRelay와 동일 메서드). off면 미주입(`sessionsRoute` opts에 decompose 생략). ⚠️ 계획 단계에서 `StreamProducer.publishRaw(stream, message)` 시그니처 확인.

## 4. 핵심 설계 근거

- **레거시 분리(트리거)**: `decompose_request`는 task_request와 별개 타입 → 기존 Claude 도구 루프·승인 게이트 경로 무수정(회귀 0). 두 흐름을 깨끗이 분리해 점진 전환(eventually decompose_request가 task_request 대체)의 자리를 만든다.
- **순수/글루 분리**: ID·리맵 로직을 `map.ts` 순수 함수로 격리(Claude 없이 결정론 테스트). producer는 LLM·발행 글루. P2-1/P1d 패턴 일관.
- **content-hash ref 리맵**: LLM은 최종 id를 모르므로 ref로 의존 표현 → 순수 매핑이 id 부여·리맵. N4(재진입 안정)는 content-hash가 보장. dependencies는 hash에서 제외(P2-1)라 리맵이 id를 바꾸지 않음.
- **fail-soft 발행**: 충돌·사이클을 생산자가 판정하지 않고 소비자(P1d-2 결정론 경계)에 위임 — 책임 단일화(생산자=well-formed, 소비자=구조 정합). 파싱 실패만 fallback.
- **직접 발행(아웃박스 미경유)**: decomposition.emitted는 상태 전이 dual-write가 아닌 진입 이벤트 → 스켈레톤은 직접 xadd. 멱등은 envelope.idempotencyKey + 소비자 M6 dedup. 아웃박스 하드닝은 후속(상태 전이 이벤트가 아니라 트랜잭션 결합 이득 적음).
- **flag 기본 off**: 생산자 미주입 → 신규 코드만, 레거시·기존 테스트 회귀 0.

## 5. 테스트

- **`decompose/map.test.ts`**(순수): ref→id 리맵·content-hash 부여·미지 ref 드롭·자기참조 드롭·빈 입력·다중 WP DAG(buildTaskGraph 수용)·중복 ref.
- **`decompose/producer.test.ts`**(Claude mock `ClaudeLike`): 정상 LLM JSON → 올바른 emit(스트림 키·type·envelope 필드·workPackages)·fallback(파싱 실패 시 단일 WP emit)·빈 workPackages fallback·`emitted` 카운트.
- **트리거**(`sessions.route` 또는 분리 핸들러 단위): flag on → produceDecomposition 호출·task_complete 발행·정리. flag off/미주입 → 무시(레거시 분기 무영향).
- **config**: `MANAGER_DECOMPOSE_ENABLED` 파싱(기본 false·'true' → true).
- **(선택) 통합**(skip-if-no-DB·REDIS): produceDecomposition emit → DecompositionConsumer 소비 → task_graphs 영속 확인.

## 6. 회귀·검증

신규 파일(`decompose/`) + 기존 파일 additive 수정(union·type·routing 분기·config flag·server 배선)만. flag off 기본 → 레거시 task_request·승인 게이트·기존 테스트 회귀 0. `cd xzawedManager && pnpm build && pnpm test`(462→증가). 적대적 멀티에이전트 리뷰(순수 매핑 정합·fallback·발행 계약 일치·flag 분리·레거시 무영향). CPD 0·audit 0. PR → CI 그린 → squash 머지.

**다음 슬라이스 = P2-3**: §6 P1~P5 LLM 정교함 도입(에픽→세로 슬라이스→deliverable→커버리지 repair 루프(`coverageMatrix`)→역할 분할). 그리고 Orchestrator UX 트리거 배선·아웃박스 하드닝·완료 신호 생산자(P3)는 후속.
