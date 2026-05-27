# SKILL.md + Claude Hooks + 문서 구조 재편 설계

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** SKILL.md 계층 도입·Claude Code Hook 자동화·docs/ 구조 재편을 통해 개발·운영 생산성과 문서 유지보수성을 높인다.

**Architecture:** SKILL.md를 서비스·프로젝트 두 계층으로 분리하고, Claude Code Hook으로 수정→테스트·커밋→품질게이트 루프를 자동화한다. docs/는 Diátaxis 구조를 유지하면서 완료 산출물을 archive/로 분리하고 CLAUDE.md에서 공통 내용을 추출해 참조 형태로 전환한다.

**Tech Stack:** Claude Code hooks (Node.js ESM), Markdown frontmatter, Diátaxis docs pattern

**Upgrade Path:** 방안 2(현재 스펙) → 방안 3: SKILL.md를 superpowers 플러그인 포맷으로 전환해 `/skill-name` 슬래시 커맨드로 호출 가능하게 하고, Hook에 커버리지 임계값 체크·SonarCloud API 사전 확인을 추가한다.

---

## 파트 A — SKILL.md 계층 설계

### A-1. 파일 위치 및 계층 구조

```
xzawedPAIS/
├── SKILL.md                        ← 프로젝트 공통 (개발·개선·운영)
├── xzawedOrchestrator/SKILL.md     ← Orchestrator 전용
├── xzawedManager/SKILL.md          ← Manager 전용
├── xzawedPlanner/SKILL.md          ← Planner 전용
├── xzawedDeveloper/SKILL.md        ← Developer 전용
├── xzawedDesigner/SKILL.md         ← Designer 전용
├── xzawedTester/SKILL.md           ← Tester 전용
├── xzawedBuilder/SKILL.md          ← Builder 전용
├── xzawedWatcher/SKILL.md          ← Watcher 전용
├── xzawedSecurity/SKILL.md         ← Security 전용
└── xzawedShared/SKILL.md           ← Shared 라이브러리 전용
```

### A-2. 통일 frontmatter 스키마

모든 SKILL.md는 아래 헤더로 시작한다. 방안 3 전환 시 이 필드가 superpowers `plugin.json`의 skill 항목으로 그대로 매핑된다.

```markdown
---
name: <service>-skills            # kebab-case: project-skills | manager-skills 등
scope: service | project          # service = 단일 서비스, project = 전체 플랫폼
version: 1.0.0
description: <한 줄 설명>
---
```

### A-3. 루트 SKILL.md 스킬 목록 (14개)

각 스킬은 **설명 / 전제조건 / 실행 명령 / 검증 방법** 네 항목으로 구성한다.

#### 개발 (Dev)

| 스킬 이름 | 설명 |
|-----------|------|
| `new-agent` | 새 에이전트 서비스 추가 전체 절차 |
| `full-test` | xzawedShared 선빌드 후 9개 서비스 병렬 테스트 |
| `coverage-check` | lcov 생성 → 미커버 라인 상위 10개 출력 |
| `sonar-check` | jscpd + 로컬 lint 사전 확인 |
| `pr-create` | 테스트·빌드·감사·jscpd 통과 후 `gh pr create` |

#### 개선 (Improve)

| 스킬 이름 | 설명 |
|-----------|------|
| `add-message-type` | 새 Redis 메시지 타입 추가 (shared 타입→스키마→핸들러→테스트) |
| `upgrade-dep` | pnpm update → 테스트 → audit → lock 커밋 |
| `refactor-service` | 서비스 리팩토링 체크리스트 |

#### 운영 (Ops)

| 스킬 이름 | 설명 |
|-----------|------|
| `docker-local` | 로컬 Docker 전체 스택 실행 |
| `redis-debug` | XLEN·XRANGE·XPENDING 레시피 |
| `health-check` | 9개 서비스 `/health` 일괄 확인 |
| `log-tail` | 서비스별 로그 실시간 확인 |
| `session-trace` | sessionId로 전체 Redis 메시지 추적 |
| `env-validate` | 각 서비스 환경변수 검증 실행 |

