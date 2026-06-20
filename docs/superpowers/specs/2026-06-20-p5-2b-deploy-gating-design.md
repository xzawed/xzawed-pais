# P5-2b 배포 게이팅 설계 (deploy gating)

> 상태: 설계 승인(브레인스토밍 2026-06-20) + 4-렌즈 적대 리뷰 반영(mustFix 4·shouldFix 6·minor 다수). 다음: 구현 계획(writing-plans).
>
> **SQL 교차검증 완료**: 두 조회 SQL의 컬럼명·조인 키·JSONB 경로·`scope` 값은 migration 007/011/014 및 런타임 코드(`task-graph.repo.ts` upsertGraph·`decision-consumer.ts` recordSignOff)와 전부 일치(리뷰가 critical로 올린 'SQL 조인 오류'는 거짓 양성·철회됨).

## 목표

릴리스 게이트(P5-1)가 `blocked`로 판정한 워크플로의 산출물이 **사인오프 없이 배포되는 것을 차단**한다. `deploy_project` 도구가 실행 직전 해당 프로젝트의 최신 릴리스 게이트를 조회해, `blocked`이고 승인된 릴리스 사인오프(P5-2a)가 없으면 배포를 거부한다. 이로써 **릴리스 게이트 → 사람 사인오프(P5-2a) → 배포**의 폐루프를 닫는다.

## 배경: 두 실행 세계의 단층

- `deploy_project`는 **대화형 LLM tool-loop**(`runner.ts`)에서 실행된다. 실행 시점 식별자는 `sessionId`(대화 세션)와 `userContext.projectId`뿐. 현재 **게이트 검사 전무**, GitHub push만 수행.
- 릴리스 게이트(P5-1)는 **별도 자율 task-graph 파이프라인**(Supervisor)에서 `workflowId`로 키된다(`release_gates`). `deploy_project`에는 `workflowId`가 없다.
- 연결 고리: `task_graphs.graph_dag.userContext.projectId`(P4a-2 영속). 즉 `projectId → workflowId → release_gates` **역방향 조회**로만 게이트에 도달.
- **순수 대화형 세션**(분해 없음)은 릴리스 게이트가 아예 없다.
- **`'default'` sentinel(교차 서비스)**: Orchestrator는 프로젝트 미선택 세션에 `userContext.projectId = 'default'`를 하드코딩해 Manager로 보낸다(`xzawedOrchestrator/.../sessions.route.ts:118` 검증). 따라서 Manager는 "부재"를 빈 값이 아니라 마법 문자열 `'default'`로 받는다 → 게이트는 이를 **부재와 동일하게(fail-open)** 취급해야 한다(아래 §3·안전 모델). 이로써 **Orchestrator 변경 0**으로 단층을 흡수한다.
- **TOCTOU(알려진 한계)**: `checkDeploy` 판정 시점과 실제 GitHub push 사이에 게이트가 재기록되면 stale 판정이 가능. best-effort 게이트로 수용(정밀화=deploy 입력에 workflowId 명시, 후속).

## 안전 모델 (승인된 결정 — 2계층)

판정은 **두 계층**으로 나뉜다: ① 구현체 `ReleaseDeployGate.checkDeploy`(projectId 가드·DB 오류 catch), ② 순수 함수 `evaluateDeployGate`(게이트/사인오프 4분기). 표의 "처리 계층" 열이 이를 명시한다.

| 조건 | 동작 | 처리 계층 | 근거 |
|---|---|---|---|
| `projectId` 부재 **또는 `'default'`** | ✅ 허용 | `checkDeploy` 가드 | 식별 불가 → **fail-open** |
| 조회 중 **임의의 오류**(게이트·사인오프 조회) | ✅ 허용 | `checkDeploy` catch | **never-throw(N3)·fail-open** |
| 게이트 **부재**(대화형 세션) | ✅ 허용 | `evaluateDeployGate`(gate=null) | **fail-open-on-absence**·회귀 0 |
| `status = passed` | ✅ 허용 | `evaluateDeployGate` | 게이트 통과 |
| `status = blocked` + **승인 사인오프 있음** | ✅ 허용 | `evaluateDeployGate` | P5-2a degraded 수용·폐루프 |
| `status = blocked` + 사인오프 없음 | ❌ 차단(throw) | `evaluateDeployGate` → execute throw | 미검증 산출물 배포 방지 |

