---
name: project-skills
scope: project
version: 1.0.0
description: xzawedPAIS 개발·개선·운영 공통 스킬 모음
---

# xzawedPAIS 프로젝트 스킬

각 스킬의 상세 배경: [docs/development/](docs/development/) · [서비스 문서](docs/services/)

---

## 개발 (Dev)

### new-agent
새 에이전트 서비스 추가

**전제조건**: 새 포트 번호 결정 (현재 3002~3008, 신규는 3009부터), xzawedShared 빌드 완료

**실행**:
```bash
# 1. xzawedPlanner를 베이스로 복사 (가장 단순한 구조)
cp -r xzawedPlanner xzawed<Name>
cd xzawed<Name>

# 2. 파일 수정
# - src/config.ts: PORT=<새포트>
# - src/types.ts: Manager<->Agent 메시지 타입 정의
# - src/index.ts: 서비스명, 스트림 키 업데이트
# - package.json: name 변경

# 3. Manager에 ToolHandler 등록
# xzawedManager/packages/server/src/tools/<name>.ts 생성
# xzawedManager/packages/server/src/index.ts에 추가

# 4. 인프라 파일 업데이트
# docker-compose.yml: 서비스 블록 추가
# .github/workflows/ci.yml: 빌드·테스트 잡 추가

# 5. 문서
# docs/services/<name>.md 생성
# docs/README.md 서비스 목록 업데이트
# CLAUDE.md 서비스 현황 표 업데이트
```

**검증**: `cd xzawed<Name> && pnpm test`

---

### full-test
전체 플랫폼 테스트 실행 (9개 서비스)

**전제조건**: xzawedShared 빌드 완료

**실행**:
```bash
cd xzawedShared && pnpm build && cd ..
for svc in xzawedOrchestrator xzawedManager xzawedPlanner xzawedDeveloper \
           xzawedDesigner xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity; do
  echo "=== $svc ===" && cd $svc && pnpm test && cd ..
done
```

**예상**: 모든 서비스 통과 (총 450+ 테스트)

---

### coverage-check
커버리지 분석 — 미커버 라인 상위 파악

**실행**:
```bash
# 커버리지 생성 (각 서비스에서)
cd <서비스> && pnpm test --coverage

# lcov 요약 확인
cat <서비스>/coverage/lcov.info | grep -E "^(SF|DA:)" | \
  awk '/^SF/{file=$0} /^DA:.*,0$/{uncovered[file]++} END{for(f in uncovered) print uncovered[f], f}' | \
  sort -rn | head -10
```

**검증**: SonarCloud `new_coverage` 기준 80% 이상 확인

---

### sonar-check
SonarCloud 품질 게이트 사전 확인 (로컬)

**실행**:
```bash
# CPD 확인
npx jscpd@3.5.10 --config .jscpd.json

# 빌드 (타입 체크 포함)
pnpm build
```

**상세 가이드**: [docs/development/sonarcloud.md](docs/development/sonarcloud.md)

---

### pr-create
PR 생성 전 전체 체크리스트 실행 후 PR 생성

**실행**:
```bash
# 1. 테스트
pnpm test

# 2. 빌드
pnpm build

# 3. 감사
pnpm audit

# 4. CPD
npx jscpd@3.5.10 --config .jscpd.json

# 5. PR 생성
gh pr create --title "<feat|fix|docs>(<scope>): <설명>" --body "$(cat <<'EOF'
## 변경 사항
- 

## 테스트 결과
- pnpm test: X/X 통과
- pnpm audit: 취약점 0개

🤖 Generated with Claude Code
EOF
)"
```

---

## 개선 (Improve)

### add-message-type
새 Redis 메시지 타입 추가

**실행 순서**:
```
1. xzawedOrchestrator/packages/shared/src/types/streams.ts
   → OrchestratorToManagerMessage 또는 ManagerToOrchestratorMessage union에 추가

2. 수신 서비스 src/types.ts
   → ManagerTo<Service>Message union에 추가
   → <Service>To<Target>Message union에 추가 (응답 타입)

3. xzawedManager/packages/server/src/tools/<handler>.ts
   → 새 타입 핸들링 추가

4. 수신 서비스 src/streams/consumer.ts
   → 새 타입 처리 분기 추가

5. 테스트 파일에 새 메시지 타입 테스트 케이스 추가

6. pnpm build (타입 체크)
```

**검증**: `pnpm test` 전 서비스 통과

---

### upgrade-dep
의존성 업데이트

**실행**:
```bash
# 각 서비스에서
pnpm update --latest

# 검증
pnpm test
pnpm build
pnpm audit

# lock 파일 커밋
git add pnpm-lock.yaml
git commit -m "chore(deps): upgrade dependencies"
```

**주의**: lock 파일 변경 시 반드시 `pnpm install` 실행 후 커밋 (CI frozen-lockfile 실패 방지)

---

### refactor-service
서비스 리팩토링 체크리스트

**체크리스트**:
- [ ] 리팩토링 전 `pnpm test` 전체 통과 확인
- [ ] 파일 이동 시 `git mv` 사용 (git history 보존)
- [ ] 인터페이스·타입명 변경 시 `grep -r <이전명> .` 으로 모든 참조 확인
- [ ] 리팩토링 후 `pnpm test` + `pnpm build` 재확인
- [ ] CLAUDE.md 관련 내용 업데이트