### A-4. 서비스별 SKILL.md 스킬 기준

각 서비스 SKILL.md에는 **해당 에이전트 역할에 고유한** 스킬 3~6개를 수록한다. 공통 패턴(Redis debug, pnpm test 등)은 루트 SKILL.md에만 둔다.

| 서비스 | 핵심 스킬 (예시) |
|--------|-----------------|
| Orchestrator | `add-claude-runner`, `add-auth-endpoint`, `add-mcp-tool`, `debug-websocket` |
| Manager | `add-tool-handler`, `debug-tool-loop`, `add-github-op`, `trace-agent-dispatch` |
| Shared | `publish-package`, `add-base-consumer-feature`, `update-workspace-guard` |
| Planner | `tune-plan-prompt`, `add-step-constraint`, `debug-plan-fallback` |
| Developer | `add-file-operation`, `tune-codegen-prompt`, `debug-workspace-path` |
| Designer | `add-component-spec`, `tune-design-prompt`, `debug-recursive-spec` |
| Tester | `add-test-framework`, `tune-failure-analysis`, `debug-test-detection` |
| Builder | `add-build-tool`, `tune-artifact-detection`, `debug-preinstall` |
| Watcher | `add-trigger-pattern`, `tune-debounce`, `debug-watcher-leak` |
| Security | `add-static-rule`, `tune-score-formula`, `debug-audit-parse` |

---

## 파트 B — Claude Code Hook 설계

### B-1. 파일 구조

```
xzawedPAIS/
└── .claude/
    ├── settings.json               ← 훅 등록 설정
    └── hooks/
        ├── post-edit.mjs           ← PostToolUse: 파일 수정 후 서비스 테스트
        └── pre-commit.mjs          ← PreToolUse: 커밋 전 품질 게이트
```

### B-2. settings.json

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/post-edit.mjs"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/pre-commit.mjs"
          }
        ]
      }
    ]
  }
}
```

### B-3. post-edit.mjs 설계

**목적**: Claude가 소스 파일을 수정할 때마다 해당 서비스 테스트를 자동 실행해 즉각 피드백 제공.
**동작**: 비차단(exit 0 고정) — 실패해도 Claude 작업 중단 없음. 정보 제공 목적.

```
stdin JSON → tool_input.file_path 추출
    │
    ├─ 스킵 조건 (exit 0):
    │   .md / .yml / .yaml / .json / .env
    │   dist/ / node_modules/ / .turbo/ / coverage/
    │
    └─ 서비스 경로 매핑 (12개, 모두 cd 방식으로 통일):
        xzawedOrchestrator/packages/server → cd xzawedOrchestrator/packages/server && pnpm test
        xzawedOrchestrator/packages/ui     → cd xzawedOrchestrator/packages/ui && pnpm test
        xzawedOrchestrator/packages/app    → cd xzawedOrchestrator/packages/app && pnpm test
           ※ app: pnpm test = vitest 단위 테스트(41건)만 실행. E2E(pnpm test:e2e)는 제외.
        xzawedManager/packages/server      → cd xzawedManager/packages/server && pnpm test
        xzawedShared                       → cd xzawedShared && pnpm build && pnpm test
           ※ Shared: 빌드 아티팩트 의존성 때문에 build 먼저 실행
        xzawedPlanner                      → cd xzawedPlanner && pnpm test
        xzawedDeveloper                    → cd xzawedDeveloper && pnpm test
        xzawedDesigner                     → cd xzawedDesigner && pnpm test
        xzawedTester                       → cd xzawedTester && pnpm test
        xzawedBuilder                      → cd xzawedBuilder && pnpm test
        xzawedWatcher                      → cd xzawedWatcher && pnpm test
        xzawedSecurity                     → cd xzawedSecurity && pnpm test
              │
              ▼
        실행 결과 마지막 30줄 출력
        항상 exit 0 반환 (비차단)
