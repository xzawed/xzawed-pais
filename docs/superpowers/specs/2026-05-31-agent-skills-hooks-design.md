# 서비스 에이전트별 SKILL/HOOK 강화 — 설계

- 작성일: 2026-05-31
- 상태: 승인 대기
- 관련 브랜치: `feat/agent-skills-hooks-design`

## 1. 목표

xzawedPAIS의 각 서비스가 "자기 업무를 더 잘 수행"하도록 SKILL/HOOK 영역을 강화한다. deep-research로 근거를 확보하고, 여러 에이전트가 9개 서비스 + 공통 3개를 병렬 분석·논의해 후보를 도출한 뒤, 고가치·저위험 항목을 실제로 반영한다.

"SKILL/HOOK"은 두 층위 모두를 포함한다(사용자 확정 "둘 다"):

- **트랙 A — 개발 보조(`.claude/`)**: 이 저장소를 개발할 때 Claude Code가 쓰는 슬래시 커맨드(`.claude/commands/`)와 훅(`.claude/hooks/` + `settings.json`). 기존 자산(`pr-ready`, `sonar-check`, `e2e-electron`, `i18n-add` + 4개 훅)을 확장한다.
- **트랙 B — 플랫폼 런타임 기능**: xzawedPAIS 제품의 AI 에이전트(Planner 등)가 런타임에 활용할 Skill/Hook 메커니즘. 신규 아키텍처이므로 이번에는 설계·제안 우선.

## 2. 범위 경계 (YAGNI)

| 포함 | 제외 |
|---|---|
| 트랙 A 고가치 항목 실제 구현·PR | 트랙 B 전면 구현(제품 로드맵급) |
| 트랙 B 설계 제안서 + (합의 시) 파일럿 1개 | 9개 서비스 일괄 런타임 개조 |
| deep-research 근거 리포트 | 무관한 리팩토링 |
| 서비스별 SKILL/HOOK 후보 우선순위표 | 기존 훅/커맨드의 동작 변경(명백한 버그 제외) |

## 3. 현재 자산 (기준선)

- **SKILL(`.claude/commands/`)**: `pr-ready`, `sonar-check`, `e2e-electron`, `i18n-add`
- **HOOK(`settings.json`)**:
  - PostToolUse(`Edit|Write|MultiEdit`): `post-edit.mjs`(편집 후 서비스 테스트 자동실행), `mock-guard.mjs`(위험 mock 패턴 감지, 비차단)
  - PreToolUse(`Bash`): `pre-commit.mjs`(커밋 품질게이트, 차단 exit 2), `branch-check.mjs`(브랜치 동기화 경고, 비차단)
- 관찰: 훅은 전역(저장소 단위)이며 서비스별 분기가 `post-edit.mjs`의 `SERVICE_MAP`에만 존재. 서비스 특화 검증/스킬 여지가 큼.

## 4. 실행 파이프라인

```
Phase 1  deep-research   Claude Code Skill·Hook 공식 문서 + Agent SDK Skill/Hook →
                         "효과적인 SKILL/HOOK의 조건/안티패턴" 근거 리포트
Phase 2  fan-out (병렬)   12개 분석 단위(9 서비스 + Shared/Manager/Orchestrator)를
                         담당 에이전트가 각각 분석 → 서비스별 SKILL/HOOK 후보(A·B)
Phase 3  수렴·심사        후보 중복제거 → 가치·위험·노력 점수화 → 적대적 검증 →
                         고가치·저위험 선별
Phase 4  반영             제안서(이 docs/) 갱신 + 트랙 A 고가치 항목 .claude 구현 → PR
```

Phase 2~3은 사용자가 명시 요청한 "여러 에이전트 논의"로, Workflow(멀티 에이전트 오케스트레이션)로 실행한다. 규모 약 15~25 에이전트.

### Phase 1 — deep-research

- 대상(사용자 확정 "둘 다"): ① Claude Code의 Skill(슬래시 커맨드)·Hook 공식 문서·베스트프랙티스, ② Claude Agent SDK의 에이전트 Skill/Hook 메커니즘.
- 산출: "좋은 SKILL/HOOK의 판별 기준 + 안티패턴 + 트랙 A·B 적용 시사점" 인용 포함 리포트.

### Phase 2 — 서비스별 병렬 분석

각 분석 단위 에이전트는 해당 서비스의 `CLAUDE.md` + 핵심 소스 + 테스트 패턴을 읽고 다음을 산출한다(구조화 출력):

- 업무 요약 / 반복 작업 / 빈발 실패·실수 패턴
- 트랙 A 후보: 서비스 특화 슬래시 커맨드·훅 (이름, 목적, 트리거, 차단/비차단)
- 트랙 B 후보: 런타임 Skill/Hook 아이디어 (목적, 적용 지점)
- 각 후보의 예상 가치/위험/노력 1차 자가평가

분석 단위: Planner, Developer, Designer, Tester, Builder, Watcher, Security, (Orchestrator, Manager, Shared 공통 3개).

### Phase 3 — 수렴·심사

- 전체 후보를 모아 중복·유사 항목 병합.
- 가치(업무 개선 효과) × 위험(오작동/방해) × 노력(구현 비용)으로 점수화.
- 적대적 검증: 각 고득점 후보를 "정말 필요한가, 기존 자산과 겹치지 않는가, 오탐/방해 위험은?" 관점으로 반박 검증.
- 산출: 우선순위표(구현/제안/보류 3분류) + 트랙 A "이번 구현" 목록 확정.

### Phase 4 — 반영

- 제안서: 이 문서에 우선순위표·근거를 추가하고, 트랙 B 설계 제안을 별도 섹션으로.
- 구현(트랙 A): 확정된 고가치·저위험 항목을 `.claude/commands/`·`.claude/hooks/`·`settings.json`에 추가. 기존 훅 패턴(비차단 기본, exit 코드 규약) 준수.
- 검증: 추가 훅은 의도한 입력에 대해 동작 확인(스모크). `pr-ready` 절차 통과 후 PR.

## 5. 성공 기준

1. deep-research 근거 리포트가 트랙 A·B 판단 기준을 제시한다.
2. 12개 분석 단위 전부에 대해 SKILL/HOOK 후보가 도출된다.
3. 후보가 가치/위험/노력으로 점수화되고 우선순위표로 수렴된다.
4. 트랙 A 고가치·저위험 항목이 실제 `.claude/`에 반영되고 스모크 검증된다.
5. 트랙 B는 설계 제안서로 정리된다(전면 구현 아님).
6. 전체가 단일 PR로 묶여 기존 CI/품질게이트를 통과한다.

## 6. 위험 및 대응

- **에이전트 과다·토큰 비용**: Phase 2를 12 단위로 한정, Phase 3 심사로 조기 수렴.
- **훅 오작동으로 개발 방해**: 신규 훅은 기본 비차단(exit 0), 차단(exit 2)은 명백한 품질게이트만. 도입 전 스모크.
- **트랙 B 과확장**: 이번엔 설계·파일럿까지로 명시 제한.
- **기존 자산 중복**: Phase 3 적대적 검증에서 기존 4 커맨드/4 훅과 대조 필수.

## 7. 산출물

- `docs/superpowers/specs/2026-05-31-agent-skills-hooks-design.md` (본 문서, Phase 4에서 결과 추가)
- deep-research 리포트(본 문서 부록 또는 별도 `docs/`)
- 트랙 A 신규 `.claude/commands/*.md`, `.claude/hooks/*.mjs`, `settings.json` 변경
- 트랙 B 설계 제안 섹션