---

## 운영 (Ops)

### docker-local
로컬 Docker 전체 스택 실행

**실행**:
```bash
# 전체 스택 (Redis + 9개 서비스)
docker-compose up -d

# 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs -f <서비스명>

# 종료
docker-compose down
```

---

### redis-debug
Redis Streams 디버깅

```bash
# 스트림 크기 확인
redis-cli XLEN orchestrator:to-manager:<sessionId>

# 최근 메시지 조회
redis-cli XRANGE orchestrator:to-manager:<sessionId> - + COUNT 5

# 미처리 메시지 (PEL) 확인
redis-cli XPENDING orchestrator:to-manager:<sessionId> manager-consumers - + 10

# Consumer Group 목록
redis-cli XINFO GROUPS orchestrator:to-manager:<sessionId>
```

---

### health-check
9개 서비스 `/health` 일괄 확인

```bash
for port in 3000 3001 3002 3003 3004 3005 3006 3007 3008; do
  echo -n "Port $port: "
  curl -s http://localhost:$port/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "DOWN"
done
```

---

### log-tail
서비스별 로그 실시간 확인 (Docker 환경)

```bash
# 특정 서비스
docker-compose logs -f xzawedOrchestrator

# 전체 서비스 (인터리브)
docker-compose logs -f --tail=50
```

---

### session-trace
sessionId로 전체 Redis 메시지 추적

```bash
SESSION_ID=<sessionId>

# 모든 관련 스트림 키 탐색
redis-cli KEYS "*:$SESSION_ID"

# 각 스트림 메시지 조회
for key in $(redis-cli KEYS "*:$SESSION_ID"); do
  echo "=== $key ==="
  redis-cli XRANGE $key - + COUNT 20
done
```

---

### env-validate
각 서비스 환경변수 검증 (config.ts Zod 스키마 실행)

```bash
# 각 서비스 디렉토리에서 — config.ts는 시작 시 자동 검증
# 직접 검증만 하려면:
cd <서비스> && node -e "import('./dist/config.js').then(m => m.loadConfig()).then(c => console.log('OK:', Object.keys(c)))"
```

**주의**: `dist/` 빌드 후 실행 필요

---

## 디버깅 (Debug)

### ci-failure-debug
CI 실패 원인 진단

**OOM 의심 시**:
```bash
# 1. 로컬에서 CI 환경 재현 (CI=true 설정)
CI=true NODE_OPTIONS=--max-old-space-size=3072 pnpm test

# 2. 특정 테스트 파일 격리 실행
pnpm test src/<의심 파일>.test.ts

# 3. Consumer mock에서 setImmediate 사용 여부 확인
grep -r "mockResolvedValue(null)" src/
```

**vitest shard 관련**:
```bash
# shard 명령 로컬 검증
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-1 --shard=1/2
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-2 --shard=2/2
mkdir -p coverage && cat coverage/shard-*/lcov.info > coverage/lcov.info
```

---

### test-oom-debug
테스트 OOM 진단 및 수정

**증상**: CI에서 `Reached heap limit` 또는 테스트가 타임아웃 없이 무한 실행

**진단**:
```bash
# 1. CI 환경 로컬 재현
CI=true NODE_OPTIONS=--max-old-space-size=3072 pnpm test

# 2. 단일 의심 파일 격리
pnpm test src/<파일>.test.ts --reporter=verbose

# 3. Consumer mock에서 즉시 resolve 탐색
grep -rn "mockResolvedValue(null)" src/ --include="*.test.ts"
grep -rn "mockResolvedValue(\[\])" src/ --include="*.test.ts"
```

**수정 패턴**:
```typescript
// xreadgroup이 null 반환할 때 setImmediate로 양보
xreadgroup: vi.fn().mockImplementation(() =>
  responses.length ? Promise.resolve(responses.shift()) :
  new Promise(r => setImmediate(() => r(null)))
)
```

**참고**: [docs/development/testing-patterns.md](testing-patterns.md) · [ADR-002](adr/002-ci-stability-patterns.md)

---

### fix-audit-vuln
전이 의존성 취약점 수정

```bash
# 1. 취약점 확인
pnpm audit --audit-level=moderate

# 2. 취약한 패키지와 경로 파악 (Path 항목 확인)
# 예: packages__app>electron-builder>..>tmp

# 3. 루트 package.json에 override 추가
# "pnpm": { "overrides": { "취약한-패키지": ">=안전한-버전" } }

# 4. lock 파일 업데이트
pnpm install

# 5. 검증
pnpm audit --audit-level=moderate
```

---

### branch-sync
현재 브랜치를 master 최신 상태로 동기화 (충돌 예방)

```bash
# master 최신 상태 가져오기
git fetch origin master

# 현재 브랜치와 master 차이 확인
git log --oneline HEAD..origin/master

# 차이가 있으면 merge (또는 rebase)
git merge origin/master
# 충돌 발생 시: 수동 해결 → git add → git commit

# 검증
pnpm test && pnpm build
```

**언제 실행하나**: 작업 시작 전, PR 생성 전, 다른 PR 머지 공지를 받았을 때