```

**경로 감지 기준**: `tool_input.file_path`의 경로 문자열에 서비스 디렉토리명이 포함되어 있는지로 판별한다. 감지 실패 시 스킵(exit 0).

### B-4. pre-commit.mjs 설계

**목적**: Claude가 `git commit`을 실행하기 전 품질 게이트 3단계를 강제 통과.
**동작**: 차단(exit 2) — 실패 시 Claude Code가 Bash 도구 실행 취소. Claude가 문제를 먼저 수정.

```
stdin JSON → tool_input.command 추출
    │
    ├─ "git commit" 미포함? → 즉시 exit 0 (대부분의 Bash 명령 통과)
    │
    └─ 품질 게이트 3단계:
        1. pnpm build
           실패 → "❌ 빌드 실패 — 커밋 차단\n<오류 마지막 20줄>" → exit 2
           통과 → 다음 단계

        2. npx jscpd@3.5.10 --config .jscpd.json
           실패 → "❌ CPD 실패 — 커밋 차단\n<중복 파일 목록>" → exit 2
           통과 → 다음 단계

        3. pnpm audit --audit-level=high
           실패 → "❌ 고위험 취약점 발견 — 커밋 차단\n<취약점 목록>" → exit 2
           통과 → "✅ 품질 게이트 통과" → exit 0
```

**git commit --no-verify 예외**: `--no-verify` 플래그 포함 시 게이트 스킵. 사용자가 명시적으로 우회한 것이므로 Claude도 따름.

### B-5. 방안 3 확장 경로

방안 2 구조 위에 아래를 추가하면 방안 3이 된다:

- `post-edit.mjs`: 커버리지 임계값 체크 추가 (`--coverage` 옵션 + lcov 파싱)
- `pre-commit.mjs`: SonarCloud API 사전 확인 단계 추가 (분석 대기 없이 빠른 local check만)
- 추가 훅 파일 `post-test.mjs`: `pnpm test` 완료 후 커버리지 리포트 자동 파싱 출력

---

## 파트 C — 문서 구조 재편

### C-1. 새 docs/ 구조

```
docs/
├── README.md                       ← 전체 인덱스 (업데이트)
│
├── concepts/                       ← 구조 유지, 내용 현행화
│   ├── architecture.md             ← 향후 Gateway·MCP 아키텍처 반영 예정
│   ├── claude-runners.md
│   ├── dynamic-ui.md
│   ├── overview.md
│   ├── redis-streams.md
│   └── sessions.md
│
├── getting-started/                ← 구조 유지, 내용 현행화
│   ├── installation.md
│   └── quickstart.md
│
├── guides/                         ← 구조 유지, 내용 현행화
│   ├── configuration.md
│   ├── local-deployment.md
│   ├── mcp-integration.md
│   └── remote-deployment.md
│
├── reference/                      ← 구조 유지, 내용 현행화
│   ├── environment-variables.md
│   ├── mcp-tools.md
│   ├── rest-api.md
│   └── websocket.md
│
├── services/                       ← 구조 유지 + 보완
│   ├── orchestrator.md
│   ├── manager.md
│   ├── shared.md                   ← 신규 (xzawedShared 문서 부재)
│   ├── planner.md
│   ├── developer.md
│   ├── designer.md
│   ├── tester.md
│   ├── builder.md                  ← builder.md + builder-architecture.md 통합
│   ├── watcher.md
│   └── security.md
│
├── development/                    ← internal/ 대체 + 확장
│   ├── contributing.md             ← internal/contributing.md 이동
│   ├── conventions.md              ← internal/coding-conventions-builder.md 전 서비스 확장
│   ├── security-patterns.md        ← 신규: Orchestrator CLAUDE.md 보안 패턴 추출
│   ├── sonarcloud.md               ← 신규: 루트 CLAUDE.md SonarCloud 섹션 추출
│   ├── prd.md                      ← internal/prd.md 이동
│   └── adr/                        ← 신규: Architecture Decision Records
│       ├── README.md               ← ADR 인덱스 + 작성 가이드
│       └── 001-redis-streams-only.md  ← 서비스 간 직접 import 금지 근거
│
├── archive/                        ← 신규: 완료된 산출물 보존
│   ├── README.md                   ← "구현 완료된 스펙·플랜 아카이브. 참조용."
│   ├── specs/                      ← docs/specs/ 전체 이동 (2026-05-15 스펙 9개)
│   ├── plans/                      ← docs/plans/ 전체 이동 (2026-05-15 플랜 5개)
│   ├── superpowers-plans/          ← docs/superpowers/plans/ 이동 (완료된 플랜 6개)
│   └── changelogs/                 ← internal/changelog-*.md 이동
│
└── superpowers/                    ← 현위치 유지 (superpowers 도구 출력)
    └── specs/                      ← 현행 활성 스펙 (이 파일 포함)
