# SonarCloud 트러블슈팅 가이드

루트 `CLAUDE.md`의 SonarCloud 섹션에서 추출. xzawedPAIS는 **GitHub App Automatic Analysis** 방식으로 동작한다.

---

## 자동화된 CPD 진단 도구 (PR 생성 시 자동 실행)

PR을 열면 CI에서 두 개의 진단 댓글이 자동으로 올라온다.

| 댓글 | 정보 | 소요 시간 |
|------|------|-----------|
| **jscpd** (`<!-- jscpd-report -->`) | 중복 파일 경로 + 줄 번호 | ~30초 |
| **SonarCloud API** (`<!-- sonar-cpd-report -->`) | 품질 게이트 상태 + 파일별 중복 밀도 | ~3-5분 |

로컬 사전 확인:
```bash
npx jscpd@3.5.10 --config .jscpd.json
```

---

## CPD 실패 시 대응 순서

1. PR 댓글에서 jscpd 리포트 확인 → 중복 파일·줄 번호 특정
2. `git diff master...HEAD -- <파일>` 로 PR 신규 코드 확인 → 반복 패턴을 헬퍼로 추출
3. **exclusions 설정은 신뢰하지 말 것** — 실제 중복 제거가 유일한 확실한 해결책
4. SonarCloud API 댓글에서 품질 게이트 통과 여부 최종 확인

---

## sonar-project.properties 핵심 원칙

```properties
# sonar.cpd.exclusions: Automatic Analysis에서 완전 무효
# sonar.exclusions 와일드카드(**/*.test.ts 등): PR 신규 코드 분석에서도 동작 안 함
# → 특정 경로 exclusion(소스 파일 한정)만 일부 동작
# pnpm-lock.yaml: 반복 해시 패턴으로 new_duplicated_lines_density 급등 → 반드시 exclusions에 포함
sonar.exclusions=**/*.test.ts,**/*.spec.ts,**/__tests__/**,**/dist/**,**/*.d.ts,**/pnpm-lock.yaml
```

---

## Gotcha: SonarCloud PR 신규 코드 CPD

- **새 코드 기준**: PR diff에서 추가·변경된 줄만 "신규 코드"로 계산
- **exclusions 무효**: `**/*.test.ts` 와일드카드는 PR 신규 코드에서 동작하지 않음
- **CPD 토큰 임계값**: `sonar.cpd.minimumTokens=100` 설정에도 SonarCloud 내부 임계값은 ~30-37 토큰
- **유일한 해결책**: 헬퍼 함수(`loadModules()`, `makeRunner()` 등)로 실제 중복 제거

---

## lcov 커버리지 업로드 (Turborepo 서비스)

xzawedOrchestrator·xzawedManager는 CI에서 shard 분할 실행 후 lcov를 병합하여 SonarCloud에 업로드한다.

```yaml
# shard 실행
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-1 --shard=1/2
pnpm vitest run --coverage --coverage.reportsDirectory=coverage/shard-2 --shard=2/2

# lcov 병합 — cat 사용 (vitest merge-coverage / --mergeReports는 사용 불가)
mkdir -p coverage && cat coverage/shard-*/lcov.info > coverage/lcov.info
```

> **주의**: `vitest merge-coverage`는 vitest 3.x에 존재하지 않는 서브커맨드이다.  
> `vitest --mergeReports`는 blob reporter 전용이며 lcov를 지원하지 않는다.  
> lcov 포맷은 복수 SF 레코드를 SonarCloud가 올바르게 합산하므로 `cat` 병합이 정확하다.

**상세**: [ADR-002](adr/002-ci-stability-patterns.md)

---

## Security Hotspot 오진 주의

"N Security Hotspots" 실패 보고 시 **추측으로 수정하지 말 것**. 규칙 ID 확인 후 처리.

진단 순서:
1. PR 댓글 SonarCloud 링크 → Security Hotspots 탭 → **규칙 ID 직접 확인**
2. `curl "https://sonarcloud.io/api/hotspots/search?projectKey=xzawed_xzawed-pais&pullRequest=<PR번호>&ps=50"`
3. SonarCloud Automatic Analysis는 push 후 **3~5분** 소요

### Dockerfile 핫스팟 패턴

- `docker:S6501` — runner 스테이지에 `USER node` 필수 (`EXPOSE` 다음, `CMD` 앞)
- `docker:S6505` — `pnpm install`에 `--ignore-scripts` 필수

---

## 핫스팟 해소 절차

S4721 등은 코드 수정만으로 자동 해소되지 않는다.
SonarCloud 대시보드에서 "Safe" 직접 표시 → 새 커밋 push → 재분석 트리거.

---

## Former-Hotspot → Vulnerability 처리

기존 "Reviewed" 핫스팟이 오픈 Vulnerability로 재분류될 경우:

- **S5443 — Publicly writable directory**: 테스트 파일의 `/tmp` mock 경로는 `// NOSONAR` 억제 적절
- 프로덕션 코드의 `/tmp` 사용: `os.tmpdir()` + `fs.mkdtemp()` 교체
- `// NOSONAR`는 해당 줄만 억제 (블록 전체에 사용 금지)