> **fail-open 선택**: P5-1 게이트 평가는 *fail-closed-on-absence*(증거 부재 → CLOSED)지만, P5-2b *배포 게이트*는 *fail-open-on-absence*다. `deploy_project`가 LLM 루프 도구여서 task-graph를 거치지 않는 정상 대화형 배포가 게이트 미생성으로 일괄 차단되면 안 되기 때문. 게이트는 **존재하고 blocked일 때만** 차단한다.
>
> **미지 status 처리(확정)**: `release_gates.status`는 CHECK 제약 없는 TEXT다(migration 014). `latestGateByProject`는 최신 게이트 행을 조회한 뒤 **`status`가 `'passed'`도 `'blocked'`도 아니면 `null`을 반환**한다(미지 값 = 판정 불가 → fail-open, 표의 '게이트 부재 → 허용'과 일관). `evaluateDeployGate`는 `'passed'|'blocked'|null` 세 입력만 받으므로 default 분기로 undefined가 새지 않는다.

## 컴포넌트 (전부 additive·flag 뒤·새 migration 없음)

### 1. `ReleaseGateRepo.latestGateByProject(projectId)` — 게이트 역방향 조회 (신규)

`db/release-gate.repo.ts`에 추가(`release_gates` 읽기 메서드 부재라 신규).

```ts
latestGateByProject(projectId: string): Promise<{ status: 'passed' | 'blocked'; workflowId: string } | null>
```

SQL — `release_gates` ⋈ `task_graphs`(workflow_id), `graph_dag.userContext.projectId` 필터, 최신 1건. **`id DESC` tiebreak**로 동일 ms 비결정성 제거:

```sql
SELECT g.status, g.workflow_id
FROM release_gates g
JOIN task_graphs t ON t.workflow_id = g.workflow_id
WHERE t.graph_dag->'userContext'->>'projectId' = $1
ORDER BY g.created_at DESC, g.id DESC
LIMIT 1
```

- 조회 후 **status 검증**: `'passed'|'blocked'`가 아니면 `null` 반환(미지 값 fail-open).
- `userContext`가 null인 레거시 행은 JSONB 경로가 NULL → `= $1`에서 자동 탈락(fail-safe). SQL 변경 불필요.
- JSONB 경로 `graph_dag->'userContext'->>'projectId'`는 `task-graph.repo.ts` upsertGraph가 `userContext`를 top-level 조건부 spread로 저장하는 구조와 일치(검증).

### 2. `DecisionRepo.hasApprovedReleaseSignoff(workflowId)` — 사인오프 존재 조회 (신규)

`db/decision.repo.ts`에 추가(사인오프 읽기 메서드 부재라 신규).

```ts
hasApprovedReleaseSignoff(workflowId: string): Promise<boolean>
```

SQL — `sign_offs ⋈ human_decisions ⋈ decision_requests`, `scope='release'` + workflow 매칭 존재:

```sql
SELECT 1
FROM sign_offs s
JOIN human_decisions h ON h.decision_id = s.decision_id
JOIN decision_requests r ON r.request_id = h.request_id
WHERE r.workflow_id = $1 AND s.scope = 'release'
LIMIT 1
```

- 조인 체인 컬럼명(`sign_offs.decision_id`→`human_decisions.decision_id`·`human_decisions.request_id`→`decision_requests.request_id`·`decision_requests.workflow_id`)은 migration 011 FK·컬럼과 전부 일치(검증).
- `scope='release'`는 P5-2a `recordSignOff` 호출값과 일치(검증).
- 사인오프는 append-only·비부인(M9) → 존재 = 사람이 degraded 릴리스를 명시 수용한 증거.
- `MANAGER_RELEASE_SIGNOFF` off라 사인오프가 한 번도 없으면 항상 `false` → blocked는 blocked 유지(안전).

### 3. `DeployGatePort` + `evaluateDeployGate` + `ReleaseDeployGate` — 판정 경계 (신규·단일 파일)

