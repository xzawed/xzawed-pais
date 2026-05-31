# 서비스 에이전트별 SKILL/HOOK 권고 — 멀티에이전트 논의 결과

- 작성일: 2026-05-31
- 입력: [설계](2026-05-31-agent-skills-hooks-design.md) · [deep-research raw](2026-05-31-deep-research-skills-hooks-raw.json) · [서비스 분석 raw](2026-05-31-service-analysis-raw.json)
- 방법: deep-research(107 에이전트, 25 claim 3-0 검증) → 10개 서비스 병렬 분석 + 심사 + 적대적 검증(15 에이전트)

## 1. 실행 요약

10개 서비스 분석으로 트랙A(개발 보조 `.claude/`) 41건 + 트랙B(런타임 기능) 40건 후보를 도출하고, deep-research 근거로 심사·중복제거·적대적 검증했다. 결과는 4개 군으로 수렴한다:

- 트랙A: ① cross-file 계약 드리프트 진단, ② 경로/명령 보안 감사, ③ 파서 회귀 가시화, ④ 규칙/스캐폴드 생성
- 트랙B: ① publish-직전 자가검증 루프, ② spawn-직전 권한 게이트, ③ preload 도메인 지식, ④ 부하/용량 제어

## 2. 이번 PR 반영 (구현 4건)

검증을 통과한 **읽기전용·저위험** 항목만 구현했다.

| 항목 | 종류 | 적용 | 근거 |
|---|---|---|---|
| `/contract-drift-check` | 신규 커맨드 | Planner·Designer·Manager·Orchestrator | agentType enum이 5곳(types.ts·runner.ts z.enum·SYSTEM_PROMPT 프로즈·Manager plan-task.ts)에 비연결 복제 → tsc 교차검증 불가. IPC 채널 문자열 3자 계약도 동일 |
| `/dev-path-guard-audit` | 신규 커맨드 | Developer·Builder·Tester | validatePath·validateWorkspaceRoot·spawn(shell:false)·ALLOWED_PREFIXES·셸 메타문자 정규식 보안 불변식 정적 점검 |
| `check-i18n.js` ui.json 추가 | 기존 자산 확장 | Orchestrator | CHECKS 배열에 `ui/ui.json` 누락 → @xzawed/ui 파리티 미검증 사각지대(16키)였음 |
| `mock-guard.mjs` xautoclaim 추가 | 기존 자산 확장 | 전 서비스 테스트 | `xautoclaim.mockResolvedValue(null)` OOM 패턴 감지 1줄 추가 |

두 커맨드 모두 `allowed-tools`를 Read/Grep/Glob/git로 제한한 읽기전용 advisory다. 부작용이 없어 `disable-model-invocation`은 불필요(필요 시 Claude가 자동 호출 가능). 보고만 하고 수정은 사용자 판단에 맡긴다.

## 3. 트랙A 우선순위표 (제안·보류)

`implement`(구현) 4건 중 2건은 검증 강등(아래 §5). 나머지는 제안/보류.

### propose — 가치 있으나 노력/위험으로 후속 검토

| 후보 | 종류 | 서비스 | V/R/E | 요지 |
|---|---|---|---|---|
| `hook:redis-xack-guard` | hook(비차단) | Manager·Shared | 5/2/4 | streams 편집 시 handler가 try/finally xack로 감싸졌는지 정적 점검 (PEL 누수 방지) |
| `/mcp-sec-audit` | command | Orchestrator | 4/1/2 | MCP/CLI/원격러너 보안 allowlist 불변식 체크리스트 |
| `/plan-dag-check` | command | Planner | 4/1/3 | Step[] 의존성 DAG 사이클·고아 노드 검증 |
| `/designer-prompt-eval` | command | Designer | 4/1/3 | 디자인 프롬프트 출력 스키마 정합성 평가 |
| `/dev-parse-fixtures` | command | Developer | 4/1/3 | 코드 생성 파서 회귀 픽스처 |
| `/watcher-chokidar-audit` | command | Watcher | 4/1/2 | chokidar glob·debounce 설정 감사 |
| `hook:trigger-glob-dual-guard` | hook(비차단) | Watcher | 5/2/2 | trigger glob 절대경로·`..` 이중 검증 |
| `hook:hardcoded-i18n-guard` | hook(비차단) | Orchestrator | 4/2/2 | .tsx 편집 시 하드코딩 한글 리터럴 탐지 |
| `hook:builder-detector-script-trust-guard` | hook(비차단) | Builder | 4/2/2 | package.json scripts 신뢰 실행 방지 |
| `/runner-loop-review` | command | Manager | 3/1/2 | tool-calling 루프 가드(stop_reason·MAX_ITERATIONS) 점검 |
| `/new-agent-tool` | command | Manager | 4/2/3 | RedisAgentHandler 팩토리 스캐폴드 (**disable-model-invocation:true 필수** — 파일 생성 부작용) |

