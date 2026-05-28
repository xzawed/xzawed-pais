---
allowed-tools: Bash(npx jscpd*), Bash(git diff:*), Bash(git branch:*), Bash(git log:*), Read, Grep, Glob
description: SonarCloud 품질 게이트 통과 가능성 로컬 사전 검증 — CPD·Security Hotspot·신뢰성 이슈 체크
---

## Context

- Current branch: !`git branch --show-current`
- Changed files vs master: !`git diff --name-only origin/master...HEAD`
- Recent commits: !`git log --oneline -5`
- SonarCloud project key: `xzawed_xzawed-pais`
- SonarCloud dashboard: https://sonarcloud.io/project/overview?id=xzawed_xzawed-pais

## Your task

SonarCloud에 PR을 올리기 전에 로컬에서 품질 게이트 통과 가능성을 사전 검증한다.
이 스킬은 **체크리스트**다. 각 항목을 순서대로 검사하고 위험도를 평가한다.

---

### [1/5] CPD (코드 중복) 로컬 검사

프로젝트 루트 `d:/Source/xzawed-pais`에서 jscpd 실행:

```
npx jscpd@3.5.10 --config .jscpd.json
```

`.jscpd.json` 설정 기준:
- `threshold: 0` — 중복 0건이 목표
- `minTokens: 100` — 100토큰 미만 중복은 무시
- 대상: TypeScript/TSX (테스트 파일 제외)

결과 해석:
- 0 clones → SonarCloud CPD 통과 가능성 높음
- 1건 이상 → SonarCloud가 신규 코드에서 탐지 시 품질 게이트 실패

중복 발견 시: 파일명·줄 번호·중복 토큰 수를 출력하고 해결 방법(공통 헬퍼 추출) 제안.

SonarCloud CPD 예외 처리 규칙 (주의):
- `sonar.cpd.exclusions`는 Automatic Analysis에서 동작 안함
- `sonar.exclusions`의 와일드카드도 PR 신규 코드 CPD에서 미동작
- 실제 중복 제거만 유효

---

### [2/5] Security Hotspot 패턴 검사

변경된 파일(`git diff --name-only origin/master...HEAD`)에서 SonarCloud가 탐지하는 알려진 패턴을 탐색한다.

#### Dockerfile 규칙 (변경된 Dockerfile 있을 때만)

```
S6501 — runner 스테이지에 USER node 없음
S6505 — pnpm install에 --ignore-scripts 없음
```

변경된 Dockerfile에서:
- `USER node` 라인 존재 여부
- `pnpm install` 또는 `npm install` 명령에 `--ignore-scripts` 포함 여부

#### TypeScript/JavaScript 규칙

변경된 `.ts`/`.tsx` 파일에서:

```
S4721 — eval() 또는 Function() 사용
S2083 — 경로 조작 가능성 (path.join에 외부 입력 직접 전달)
S5122 — CORS 와일드카드 (* 허용)
S3649 — SQL 인젝션 가능성 (템플릿 리터럴 SQL)
```

각 패턴 탐색 후 발견 위치 보고.

#### Electron IPC 보안

변경된 파일 중 `ipcMain` 또는 `ipcRenderer` 포함 파일에서:
- 렌더러에 토큰/시크릿이 직접 전달되는지 확인
- `contextBridge.exposeInMainWorld`로 노출된 API에 민감 데이터 포함 여부

---

### [3/5] 신뢰성 이슈 패턴 검사

변경된 파일에서 SonarCloud Reliability 규칙 위반 패턴 탐색:

```
S2933 — class property를 readonly로 선언 가능한데 하지 않은 경우
S4325 — noUncheckedIndexedAccess 환경에서 배열/객체 인덱스 접근 시 undefined 가드 없음
S3776 — 함수 cognitive complexity > 15 (중첩 if/for/switch 과다)
S107  — 함수 파라미터 수 > 7
S6544 — Promise를 반환하는 함수에 async 없이 then() 체이닝
S4507 — 테스트 코드에서 debugger 문 또는 console.log 남음
S5443 — os.tmpdir() 대신 하드코딩된 /tmp 사용
```

각 패턴을 변경 파일에서 Grep으로 탐색한다. 발견 시 파일명·줄 번호·수정 방법 출력.

---

### [4/5] 테스트 커버리지 영향 분석

변경된 소스 파일(`.ts`/`.tsx`, 테스트 파일 제외)에 대응하는 테스트 파일이 존재하는지 확인:

- `src/foo.ts` → `test/foo.test.ts` 또는 `src/__tests__/foo.test.ts`
- 테스트 없는 신규 파일: SonarCloud 커버리지 하락 위험 경고

SonarCloud 커버리지 게이트: 신규 코드 80% 미만 시 실패 가능.

---

### [5/5] 브랜치 네이밍 및 PR 의존성 확인

- 브랜치명이 `feat/`, `fix/`, `docs/`, `chore/` 중 하나로 시작하는지 확인
- 직접 `master` 브랜치에서 작업 중이면 경고 (master 직접 push 금지)
- 변경 파일이 다른 진행 중인 브랜치와 겹치는지 주의사항 안내

---

### 결과 요약 형식

```
=== SONAR-CHECK 결과 ===

[1/5] CPD           ✅ PASS (0 clones)  /  ❌ FAIL — <파일 목록>
[2/5] Security      ✅ PASS  /  ⚠️ WARN — <패턴명: 위치>
[3/5] Reliability   ✅ PASS  /  ⚠️ WARN — <규칙명: 위치>
[4/5] Coverage      ✅ 테스트 있음  /  ⚠️ WARN — 미커버 파일: <목록>
[5/5] 브랜치        ✅ PASS  /  ❌ FAIL — <사유>

위험도 평가:
- CRITICAL (PR 실패 확실): CPD 위반, master 직접 push
- HIGH (품질 게이트 실패 가능): Security Hotspot, Reliability 규칙 위반
- MEDIUM (커버리지 하락): 테스트 없는 신규 파일
- LOW (경고만): 브랜치명 형식

SonarCloud 대시보드: https://sonarcloud.io/project/overview?id=xzawed_xzawed-pais
```

WARN/FAIL 항목에 대해 구체적 수정 방법과 해당 CLAUDE.md 섹션 참조를 제공한다.

---

### 참고: SonarCloud 이슈 이력 (이미 해결된 것들)

다음 이슈는 과거 PR에서 이미 수정됨. 재발 시 즉시 수정:
- `dangerouslySetInnerHTML` 사용 (PR #21 — XSS, Shiki HAST 방식으로 교체)
- `spawn(cmd, [], {shell:true})` (PR #19 — CMDi, shell:false로 교체)
- 하드코딩 `/tmp` (PR #25 — os.tmpdir() 교체)
- OAuth state 파라미터 누락 (PR #19 — randomBytes(32) state 추가)
- `fetch` URL 미검증 (PR #22 — new URL() 파싱 + protocol 검증 추가)
