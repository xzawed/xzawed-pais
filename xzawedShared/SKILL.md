---
name: shared-skills
scope: service
version: 1.0.0
description: xzawedShared 라이브러리 개발·관리 스킬
---

# xzawedShared 스킬

**빌드**: `pnpm build` (다른 서비스 테스트 전 필수)
**관련 문서**: [docs/services/shared.md](../docs/services/shared.md)

---

### add-base-consumer-feature
BaseConsumer에 새 기능 추가

**파일**: `src/streams/base-consumer.ts`

**주의사항**:
- 기능 추가 후 7개 의존 서비스 모두 `pnpm build && pnpm test` 확인 필요
- 인터페이스 변경 시 하위 호환성 유지 (옵션 파라미터로 추가)

**검증**:
```bash
pnpm build
for svc in xzawedPlanner xzawedDeveloper xzawedDesigner xzawedTester \
           xzawedBuilder xzawedWatcher xzawedSecurity; do
  cd ../$svc && pnpm test && cd ../xzawedShared
done
```

---

### update-workspace-guard
validateWorkspaceRoot 로직 수정

**파일**: `src/workspace-guard.ts`, `src/__tests__/workspace-guard.test.ts`

**현재 로직**: `path.resolve(root) === path.parse(resolved).root` 이면 throw
**수정 시**: 테스트 먼저 실패하게 만들고 구현 변경 (TDD)

---

### publish-package
패키지 버전 업데이트 및 의존 서비스에 반영

```bash
# package.json version 업데이트
npm version patch  # 또는 minor/major

# 빌드
pnpm build

# 각 의존 서비스에서 버전 업데이트 확인
for svc in xzawedPlanner xzawedDeveloper xzawedDesigner xzawedTester \
           xzawedBuilder xzawedWatcher xzawedSecurity; do
  echo "=== $svc ===" && cat ../$svc/package.json | grep agent-streams
done
```
