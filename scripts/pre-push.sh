#!/usr/bin/env bash
# scripts/pre-push.sh
# push 직전 CPD + audit 검사를 실행한다.
# install-hooks.sh로 .git/hooks/pre-push에 복사해 사용한다.
set -euo pipefail

# stdin에서 push 대상 커밋 범위 읽기
# 형식: <local-ref> <local-sha1> <remote-ref> <remote-sha1>
BASE_SHA=""
while read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA; do
  if [ "$REMOTE_SHA" = "0000000000000000000000000000000000000000" ]; then
    # 신규 브랜치: origin/master 기준
    BASE_SHA=$(git merge-base HEAD origin/master 2>/dev/null || echo "")
  else
    BASE_SHA="$REMOTE_SHA"
  fi
done

if [ -z "$BASE_SHA" ]; then
  BASE_SHA="HEAD~1"
fi

CHANGED_SERVICES=$(git diff --name-only "$BASE_SHA" HEAD | \
  grep -E '^(xzawedOrchestrator|xzawedManager|xzawedPlanner|xzawedDeveloper|xzawedDesigner|xzawedTester|xzawedBuilder|xzawedWatcher|xzawedSecurity|xzawedShared|xzawedLauncher)/' | \
  cut -d/ -f1 | sort -u || true)

if [ -z "$CHANGED_SERVICES" ]; then
  exit 0
fi

echo "[pre-push] 검사 대상: $CHANGED_SERVICES"

# ── Step 1: jscpd (전체 레포 대상 — 부분 검사는 의미 없음) ────────────────
echo "→ CPD 검사..."
if command -v jscpd >/dev/null 2>&1; then
  JSCPD_BIN="jscpd"
elif [ -f "./node_modules/.bin/jscpd" ]; then
  JSCPD_BIN="./node_modules/.bin/jscpd"
else
  JSCPD_BIN="npx jscpd@3.5.10"
fi

CPD_OUT=$($JSCPD_BIN --config .jscpd.json --reporters console 2>&1 || true)
CLONE_COUNT=$(echo "$CPD_OUT" | grep -oE 'Found [0-9]+ clones' | grep -oE '[0-9]+' || echo "0")

if [ "${CLONE_COUNT:-0}" -gt 0 ]; then
  echo "❌ CPD 실패: $CLONE_COUNT 개 클론 발견"
  echo "$CPD_OUT" | grep -A5 'Found' || true
  echo ""
  echo "힌트: 중복 코드를 헬퍼 함수로 추출한 후 다시 push하세요"
  exit 1
fi
echo "  ✅ CPD: 클론 없음"

# ── Step 2: pnpm audit (package.json이 변경된 서비스만) ───────────────────
echo "→ 취약점 검사..."
AUDIT_FAILED=0
for SERVICE in $CHANGED_SERVICES; do
  CHANGED_PKG=$(git diff --name-only "$BASE_SHA" HEAD -- \
    "$SERVICE/package.json" "$SERVICE/pnpm-lock.yaml" 2>/dev/null || true)
  if [ -n "$CHANGED_PKG" ]; then
    echo "  → $SERVICE"
    (cd "$SERVICE" && pnpm audit --audit-level=moderate 2>&1) || {
      echo "❌ 취약점 발견: $SERVICE"
      AUDIT_FAILED=1
    }
  fi
done

if [ "$AUDIT_FAILED" -eq 1 ]; then
  echo ""
  echo "힌트: pnpm audit --fix 또는 pnpm.overrides로 버전 고정 후 다시 push하세요"
  exit 1
fi
echo "  ✅ audit: 이상 없음"

echo "[pre-push] ✅ 모든 검사 통과"
