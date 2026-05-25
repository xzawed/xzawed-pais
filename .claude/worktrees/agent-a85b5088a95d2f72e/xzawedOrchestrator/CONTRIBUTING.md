# 기여 가이드

xzawedOrchestrator에 기여해주셔서 감사합니다. 이 문서는 개발 환경 설정부터 PR 제출까지의 전 과정을 안내합니다.

---

## 개발 환경 설정

### Prerequisites

- Node.js 20 이상
- pnpm 9 이상 (`npm install -g pnpm`)
- Redis 7 이상 (선택 사항 — 없으면 인메모리 폴백 사용)
- Claude CLI (선택 사항 — `CLAUDE_MODE=cli` 사용 시 필요)

### 저장소 설정

```bash
# 포크 후 클론
git clone https://github.com/YOUR_USERNAME/orchestrator.git
cd orchestrator

# 의존성 설치
pnpm install

# 환경변수 설정
cp .env.example .env
# .env를 열어 필요한 값 설정
```

### 개발 서버 실행

```bash
# 백엔드 서버 (packages/server)
cd packages/server && pnpm dev

# 전체 모노레포 빌드
pnpm build

# 전체 테스트
pnpm test
```

### 테스트 실행

```bash
# 전체 테스트
pnpm test

# 특정 패키지 테스트
cd packages/server && pnpm test

# 특정 테스트 파일
cd packages/server && pnpm test test/api/sessions.test.ts

# 워치 모드
cd packages/server && pnpm test:watch
```

---

## 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 릴리스 준비 완료 코드. 직접 푸시 금지 |
| `develop` | 통합 브랜치. PR 대상 기본 브랜치 |
| `feat/*` | 새 기능 개발 |
| `fix/*` | 버그 수정 |
| `docs/*` | 문서 변경 |
| `refactor/*` | 리팩터링 (기능 변경 없음) |
| `test/*` | 테스트 추가·수정 |

### 브랜치 생성 예시

```bash
git checkout develop
git pull origin develop
git checkout -b feat/mcp-send-message
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
| `chore` | 빌드·설정 변경 |
| `perf` | 성능 개선 |

### 스코프

| 스코프 | 대상 |
|--------|------|
| `server` | packages/server |
| `shared` | packages/shared |
| `app` | packages/app |
| `mcp` | MCP 서버 관련 |
| `streams` | Redis Streams 관련 |
| `sessions` | 세션 관리 관련 |

### 예시

```bash
git commit -m "feat(server): add CLIRunner for local claude CLI subprocess"
git commit -m "fix(streams): handle BUSYGROUP error on consumer group creation"
git commit -m "docs(concepts): add Redis Streams architecture overview"
git commit -m "test(sessions): add edge cases for SessionStore.updateState"
```

---

## PR 가이드

### PR 제출 전 체크리스트

- [ ] 새 기능/수정에 대한 테스트 추가
- [ ] 전체 테스트 통과 (`pnpm test`)
- [ ] TypeScript 빌드 성공 (`pnpm build`)
- [ ] 관련 문서 업데이트 (필요한 경우)
- [ ] CHANGELOG.md `[미출시]` 섹션에 변경 내용 추가

### PR 제목

커밋 컨벤션과 동일한 형식을 사용합니다.

```
feat(server): add WebSocket reconnection with exponential backoff
```

### PR 본문 템플릿

```markdown
## 변경 사항
- 변경 사항 1
- 변경 사항 2

## 관련 이슈
Closes #123

## 테스트 방법
1. 단계 1
2. 단계 2

## 체크리스트
- [ ] 테스트 추가
- [ ] 문서 업데이트
- [ ] CHANGELOG.md 업데이트
```

### 코드 리뷰 기준

- TypeScript strict 모드 준수
- 신규 퍼블릭 API에 JSDoc 주석
- 테스트 커버리지 유지
- 환경변수는 `config.ts`를 통해서만 접근
- Redis 직접 접근은 `streams/` 모듈을 통해서만

---

## 아키텍처 원칙

1. **계층 분리**: `api/` → `sessions/` → `claude/` → `streams/` 순서로 의존. 역방향 의존 금지
2. **공통 타입**: 런타임 로직은 `packages/shared`에 포함하지 않음. 타입·인터페이스만 허용
3. **환경변수**: 모든 설정은 `config.ts`의 `loadConfig()`를 통해 타입 안전하게 접근
4. **ClaudeRunner 인터페이스**: 새 Claude 실행 모드 추가 시 `ClaudeRunner` 인터페이스를 구현하고 `runner.factory.ts`에 등록

---

## 관련 문서

- [아키텍처 개요](docs/concepts/architecture.md)
- [REST API 레퍼런스](docs/reference/rest-api.md)
- [환경변수 목록](docs/reference/environment-variables.md)