### defer — 기존 자산과 중복 또는 빈도 낮음

`hook:stream-key-lint`, `hook:consumer-signature-guard`, `hook:redis-mock-yield-guard`(→ mock-guard 흡수됨), `hook:shared-build-then-dependents`·`hook:dev-shared-prebuild`(→ post-edit.mjs와 중복), `hook:designer-contract-guard`·`hook:plan-schema-drift-guard`·`hook:tester-cmd-guard-consistency`(→ PostToolUse+exit2 오설계, §5 참조), `hook:cwe-optional-guard`·`hook:lazy-schema-annotation-guard`(→ tsc/빌드가 커버), `/shared-release-check`·`/manager-cpd-check`·`/i18n-parity-ui`(→ pr-ready·sonar-check·check-i18n 확장이 옳음), `/security-rule-add`·`/tester-parse-check`(→ §5 강등).

## 4. 트랙B 우선순위표 (런타임 — 설계 제안)

트랙B는 아키텍처 변경이므로 합의대로 **설계 제안**으로 둔다. 공통 패턴별로 묶었다.

### 패턴 ① publish-직전 자가검증 루프 (최우선 제안)

deep-research 근거: SDK의 `gather context → take action → verify work` 루프, 자가검증 에이전트가 더 신뢰성 높음.

| 후보 | 서비스 | 적용 지점 |
|---|---|---|
| `plan-self-verify-skill` (V5) | Planner | Step[] 생성 후 의존성·agentType 정합성 자가 검증, 불일치 시 1회 재생성 |
| `file-change-self-verify` (V5) | Developer | 파일 변경 후 의도 대비 diff 자가 검토 |
| `design-self-validate-skill` (V5) | Designer | UISpec 출력 후 스키마+의미 정합성 검증 |
| `failure-analysis-self-verify` (V4) | Tester | 실패 분석 결과 자가 검증 |
| `build-failure-self-verify-hook` (V4) | Builder | 빌드 실패 원인 분석 자가 검증 |
| `agent-result-self-verify` (V4) | Manager | 하위 에이전트 결과 수신 후 정합성 검증 |

**1순위 파일럿 권고: `plan-prompt-constraint-injector`** (Planner, V4/R2/E2). SYSTEM_PROMPT의 하드코딩 agentType enum을 `StepSchema`의 `z.enum` 단일 소스에서 생성하도록 프롬프트 구성만 변경한다. 런타임 계약·메시지 흐름을 바꾸지 않으면서 §2의 `/contract-drift-check`가 잡는 드리프트를 **근본 제거**한다. 회귀 위험이 가장 낮은 트랙B 진입점.

### 패턴 ② spawn-직전 권한 게이트 (PreToolUse deny)

| 후보 | 서비스 | 적용 |
|---|---|---|
| `command-allowlist-defer-hook` (V5) | Tester·Builder | execFile/spawn 직전 ALLOWED_PREFIXES allowlist deny |
| `path-policy-deny-hook` (V5) | Developer·Builder | 파일 I/O 직전 workspaceRoot 경계 deny |
| `runner-input-validator-hook` (V5) | Manager | LLM block.input을 핸들러 inputSchema로 PreToolUse 검증 |
| `github-write-permission-gate` (V4) | Manager | github-ops 쓰기 작업 권한 게이트 |
| `audit-bound-permission-hook` (V4) | Security | 감사 도구 권한 경계 |

deep-research 근거: SDK PreToolUse는 `permissionDecision`(deny>defer>ask>allow), 병렬·독립 동작. 라이브러리 공통 미들웨어로 통합 구현 권고(CPD 절감).

### 패턴 ③ preload 도메인 지식 (user-invocable:false 스킬)

`design-system-conventions-skill`(Designer), `rule-pack-preload-skill`(Security), build-command-allowlist(Builder) → targetFramework/artifact 유형별 규칙을 runner 시작 시 preload.

### 패턴 ④ 부하/용량 제어 (defer)

`event-storm-throttle-skill`·`watch-self-verify-hook`(Watcher), `adaptive-consumer-backpressure`·`poison-message-quarantine`·`pel-reclaim-self-verify`(Shared) 등. 우선순위 낮음.

## 5. 적대적 검증 결과

`implement` 4건을 회의적 관점으로 검증 → 2건 통과, 2건 강등.

