# xzawedPAIS Technical Analysis Report

> **작성:** Grok (xAI) — `grok_build_delegate` 위임(read-only·저장소 코드 무변경).
> **검증:** Claude Code가 핵심 인용을 실파일로 대조 — ADR-001 실존 ✓, 마이그레이션 데드락 재시도(pool.ts·#403) ✓, 무인증 mutation 라우트(server.ts:644-649·#406) ✓, #402/#407/deploy-gate fail-open/lease 300s 미스매치 등 실질 주장 정확. **경미한 수치 편차**(측정 시점 차): 통합 테스트 "~24"→실제 30, server.ts "685"→721, runner.ts "675"→725(대형 파일 요지는 유효).

**Date:** 2026-07-18  
**Scope:** Read-only analysis of `D:\Source\xzawed-pais` (master @ `9e3a711`)  
**Method:** CLAUDE.md / docs vs. source verification (no builds, tests, or installs)

---

## 1. Executive Summary

xzawedPAIS is a TypeScript monorepo for an AI multi-agent orchestration platform: a user describes intent in natural language, and specialized Claude-backed agents (plan → develop → design → test → build → security → watch) collaborate under a central Manager. Agent-to-agent *message* traffic is designed to go only through Redis Streams (`docs/development/adr/001-redis-streams-only.md`); control-plane UI proxies (knowledge, decisions) use HTTP from Orchestrator → Manager (`MANAGER_URL`), so the “Redis-only” rule is true for the agent data plane and **not** absolute for the control plane.

Overall engineering quality is **high for a research/product hybrid**: strict TS, Zod at boundaries, extensive pure-core extraction (shared decomposition/risk/oracle-DoR), transactional outbox, WP leases, multi-channel verification, and deliberate fail-closed defaults on correctness paths. The biggest strength is **principled composability**—flags default `false`, incomplete flag combos log stall warnings (`server.ts` ~278–425), and “off → byte-identical regression” is a real invariant.

The biggest risks are (1) **operational complexity**: ~30 boolean `MANAGER_*` / `TASK_MANAGER_*` / `EVENT_SOURCED_*` knobs, almost all default off, so the autonomous Task Graph arc is **dormant in default deploys**; (2) **doc/status density**—root `CLAUDE.md` describes an enormous “done” surface that is code-complete but flag-gated, inviting false confidence; (3) **auth tiering**—knowledge/oracle/risk mutations stay open when `SERVICE_JWT_SECRET` is unset (`server.ts` ~644–649); (4) **correctness escape hatches**—deploy gate fail-open-on-absence (`deploy-gate.ts:34,57-68`) and lease visibility vs. multi-channel verify duration mismatch (documented in `config.ts` ~77–88, `server.ts` ~316–367). Health of the **live default path** (Orchestrator chat + Manager Claude tool-loop) is good; health of the **full autonomous pipeline** depends on a carefully assembled flag stack that is easy to misconfigure.

---

## 2. Architecture & Design

### 2.1 Intended shape

| Layer | Port / role | Primary sources |
|---|---|---|
| Orchestrator | 3000 — Electron app + Fastify, sessions, UI, C1 decisions inbox | `xzawedOrchestrator/` |
| Manager | 3001 — Claude tool-calling runner + Task Manager Supervisor | `xzawedManager/packages/server/src/` |
| Shared lib | `@xzawed/agent-streams` | `xzawedShared/src/` |
| Agents | 3002–3008 Planner…Security | independent packages |
| Launcher | Docker Compose UX | `xzawedLauncher/` |

Stream key convention (documented and used): `{from}:to-{to}:{sessionId}` with consumer group `{to}-consumers` (root `CLAUDE.md`, ADR-001).

### 2.2 Dual runtime paths (critical)

There are **two** execution architectures coexisting:

1. **Interactive tool-loop (default, always wired)**  
   Orchestrator `task_request` → Manager `ClaudeRunner` (`claude/runner.ts`, ~675 lines) → Redis RPC to agent tools (`tools/redis-agent-handler.ts`) → approval gate (`gates/approval-gate.ts`) → domain wiki inject/store. This is the production-proven path.

2. **Autonomous Task Graph (flag-gated, C6 entry)**  
   UI `mode:'build'` + `ORCHESTRATOR_DECOMPOSE_ENABLED` → `decompose_request` (`sessions.route.ts:111–140`) → Manager `MANAGER_DECOMPOSE_ENABLED` multi-stage LLM decompose → outbox `decomposition.emitted` → Supervisor (`streams/supervisor.ts`) → dispatch/lease/worker → verify → completion re-dispatch → (optional) release gate / decisions.

C6 is correctly isolated: chat remains byte-identical when decompose is off (`shouldDecompose` pure gate; tests in `sessions-decompose-route.test.ts`).

### 2.3 Redis Streams + EventBus + Outbox

- Shared `BaseConsumer` (`xzawedShared/src/streams/base-consumer.ts`): Zod parse, bounded retries, DLQ via `routeToDlq`, idempotent consume (`SHARED_IDEMPOTENT_CONSUME`, 24h TTL), XAUTOCLAIM reclaim of idle PEL.
- Manager uses transactional outbox (`db/event-store.ts`, `streams/outbox-relay.ts`, `createOutboxPublish`) so DB truth and Redis emit stay aligned (M5/M7).
- **OutboxRelay wiring is carefully broad** (`server.ts:217–233`): starts if *any* outbox-producing flag is on (session ES, task manager, oracle, decompose, advisory, decision routing, release, risk routing, golden, etc.). Comment history shows prior bugs where rows stuck with `published_at=NULL`—team has internalized this failure mode.

### 2.4 Task Graph abstractions

Sound pure cores live in shared:

- WorkPackage schema, content-hash id stability (N4), risk tiers (`types/work-package.ts`)
- Graph readiness / topo (`task-graph/`)
- `oracleSatisfiedSet` DoR (`task-graph/oracle-dor.ts`)
- Risk scoring (`risk/risk-classification.ts`)
- Budget / provider circuit / bulkhead / operational-mode (`budget/`, `resilience/`)

Manager owns IO orchestration: `TaskGraphRepo`, `LeaseStore` (CAS attempt + visibility timeout), `handleDispatch`, `WorkerConsumer`, multi-channel `verifyWp`.

**Abstraction soundness:** Strong separation of pure functions vs. wiring is a real strength. **Leaky boundaries:** (a) `server.ts` (~685 lines) is a composition root that knows every feature’s prerequisite graph; (b) worker verification reuses agent handlers as ground truth—good for realism, expensive and lease-sensitive; (c) Orchestrator HTTP proxy for Manager REST APIs couples UI latency/auth to Manager’s HTTP surface outside Redis.

### 2.5 Does “ONLY Redis” hold?

| Path | Mechanism | Verdict |
|---|---|---|
| Agent RPC (plan/develop/…) | Redis Streams | Holds |
| Manager ↔ agents collaboration queries | Redis via Manager | Holds |
| Orchestrator → Manager tasks | Redis Streams | Holds |
| Knowledge / decisions / oracle UI | HTTP `fetch(MANAGER_URL…)` | **Exception** — intentional control plane |
| Manager `register_project` / project RPC | Redis request-reply | Holds |
| Shared package | `file:../xzawedShared` import | **Not service coupling**; build-time dep. Stale `node_modules` copies are a local footgun (`scripts/sync-shared.sh`, recent #405) |

No cross-service *runtime* TypeScript imports of another service’s `src/` were found; agents import only `@xzawed/agent-streams`. ADR-001 is accurate for agent messaging; docs should state the HTTP control-plane exception explicitly.

### 2.6 Doc vs code drift (architecture)

- Root service table still embeds phrases like “미배선” for historical P1d slices while also documenting Supervisor wiring under `TASK_MANAGER_ENABLED`. **Code reality:** handlers exist and are wired when flags + `DATABASE_URL` are set (`shouldWireSupervisor`, `createSupervisor` in `server.ts:427+`). “미배선” in the dense one-liner is **stale relative to flag-gated wiring**.
- Status counts (~763 Orchestrator tests, Manager 1149/1231, Shared 282/282) are documentation claims; not re-executed in this analysis. Recent commits (#395–#408) show active hardening of observability and flakes—consistent with a mature CI culture.

---

## 3. Code Quality & Maintainability

### 3.1 TypeScript & modules

- Strict TS across services; Zod for env (`config.ts`) and message schemas.
- Clear package boundaries: Orchestrator monorepo (`app`/`server`/`ui`/`web`), Manager `packages/server`, independent agents with nearly identical stream consumer/producer skeletons via shared collaboration helpers.
- Tests co-located (`*.test.ts`) with pure functions exported for unit testing (e.g. `judgePrimaryResult`, `planReclaim`, `evaluateDeployGate`).

### 3.2 Complexity hotspots

| File | ~LOC | Role / risk |
|---|---|---|
| `server.ts` | 685 | Flag dependency graph, repo construction, stall warnings, route registration |
| `claude/runner.ts` | 675 | Tool loop, approval gate, AgentQuery re-entry, budget/provider hooks |
| `streams/supervisor.ts` | 548 | Consumer composition, dispatch, sweeper glue |
| `streams/verify.ts` | 336+ | Multi-channel hard-AND verification |
| `streams/worker.ts` | 319 | Dispatch signal → agent execute → verify → complete |

These are manageable but **cognitively heavy**: onboarding requires understanding flag prerequisites, not just modules. The team mitigates with pure helpers (`shouldWire*`, warning extractors) and extensive comments citing senario norms (M8, N1, N3, N6, N7).

### 3.3 Feature-flag surface

`config.ts` defines on the order of **~30 boolean feature flags** (all default **false** unless noted), plus numeric knobs (lease visibility, mutation θ, budgets). Categories:

- Core autonomy: `TASK_MANAGER_ENABLED`, `MANAGER_DECOMPOSE_ENABLED`, `MANAGER_TASK_WORKER`
- Verification: `MANAGER_WP_VERIFY`, `CONFORMANCE`, `IMPACT`, `PROPERTY`, `MUTATION`, `SECURITY`, `ADVISORY`
- Human decisions: `DECISION_BRIEF`, `DECISION_ROUTING`, `DECISION_EXPIRY`, `RISK_*`, `ORACLE_*`, `GOLDEN_SIGNOFF`, `RELEASE_*`, `DEGRADED_*`
- Resilience: `MANAGER_PROVIDER_CIRCUIT`, budget USD caps, bulkhead caps
- Session: `EVENT_SOURCED_SESSION`

**Maintainability impact:** Excellent for incremental merge safety; poor for “turn on product.” Partial enables produce silent no-ops unless warnings fire—warnings exist and are a best practice, but ops still needs a matrix doc or preset.

### 3.4 Over-engineering signals

- Full mutation testing harness gated for HIGH risk only, default off—sophisticated, rarely live.
- Operational mode FSM (observe → enforce SAFE hold → DEGRADED HIGH-risk signoff) is production-grade ops design for a system that may still run mostly as a chat tool-loop.
- Multiple DecisionRequest types reusing C1 UI (defect_brief, risk_classification, oracle_approval, golden_diff, degraded_release, degraded_dispatch) is elegant reuse **if** decisions are the product UX; otherwise it multiplies dormant code paths.

Not over-engineered for the stated *senario* vision; **overbuilt relative to default-runtime usage**.

---

## 4. Resilience & Correctness

### 4.1 Verification channels (`streams/verify.ts`)

| Channel | Flag | Ground truth | Blocking |
|---|---|---|---|
| Primary result | always in verify path | Zod-minimal `success`/`failed`/`passed` (no handler defaults) | Yes |
| Derived build+test | develop_code | Real builder/tester re-run | Yes |
| Conformance | `WP_CONFORMANCE` | Approved GWT oracles → authored tests | Yes |
| Impact | `WP_IMPACT` | Frozen golden_refs (N7 after golden signoff) | Yes |
| Property | `WP_PROPERTY` | Approved invariants | Yes |
| Mutation | `WP_MUTATION` | Self-mutated harness, θ score | Yes (HIGH+) |
| Security | `WP_SECURITY` | Deterministic SAST static+deps only (LLM issues excluded N6) | Yes |
| Advisory | `WP_ADVISORY` | LLM suggestions | **Never** (N3) |

`judgePrimaryResult` fail-closes on parse failure and vacuous `passed<=0` (`verify.ts:56–67`)—directly addresses empty-suite false passes (P4b-3).

### 4.2 Fail-closed vs fail-open (where silent breakage can happen)

| Mechanism | Policy | Silent-break risk |
|---|---|---|
| WP verify fail | No completion → lease expire → reclaim/escalate | Visible if brief flag on; else escalate without human brief |
| Approval gate fail-safe | Unknown decision → re-ask human (`MANAGER_GATE_FAILSAFE` default true) | Low |
| Deploy gate | **Fail-open** if no gate / error / `projectId==='default'` | **Can deploy without release proof** if gate never ran |
| Conformance without oracleStore | Skip channel (not brick) | Soft-open if operators expect blocking |
| Risk unapproved | wp.risk stays default MEDIUM → mutation never fires | Documented structural death before P2r-4; fixed only when risk routing approved |
| Decompose publish fail (chat) | Non-blocking skip | Chat still “done”; build path fixed in #402 to not disguise drop as done |
| Advisory / risk classify / many onEscalated | best-effort never-throw | Observability-dependent |
| Outbox relay not started | Events never leave DB | Mitigated by broad start conditions + docs |

### 4.3 DLQ & idempotency

- Shared DLQ contract + `redriveDlq` (`xzawedShared/src/streams/dlq.ts`); admin redrive requires authHook (`admin.route.ts`, registered only if JWT secret set).
- Manager inbound consumers gained G2 DLQ parity (#335 docs)—poison isolation without infinite retry.
- Idempotency: consumer dedup keys, lease PK, DecisionRequest deterministic requestIds, ON CONFLICT create patterns.

### 4.4 WP lease / reclaim / escalate

`lease.ts`: pure `planReclaim` → reclaim (attempt++) or escalate at max; CAS skip for concurrent sweeps; optional `onEscalated` defect brief; `renewLease` heartbeat path exists for long verifies. **Default visibility 300s** vs verify chains that can need 360–600s+ of agent work is the main correctness/ops hazard (false reclaim, wasted work—partially absorbed by DONE guards but still costly).

---

## 5. Security Posture

### 5.1 Command execution (Builder / Tester)

- **Real defense:** `spawn(bin, args, { shell: false })` (`builder/executor.ts:73–76`, tester `executor.ts:46`).
- **Defense-in-depth:** allowlists (`builder.ts:21–40` prefixes + metachar/`\n` block; `tester.ts:14–27` similar). Comments honestly admit build agents must run arbitrary toolchains—`npx`/`npm` remaining broad is intentional (#407).
- Path: `validatePath` + `validateWorkspaceRoot` reject FS root and path escape (`executor.ts:13–23`, shared `workspace-guard.ts`).

### 5.2 Authn/z on mutation routes (Manager)

| Surface | Without `SERVICE_JWT_SECRET` | With secret |
|---|---|---|
| Knowledge PATCH/DELETE | **Open** | Write protected; GET always open |
| Oracle create/approve | **Open** | Write protected |
| Risk approve | **Open** | Write protected |
| Admin DLQ redrive | **Not registered** (fail-closed) | Auth required |
| Decision POST | **Not registered** if routing on without auth | Auth + projectId IDOR 404 |
| Sessions (some) | Optional authHook | When configured |

`server.ts:644–649` logs an explicit warning when mutations are unauthenticated—“oracle-tier / local demo” by design. Production **must** set JWT; docs say so, defaults do not force it.

Orchestrator knowledge proxy uses write preHandlers and forwards manager write headers (`knowledge.route.ts`); still depends on Manager enforcing JWT.

### 5.3 Electron IPC

- `contextBridge` exposes `electronAPI` only (`preload/index.ts`).
- `shell.openExternal` gated to GitHub OAuth URL prefix (`github-oauth-handler.ts:138–142`).
- Settings/auth restore URL protocol restricted to `http:`/`https:` (`main/index.ts:108`, `168`).
- Tokens handled in main process handlers (`token:set`, etc.)—aligns with stated IPC rules.

### 5.4 SSRF

- `http-remote-runner.ts` rejects non-http(s) protocols.
- OAuth openExternal prefix check as above.
- Manager URL is config-driven; not user-controlled URL open redirect in the same way—proxy builds URLs from `MANAGER_URL` + path segments (ensure projectId path encoding stays sanitized—worth ongoing review).

### 5.5 Residual risks

- Allowlisted `npm`/`npx` still runs package scripts of the **user project** (inherent agent risk).
- Unauthenticated Manager on a reachable network is high severity (mitigated by Docker network isolation assumptions).
- Decision `decidedBy` non-repudiation relies on Orchestrator JWT subject when wired correctly (#306)—service-token path for oracle approve is weaker (client-supplied `approvedBy` historical path).

---

## 6. Testing

### 6.1 Shape

- **Unit-heavy:** Manager `src/**/*.test.ts` (~100 files), pure cores in Shared (282/282 claimed), agents with focused suites.
- **pg integration:** ~24 `*.integration.test.ts` under Manager, gated by `TEST_DATABASE_URL ?? DATABASE_URL` + `describe.skipIf(!url)`.
- **CI:** `.github/workflows/ci.yml` — Turborepo matrix (Orchestrator, Manager) with Postgres service, vitest **shard 1/2 + 2/2**, manual lcov merge (`cat coverage/shard-*/lcov.info`); independent agents after shared-lib build; Playwright E2E job exists for Electron; audit at moderate.
- Local Manager: 82 skips without DB (doc claim); CI injects `TEST_DATABASE_URL` so integrations actually run (fix for earlier “never ran in CI” bug noted in Manager CLAUDE.md).

### 6.2 Known flakes & mitigations (code-backed)

| Issue | Mitigation | Ref |
|---|---|---|
| Migration deadlock `40P01` / serialization `40001` | Advisory lock + per-file retry backoff (max 5) | `db/pool.ts:20–52`, #403 |
| oracle-loop rare flake | Bounded retry (2) in test | #401 |
| Parallel test cross-delete | Prefix-scoped cleanup (`wf-comp-`, `wf-orc-`, …) | Manager CLAUDE.md |
| Redis mock OOM | setImmediate yield pattern | root CLAUDE.md |
| ioredis reconnect in vitest | `retryStrategy: null` when `VITEST` | root CLAUDE.md |

### 6.3 Coverage gaps (inferred)

- **Full multi-flag E2E** of build mode → decompose → all verify channels → release → deploy is unlikely to be one integrated runtime test (unit/integration slices exist; end-to-end autonomy is expensive and flag-combinatorial).
- Mutation/security channels unit-tested; real mutation score economics uncalibrated in prod.
- Electron E2E constrained (no real WebSocket abort, MemoryRouter, i18n testid discipline)—documented and generally followed.
- Independent agents’ shared copy staleness can make local tests green against outdated shared dist until `sync-shared.sh`.

---

## 7. Technical Debt & Risk

### 7.1 Dormant / flag-gated product surface

Default deploy (all flags false, optional no `DATABASE_URL`):

- Chat + tool-loop + approval gate + optional wiki (if DB) works.
- **No** Supervisor, **no** decompose producer, **no** worker, **no** multi-channel verify, **no** decision inbox data from Manager defect briefs.

Documented features in root `CLAUDE.md` service table read like a shipping product description; they are better understood as **merged, test-backed, flag-off modules**.

### 7.2 Minimum flags for autonomous Task Graph arc (end-to-end)

**Minimal “it runs agents from a build intent”:**

1. `ORCHESTRATOR_DECOMPOSE_ENABLED=true` (Orchestrator)
2. `DATABASE_URL` (Postgres)
3. `MANAGER_DECOMPOSE_ENABLED=true`
4. `TASK_MANAGER_ENABLED=true`
5. `MANAGER_TASK_WORKER=true`
6. Agents + Redis up; workspace paths valid

**Meaningful correctness (recommended floor):**

7. `MANAGER_WP_VERIFY=true`  
8. Raise `MANAGER_LEASE_VISIBILITY_MS` ≥ 360000 (600000 if conformance+)  
9. `SERVICE_JWT_SECRET` (≥32) for decisions/admin and locked mutations  

**Human DoR / C1 loop (oracles, risk, defects):**

10. `MANAGER_ORACLE_DRAFT` + optionally `MANAGER_ORACLE_DOR` + `MANAGER_ORACLE_DECISION`  
11. `MANAGER_DECISION_BRIEF` + `MANAGER_DECISION_ROUTING`  
12. `MANAGER_RISK_CLASSIFY` + `MANAGER_RISK_ROUTING` (+ `MANAGER_RISK_DECISION` for UI)

**Full vision stack** additionally: conformance/impact/property/mutation/security, release gate + signoff, deploy gate, golden signoff, degraded mode/enforce/signoff, model routing, budget/provider circuits, event-sourced sessions, decision expiry.

Rough count: **~5 flags + DB** to move WPs; **~12–15** for a serious autonomous product path; **20+** for the full CLAUDE.md narrative.

### 7.3 Dead-ends & inconsistencies

- **CLAUDE.md “미배선”** wording vs flag-wired Supervisor: docs lag cleanup.
- **Deploy gate fail-open** vs **release gate fail-closed-on-absence**: intentional but easy to misread as “deploy always gated.”
- **Mutation channel** structurally needs risk HIGH write-back; without risk approval chain it is mostly dead weight.
- **Golden freeze Slice 1** requires human-seeded goldens; auto-capture is “Slice 2” (documented)—impact channel weak until then.
- **Chat vs Build** cognitive split for users (UI mode toggle #339) is good; operators still need dual mental models for debugging.

### 7.4 Process debt

- Massive `docs/superpowers/` + `docs/senario/` corpus is high-quality but can diverge from flags; CLAUDE.md is the living summary and is already enormous (risk of rot).
- Recent work (#397–#408) correctly prioritizes observability of silent stalls—directionally right.

---

## 8. Top Prioritized Recommendations

1. **Ship a named “preset” / profile for autonomy (e.g. `PAIS_PROFILE=autonomous-v1`)** that expands to the validated minimal flag matrix + lease visibility + JWT requirement.  
   - **Rationale:** Today correct E2E requires 5–15 interdependent envs; misconfig yields silent stalls despite good warnings.  
   - **Effort:** M · **Risk:** Low if presets only enable known combinations.

2. **Collapse or version the flag surface; delete or archive permanently dormant experimental paths.**  
   - **Rationale:** 30 booleans tax every change and review; several channels are research-grade.  
   - **Effort:** L · **Risk:** Medium (regression if something production-unknown is on).

3. **Harden production auth defaults: refuse to start Manager mutation-capable HTTP without `SERVICE_JWT_SECRET` when `MODE=remote` (or always outside local).**  
   - **Rationale:** Open knowledge/oracle/risk writes are documented but still a footgun.  
   - **Effort:** S · **Risk:** Low if local-dev escape hatch remains.

4. **Align lease visibility defaults with verify enablement** (auto-bump when `WP_VERIFY`/`CONFORMANCE` on, or fail startup if visibility too low).  
   - **Rationale:** Warnings alone don’t prevent false reclaim under load.  
   - **Effort:** S · **Risk:** Low.

5. **Document and enforce the dual-plane networking story (Redis data plane + HTTP control plane)** in ADR-001 addendum; add SSRF/path tests for proxy URL construction.  
   - **Rationale:** Architectural truth ≠ marketing “Redis only.”  
   - **Effort:** S · **Risk:** Low.

6. **One true integration E2E (flag profile on) for build mode → one develop_code WP → verify → done**, run in CI nightly if too slow for PR.  
   - **Rationale:** Unit slices don’t catch outbox/supervisor/worker composition bugs.  
   - **Effort:** M–L · **Risk:** Medium (flakes, cost).

7. **Revisit deploy-gate fail-open** for `MODE=remote`: fail-closed when release gate feature is enabled but no gate row exists for project.  
   - **Rationale:** Current policy optimizes chat/demo deploy; weakens P5 narrative.  
   - **Effort:** S · **Risk:** Medium (breaks demo flows).

8. **Trim root CLAUDE.md service blurb; link to a “Live vs Flagged” matrix** so agents/humans stop treating dormant modules as default runtime.  
   - **Rationale:** Doc density is itself an operational risk.  
   - **Effort:** S · **Risk:** None.

---

## Appendix A — Key file map

| Concern | Path |
|---|---|
| Flag schema | `xzawedManager/packages/server/src/config.ts` |
| Composition root | `xzawedManager/packages/server/src/server.ts` |
| Tool loop | `xzawedManager/packages/server/src/claude/runner.ts` |
| Supervisor | `xzawedManager/packages/server/src/streams/supervisor.ts` |
| Verify | `xzawedManager/packages/server/src/streams/verify.ts` |
| Lease | `xzawedManager/packages/server/src/streams/lease.ts` |
| Deploy gate | `xzawedManager/packages/server/src/tools/deploy-gate.ts` |
| C6 decompose publish | `xzawedOrchestrator/packages/server/src/api/sessions.route.ts` |
| Shared consumer/DLQ | `xzawedShared/src/streams/base-consumer.ts`, `dlq.ts` |
| Builder harden | `xzawedBuilder/src/builder.ts`, `executor.ts` |
| CI sharding | `.github/workflows/ci.yml` |
| Redis ADR | `docs/development/adr/001-redis-streams-only.md` |

## Appendix B — Verdict

xzawedPAIS is a **serious, well-tested multi-agent control plane** with unusually strong attention to silent-failure modes (M8), idempotency, and reversible feature delivery. Its primary risk is not sloppy code—it is **complexity concentration and default dormancy**: the system documented as an autonomous organization is, by default, a careful chat orchestrator with a large, high-quality dormant nervous system waiting for operators to throw the right set of switches.
