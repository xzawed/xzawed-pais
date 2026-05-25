# 기여 가이드

xzawedPAIS에 기여해주셔서 감사합니다. 이 문서는 개발 환경 설정부터 PR 제출까지의 전 과정을 안내합니다.

---

## ⚡ 핵심 원칙

> **모든 작업은 Pull Request(PR)를 통해 진행한다.**  
> PR은 작업 완료 + 테스트 통과 + 코드 검토 후 **마지막 단계**에서 생성한다.

```
브랜치 생성 → 작업 → 테스트 통과 → 빌드 확인 → audit 통과 → PR 생성 → 머지
```

---

## 개발 환경 설정

### Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- Redis 7+ (로컬: `redis-server`, Docker: `docker run -p 6379:6379 redis`)
- `ANTHROPIC_API_KEY`

### 서비스별 설치

```bash
# Turborepo 기반 (Orchestrator, Manager)
cd xzawedOrchestrator && pnpm install
cd xzawedManager      && pnpm install

# 독립 서비스
for svc in xzawedPlanner xzawedDeveloper xzawedDesigner \
           xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  cd $svc && pnpm install && cd ..
done
```

### 환경변수 설정

각 서비스 디렉토리에서:

```bash
cp .env.example .env
# ANTHROPIC_API_KEY, REDIS_URL 등 편집
```

---

## 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `master` | 릴리스 준비 완료 코드. **직접 push 금지** |
| `feat/<서비스>/<설명>` | 새 기능 개발 |
| `fix/<서비스>/<설명>` | 버그 수정 |
| `docs/<설명>` | 문서 변경 |
| `chore/<설명>` | 의존성·설정 변경 |
| `refactor/<서비스>/<설명>` | 리팩터링 |

### 브랜치 생성 예시

```bash
git checkout master
git pull origin master
git checkout -b feat/developer/file-diff-support
git checkout -b fix/security/static-analyzer-false-positive
git checkout -b docs/update-api-reference
git checkout -b chore/upgrade-vitest-3
```

---

## 커밋 컨벤션

[Conventional Commits](https://www.conventionalcommits.org/ko/) 형식을 사용합니다.

```
<type>(<scope>): <subject>

[body]

[footer]
```

### 타입

| 타입 | 설명 |
|------|------|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 변경 |
| `refactor` | 리팩터링 |
| `test` | 테스트 추가·수정 |
| `chore` | 빌드·의존성·설정 변경 |
| `perf` | 성능 개선 |

### 스코프 (서비스별)

| 스코프 | 서비스 |
|--------|--------|
| `orchestrator` | xzawedOrchestrator |
| `manager` | xzawedManager |
| `planner` | xzawedPlanner |
| `developer` | xzawedDeveloper |
| `designer` | xzawedDesigner |
| `tester` | xzawedTester |
| `builder` | xzawedBuilder |
| `watcher` | xzawedWatcher |
| `security` | xzawedSecurity |
| `deps` | 의존성 변경 (복수 서비스) |
| `docs` | 문서 (`docs/` 디렉토리) |

### 커밋 예시

```bash
git commit -m "feat(developer): add file diff preview before applying changes"
git commit -m "fix(security): skip false-positive on test fixture files"
git commit -m "chore(deps): upgrade vitest 2→3, add vite 6.4.2"
git commit -m "docs(contributing): add PR workflow rules"
```

---

## PR 워크플로우

### ✅ PR 생성 전 필수 체크리스트

- [ ] 해당 서비스 테스트 전체 통과 (`pnpm test`)
- [ ] TypeScript 빌드 성공 (`pnpm build`)
- [ ] 의존성 취약점 없음 (`pnpm audit`)
- [ ] 관련 문서 업데이트 완료

### PR 제목

커밋 컨벤션과 동일한 형식:

```
feat(developer): add file diff preview before applying changes
fix(security): resolve false-positive on test fixture files
```

### PR 본문 템플릿

```markdown
## 변경 사항
- 변경 사항 1
- 변경 사항 2

## 테스트 결과
- `pnpm test`: X/X 통과
- `pnpm audit`: 취약점 0개

## 관련 이슈
Closes #123
```

### 코드 리뷰 기준

- TypeScript strict + exactOptionalPropertyTypes 준수
- 서비스 간 직접 import 금지 — Redis Streams만 사용
- 새 환경변수는 `config.ts`의 Zod 스키마에 추가
- 테스트는 실제 동작을 검증 (mock은 외부 의존성에만)

---

## 아키텍처 원칙

1. **서비스 격리**: 서비스끼리 직접 import하지 않는다. 통신은 Redis Streams만 사용
2. **환경변수**: 모든 설정은 `config.ts`의 `loadConfig()`를 통해 타입 안전하게 접근
3. **테스트 격리**: `vitest.config.ts`의 `pool: 'forks'` 유지 — 프로세스 격리 필수
4. **경로 검증**: 파일 시스템 접근 시 `WORKSPACE_ROOT` 외부 차단 (`validatePath` 사용)

---

## 관련 문서

- [플랫폼 개요](../../CLAUDE.md)
- [Redis Streams 구조](../concepts/redis-streams.md)
- [서비스별 문서](../services/)
- [환경변수 목록](../reference/environment-variables.md)