`tools/deploy-gate.ts`(신규 단일 파일·CPD 0). `deploy_project`는 repo가 아닌 이 **좁은 포트**에만 의존(C0 `GraphQueryPort` 패턴 재사용).

```ts
export const PROJECTLESS_SENTINEL = 'default'   // Orchestrator의 프로젝트 미선택 마법 문자열

export interface DeployGateVerdict {
  allowed: boolean
  reason?: string   // 차단 시 tool_result 오류 메시지에 들어갈 사람 가독 사유
}

export interface DeployGatePort {
  /** 프로젝트의 배포 허용 여부. 절대 throw 안 함(N3) — 어떤 오류든 allowed=true(fail-open). */
  checkDeploy(projectId: string | undefined): Promise<DeployGateVerdict>
}

/**
 * 순수 결정론 판정 — 4분기(게이트/사인오프 차원).
 * hasApprovedSignoff는 gate.status==='blocked'일 때만 의미 있는 우회 수단 —
 * passed/null 경로에서는 평가하지 않는다(호출부가 false로 전달).
 */
export function evaluateDeployGate(input: {
  gate: { status: 'passed' | 'blocked'; workflowId: string } | null
  hasApprovedSignoff: boolean
}): DeployGateVerdict
```

`evaluateDeployGate` **순수 4분기**:
- `gate === null` → `{ allowed: true }`
- `gate.status === 'passed'` → `{ allowed: true }`
- `gate.status === 'blocked'` && `hasApprovedSignoff` → `{ allowed: true }`
- `gate.status === 'blocked'` && `!hasApprovedSignoff` → `{ allowed: false, reason: '릴리스 게이트가 BLOCKED(workflow {workflowId})이고 승인된 릴리스 사인오프가 없습니다. 차단 WP를 해소하거나 릴리스 사인오프(accept_known)를 받은 뒤 배포하세요.' }`

`ReleaseDeployGate implements DeployGatePort` — **구현체 2케이스**(projectId 가드·catch):
```ts
export class ReleaseDeployGate implements DeployGatePort {
  constructor(private gates: ReleaseGateRepo, private decisions: DecisionRepo) {}
  async checkDeploy(projectId: string | undefined): Promise<DeployGateVerdict> {
    if (!projectId || projectId === PROJECTLESS_SENTINEL) return { allowed: true }  // fail-open
    try {
      const gate = await this.gates.latestGateByProject(projectId)
      const hasApprovedSignoff =
        gate?.status === 'blocked'
          ? await this.decisions.hasApprovedReleaseSignoff(gate.workflowId)   // blocked일 때만 조회
          : false
      return evaluateDeployGate({ gate, hasApprovedSignoff })
    } catch (err) {
      console.warn('[deploy-gate] checkDeploy 실패 — fail-open 허용', err)
      return { allowed: true }                          // never-throw(N3)·fail-open(사인오프 조회 실패 포함)
    }
  }
}
```

### 4. `deploy-project.ts` 통합

`DeployProjectHandler` 생성자 **및 팩토리** 시그니처에 선택적 `gate?: DeployGatePort` 추가(둘 다 — 미추가 시 server.ts 배선이 TS 컴파일 실패). `execute`의 `_userContext` → `userContext`로 리네임(이제 적극 사용).

```ts
// 팩토리(server.ts가 호출) — 3번째 인자 optional 추가
export function createDeployProjectHandler(
  githubToken: string,
  redisUrl: string,
  gate?: DeployGatePort,
): ToolHandler<DeployProjectInput, DeployProjectOutput>

// execute 진입부(GitHub 작업 전)
async execute(input, _sessionId, userContext) {
  if (this.gate) {
    const verdict = await this.gate.checkDeploy(userContext?.projectId)
    if (!verdict.allowed) {
      throw new Error(`deploy_project 차단: ${verdict.reason}`)
    }
  }
  // ... 기존 GitHub push 로직 그대로 ...
}
```