| 후보 | 판정 | 사유 |
|---|---|---|
| `/contract-drift-check` | ✅ 통과 (value 5→3-4 보정) | 드리프트 표면 실재, tsc 사각지대, 기존 자산 비중복. 단 정규식 유지보수 비용으로 effort는 실질 4-5 |
| `/dev-path-guard-audit` | ✅ 통과 (value 5→3-4) | 보안 불변식 모두 실재, 4커맨드/4훅과 비중복. /security-review와 부분 중복이나 서비스 특정 불변식은 미커버 |
| `/security-rule-add` | ❌ defer | ALL_RULES가 spread 자동 합류라 핵심 위험 과장, 규칙 추가 빈도 분기당 1회 미만 → 스캐폴드 과함. CLAUDE.md 절차 문서화로 충분 |
| `/tester-parse-check` | ❌ defer | parseTestCounts 실패 모드가 detector.test.ts에 이미 커버, post-edit.mjs가 회귀 즉시 노출 → 실질 중복 |

## 6. 심사관 핵심 인사이트 (재발 방지)

1. **PostToolUse + exit2는 안티패턴.** PostToolUse는 차단 불가 — exit2는 stderr만 Claude에 전달하고 이미 일어난 편집을 되돌리지 못한다. 차단이 필요하면 PreToolUse(`tool_input.new_string` 검사)여야 한다. (deep-research 검증: 차단 가능 이벤트는 PreToolUse/UserPromptSubmit/Stop/SubagentStop/PreCompact/PermissionRequest)
2. **빌드/tsc로 잡히는 항목은 hook 불필요.** consumer-signature·lazy-schema-annotation·cwe-optional은 pre-commit.mjs(빌드)·post-edit.mjs(테스트)가 이미 커버 → 중복.
3. **기존 자산 확장 > 신규 자산.** redis-mock-yield-guard는 mock-guard.mjs 정규식 1줄로, i18n-parity-ui는 check-i18n.js 경로 추가로 해결(§2). shared-build-then-dependents는 post-edit.mjs와 완전 중복.
4. **부작용 워크플로(파일 생성/배포/커밋)는 `disable-model-invocation:true`** 로 사용자 전용 지정 — Claude가 멋대로 실행 못하게.
5. **트랙B self-verify·권한 게이트는 회귀테스트 없이 implement 금지** — LLM 재호출·디스패치 경로 변경·세션 경합 동반.
6. **crossCutting 6패턴은 라이브러리/공통 미들웨어로 통합** — 서비스별 중복 구현은 CPD·유지보수 비용 증가.
7. **비대한 CLAUDE.md는 지시 무시 유발** — 서비스별 CLAUDE.md의 "가끔만 필요한" 지식(보안 패턴·E2E 패턴 등)은 on-demand skill로 이전 검토.

## 7. deep-research 근거 요약 (25 claim 3-0 검증)

- 커맨드와 Skill 통합: `.claude/commands/X.md` ≡ `.claude/skills/X/SKILL.md`(둘 다 `/X`). SKILL.md는 supporting file·on-demand 로딩·invocation 제어 추가. 좋은 SKILL.md는 500줄 이하·"무엇을" 중심.
- Hook은 결정론적 보장(CLAUDE.md는 권고). exit 0=성공(JSON은 exit 0만), exit 2=차단(stderr→Claude), exit 1/기타=비차단. 정책 강제는 반드시 exit 2. exit 2와 JSON 혼용 금지.
- Stop hook = 검증 게이트(검사 통과까지 턴 종료 차단, 8회 연속 후 override).
- Agent SDK: AgentDefinition `skills`(preload)·`tools`(최소권한)·subagent 중첩 불가·description으로 auto-delegate. permissionDecision deny>defer>ask>allow.
- 출처: code.claude.com 공식 문서(canonical). 시간민감: 커맨드↔스킬 병합은 최근(v2.1.x), Agent SDK hook 이벤트셋은 확장 중 → 설치 SDK 버전 재확인 필요.

## 8. 다음 단계 권고

1. (즉시) 이번 PR의 `/contract-drift-check`·`/dev-path-guard-audit`를 실제 개발에서 사용해 효용 검증.
2. (단기) 트랙B 1순위 파일럿 `plan-prompt-constraint-injector` 구현 — 드리프트 근본 제거, 저위험.
3. (중기) 패턴 ② spawn-직전 권한 게이트를 `@xzawed/agent-streams` 공통 미들웨어로 설계.
4. (검토) 서비스별 CLAUDE.md 비대 섹션의 on-demand skill 이전(인사이트 #7).
