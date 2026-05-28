#!/usr/bin/env bash
# scripts/pre-commit.sh
# staged 파일이 속한 서비스만 TypeScript 타입 체크를 실행한다.
# install-hooks.sh로 .git/hooks/pre-commit에 복사해 사용한다.
set -euo pipefail

CHANGED_SERVICES=$(git diff --cached --name-only | \
  grep -E '^(xzawedOrchestrator|xzawedManager|xzawedPlanner|xzawedDeveloper|xzawedDesigner|xzawedTester|xzawedBuilder|xzawedWatcher|xzawedSecurity|xzawedShared|xzawedLauncher)/' | \
  cut -d/ -f1 | sort -u)

if [ -z "$CHANGED_SERVICES" ]; then
  exit 0
fi

echo "[pre-commit] TypeScript check: $CHANGED_SERVICES"

for SERVICE in $CHANGED_SERVICES; do
  echo "  → $SERVICE"
  case "$SERVICE" in
    xzawedOrchestrator|xzawedManager)
      (cd "$SERVICE" && pnpm build 2>&1 | tail -30) || {
        echo "❌ 빌드 실패: $SERVICE — 오류를 수정한 후 다시 커밋하세요"
        exit 1
      }
      ;;
    *)
      (cd "$SERVICE" && pnpm exec tsc --noEmit 2>&1 | tail -30) || {
        echo "❌ TypeScript 타입 오류: $SERVICE — 오류를 수정한 후 다시 커밋하세요"
        exit 1
      }
      ;;
  esac
done

echo "[pre-commit] ✅ TypeScript 검사 통과"