- 포트 미주입(flag off) → 검사 자체 없음 → **회귀 0**(기존 테스트 6건이 2인자 호출 — 3번째 optional이라 그대로 통과).
- throw는 runner가 `is_error` tool_result(`Tool execution failed: ...`)로 변환 → Claude가 사유를 사용자에게 전달.
- 검사는 **사람 승인 게이트(isGatedTool) 통과 후** execute 진입부에서 실행(deploy 단일 chokepoint·자기완결). 사람 승인과 무관한 자동 하드 전제.

### 5. `MANAGER_DEPLOY_GATE` flag 배선

`config.ts` — 기존 `MANAGER_RELEASE_GATE`/`RELEASE_SIGNOFF`와 동일 패턴:
```ts
MANAGER_DEPLOY_GATE: z.string().optional().transform((v) => v === 'true'),
```

`server.ts` — `deployGate`를 **`if (config.GITHUB_TOKEN)` 블록 밖에서 선언**, 블록 안 register에 주입. 기존 `releaseStore`(P5-1)·`decisionStore`(P6)를 **재사용**하되 미생성 시 `??`로 즉석 생성(deployGate 브랜치가 `pool && ... MANAGER_RELEASE_GATE`로 가드돼 **pool truthy 보장**):
```ts
const deployGate =
  pool && config.MANAGER_DEPLOY_GATE && config.MANAGER_RELEASE_GATE
    ? new ReleaseDeployGate(
        releaseStore ?? new ReleaseGateRepo(pool),
        decisionStore ?? new DecisionRepo(pool),
      )
    : undefined
// ... if (config.GITHUB_TOKEN) { ... registry.register(createDeployProjectHandler(config.GITHUB_TOKEN, config.REDIS_URL, deployGate)) }
```
- 전제: `MANAGER_RELEASE_GATE`(게이트가 기록돼야 검사 의미) + `DATABASE_URL`(pool).
- `MANAGER_DEPLOY_GATE`만 켜고 `RELEASE_GATE` off → 게이트 미기록 → 항상 `null` → 항상 허용(무해·무의미) → `app.log.warn` 경고(기존 RELEASE_SIGNOFF 전제 경고 패턴).
- **이벤트 발행 0**(읽기 전용 게이트) → `OutboxRelay` 기동 조건에 **추가하지 않음**.

## 보장 (설계 노트)

- **게이트·사인오프 동일 workflow 정합**: `hasApprovedReleaseSignoff`는 `latestGateByProject`가 반환한 `workflowId`로만 조회한다 → 다른 workflow의 사인오프가 교차 적용되지 않는다.
- **M9 권위**: 차단 우회의 유일 근거는 append-only·비부인 사인오프다. 우회 플래그·클라이언트 입력으로 게이트를 무력화할 수 없다(단, `MANAGER_DEPLOY_GATE`/`RELEASE_GATE` 비활성 시 게이트 검사 자체 없음 — 폐루프는 `RELEASE_GATE`+`RELEASE_SIGNOFF`+`DEPLOY_GATE` 동시 활성 필요).

## 알려진 한계 (스펙 명시·후속)

1. **다중 workflow 정밀도**: 한 프로젝트가 여러 번 분해됐다면 `latestGateByProject`는 **최신 게이트**를 반환. 배포 코드와 정확히 동일하다는 보장은 아님(best-effort). 특히 `T1=blocked`·`T2(다른 workflow)=passed` 순이면 최신=passed → **허용 방향 오분류** 가능. 정밀화(deploy 입력에 workflowId 명시)는 후속.
2. **catch 범위 = 사인오프 조회 실패 포함**: `checkDeploy` catch는 `latestGateByProject`뿐 아니라 `hasApprovedReleaseSignoff` 실패도 잡는다 → **blocked 게이트가 실재해도 DB 장애 중에는 fail-open 허용**. fail-open 설계의 의도된 트레이드오프.
3. **`'default'` sentinel**: Orchestrator의 프로젝트 미선택 세션은 `projectId='default'`로 도달 → 게이트는 부재와 동일 취급(허용). `'default'`로 분해된 워크플로의 blocked 게이트는 적용되지 않는다(Manager-only 흡수·Orchestrator 변경 0). Orchestrator가 향후 undefined를 보내면 sentinel 가드는 무해하게 잔존.
4. **TOCTOU**: §배경 참조.
5. **자율 파이프라인 배포**: 현재 task-graph에 deploy WP 역할 없음(`server.ts` WORKER_TOOL_NAMES에 `deploy_project` 미포함 — 배포는 LLM 루프 전담). 자율 파이프라인이 직접 배포하게 되면 동일 포트 적용 필요(후속).