```

### C-2. 삭제 대상 파일

구현 완료 후 아래 파일을 삭제한다. 대체 파일이 이미 `services/` 또는 `development/`에 존재하기 때문이다.

| 삭제 파일 | 이유 |
|-----------|------|
| `docs/internal/readme-builder.md` | `docs/services/builder.md`와 중복 |
| `docs/internal/readme-orchestrator-en.md` | `docs/services/orchestrator.md`와 중복 |
| `docs/internal/readme-orchestrator-ko.md` | `docs/services/orchestrator.md`와 중복 |
| `docs/internal/index-orchestrator.md` | `docs/README.md`와 중복 |

### C-3. CLAUDE.md 정리 전략

**원칙**: CLAUDE.md는 "지금 이 서비스에서 바로 작업하기 위한 필수 정보"만 담는다. 공통 패턴은 `docs/development/`로 추출하고 링크 참조.

| 파일 | 현재 분량 | 목표 | 추출 내용 |
|------|-----------|------|-----------|
| 루트 `CLAUDE.md` | ~200줄 | ~120줄 | SonarCloud 트러블슈팅 전체 → `docs/development/sonarcloud.md` |
| `xzawedOrchestrator/CLAUDE.md` | ~500줄 | ~200줄 | 보안 구현 패턴 전체 → `docs/development/security-patterns.md`<br>TypeScript/tsconfig 규칙 → `docs/development/conventions.md`<br>테스트 인프라 상세 → `docs/services/orchestrator.md` |
| `xzawedManager/CLAUDE.md` | ~130줄 | ~90줄 | 보안 패턴 → `docs/development/security-patterns.md` 참조 링크 |
| 나머지 서비스 CLAUDE.md | 80~130줄 | 60~80줄 | 공통 Redis·Zod 패턴 → `docs/development/conventions.md` 참조 링크 |

**CLAUDE.md에 반드시 남길 것**: 해당 서비스 고유 환경변수, Redis 스트림 인터페이스, 아키텍처 구조, 서비스별 주의사항.

### C-4. docs/README.md 업데이트 범위

- `archive/`, `development/`, `superpowers/specs/` 섹션 추가
- 현재 `docs/specs/`, `docs/plans/`, `docs/internal/` 항목 제거
- Redis Streams 채널 맵 현행화 (향후 Gateway 추가 시 반영)

---

## 구현 순서

1. **파트 C 먼저** — 문서 구조 재편 (폴더 이동·삭제·신규 파일 생성)
2. **파트 A** — SKILL.md 11개 파일 생성
3. **파트 B** — Hook 파일 3개 생성 (settings.json + 2개 스크립트)
4. **검증** — Hook 동작 확인 (파일 수정 → 테스트 자동 실행, 커밋 시도 → 품질 게이트 실행)

파트 C를 먼저 하는 이유: SKILL.md와 Hook이 `docs/development/`의 `security-patterns.md`·`sonarcloud.md` 링크를 참조하기 때문에 docs 구조가 먼저 확정되어야 한다.