## 불변식

- **fail-open(N3)**: `checkDeploy`는 절대 throw 안 함(projectId 부재/`'default'`·게이트 부재·조회 오류 모두 `{allowed:true}`).
- **차단 = execute throw**: 실제 배포 거부는 `deploy_project.execute`의 throw로만(게이트 포트는 verdict만 반환). 두 계층 분리.
- **회귀 0**: `MANAGER_DEPLOY_GATE` off(또는 pool/RELEASE_GATE 부재) → 포트 미주입 → `deploy_project` 바이트 동일.
- **결정론**: `evaluateDeployGate`는 순수 함수(LLM·IO·시계 0)로 **4분기 전수** 단위 테스트. projectId 부재·조회 오류 2케이스는 `ReleaseDeployGate.checkDeploy` 단위 테스트.

## 테스트 전략

1. **`evaluateDeployGate` 순수 단위 4분기**(신규 `tools/deploy-gate.test.ts`): null/passed/blocked+signoff/blocked+no-signoff. reason에 workflowId 포함 확인.
2. **`ReleaseDeployGate.checkDeploy` 단위**(stub repos): projectId undefined → allowed·projectId `'default'` → allowed·repo throw 주입 → allowed(fail-open)·signoff 조회 throw → allowed·blocked+signoff true → allowed·blocked+signoff false → blocked.
3. **`latestGateByProject` DB 통합**(skip-if-no-DB·prefix 격리). 시드 예시:
   ```sql
   INSERT INTO task_graphs (workflow_id, graph_dag, version, created_at, updated_at)
   VALUES ($1, jsonb_build_object('workPackages','[]'::jsonb,'userContext',jsonb_build_object('projectId',$2)), 1, NOW(), NOW());
   INSERT INTO release_gates (workflow_id, gate_version, status, per_wp, blocking_reasons, created_at)
   VALUES ($1, $3, 'blocked', '[]'::jsonb, '[]'::jsonb, NOW());
   ```
   케이스: 단일 게이트 반환·미존재 → null·**같은 projectId·다른 workflowId 2행 → 최신(created_at,id) 반환**·미지 status 행 → null.
4. **`hasApprovedReleaseSignoff` DB 통합**: decision_requests+human_decisions+sign_offs(scope='release') 시드 → true·scope 불일치 → false·workflow 불일치 → false.
5. **`deploy-project` 통합**: 포트 stub 주입 시 blocked → execute throw(GitHub 호출 0)·allowed → 기존 경로·**포트 미주입 → 회귀 0**(기존 6 테스트 그대로 통과).

## 전역 제약 (Global Constraints)

- TypeScript 5 strict. pnpm 전용. 모든 변경 **additive**(기존 시그니처·동작 보존·3번째 인자 optional).
- 새 migration 없음(`release_gates`/`sign_offs`/`task_graphs` 기존). `status` 두 값(`passed`/`blocked`)만 유효·그 외 → null.
- 새 flag `MANAGER_DEPLOY_GATE`(기본 false·전제 `MANAGER_RELEASE_GATE`+`DATABASE_URL`). off면 회귀 0.
- `checkDeploy`는 **절대 throw 안 함**(N3). 차단은 `deploy_project.execute`의 throw로만.
- `ReleaseDeployGate`·`DeployGatePort`·`evaluateDeployGate`·`PROJECTLESS_SENTINEL`은 **단일 파일 `tools/deploy-gate.ts`**(CPD 0).
- 커밋 메시지 한국어·말미 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Orchestrator/C1 변경 0. 이벤트 발행 0(읽기 전용 게이트).
- jscpd 0 clones·SonarCloud QG(신규 커버 80%·D-Reliability 함정: `| 0`·무비교자 `.sort()`·인지복잡도).
