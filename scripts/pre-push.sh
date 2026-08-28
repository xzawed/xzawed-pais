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

# 서비스 목록은 여기 한 곳이 정본이다 — 변경 감지와 CPD 스캔 경로가 같은 목록을 쓴다.
# 둘을 따로 적으면 새 서비스가 한쪽에만 들어가 조용히 스캔에서 빠진다.
SERVICES="xzawedOrchestrator xzawedManager xzawedPlanner xzawedDeveloper xzawedDesigner xzawedTester xzawedBuilder xzawedWatcher xzawedSecurity xzawedShared xzawedLauncher"
SERVICES_RE=$(echo "$SERVICES" | tr ' ' '|')

CHANGED_SERVICES=$(git diff --name-only "$BASE_SHA" HEAD | \
  grep -E "^($SERVICES_RE)/" | \
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

# 경로를 **반드시** 준다. 안 주면 jscpd 는 0개 파일을 스캔하고 즉시 끝난다
# (실측: `Detection time: 0.16ms`, 표도 `Found N clones` 줄도 없음). 그 상태에서
# 예전 코드는 `|| echo "0"` 으로 0을 만들어 "클론 없음"을 찍었다 — 상시 no-op 이자
# fail-open 이었다. 경로를 주면 478파일 37,856줄을 7.6초에 스캔한다.
# shellcheck disable=SC2086
CPD_RAW=$($JSCPD_BIN --config .jscpd.json --reporters console $SERVICES 2>&1) && CPD_RC=0 || CPD_RC=$?
# ANSI 색코드를 벗긴다 — 안 벗기면 `[22m` 같은 이스케이프의 숫자가 표의 수치로 잘못 잡힌다
# (실측: 파일 수 478 을 22 로 읽었다).
CPD_OUT=$(echo "$CPD_RAW" | sed 's/\x1b\[[0-9;]*m//g')

# `Found N clones.` 가 없으면 스캔이 성립하지 않은 것이다 — 0으로 간주하지 않는다.
CLONE_LINE=$(echo "$CPD_OUT" | grep -oE 'Found [0-9]+ clones' || true)
if [ -z "$CLONE_LINE" ]; then
  echo "❌ CPD 게이트가 돌지 않았습니다 (exit=$CPD_RC)"
  echo "   'Found N clones.' 줄이 출력에 없습니다 — 스캔한 파일이 0개이거나 jscpd 가 죽었습니다."
  echo "$CPD_OUT" | tail -20
  exit 1
fi

CLONE_COUNT=$(echo "$CLONE_LINE" | grep -oE '[0-9]+')
if [ "$CLONE_COUNT" -gt 0 ]; then
  echo "❌ CPD 실패: $CLONE_COUNT 개 클론 발견"
  echo "$CPD_OUT" | grep -B2 -A5 'Found' || true
  echo ""
  echo "힌트: 중복 코드를 헬퍼 함수로 추출한 후 다시 push하세요"
  exit 1
fi

# 클론 0인데 종료코드가 non-zero 면 삼키지 않는다(설정 오류·리포터 실패 등).
if [ "$CPD_RC" -ne 0 ]; then
  echo "❌ CPD: 클론은 0인데 jscpd 가 exit=$CPD_RC 로 끝났습니다"
  echo "$CPD_OUT" | tail -20
  exit 1
fi

# 표는 박스문자(│)로 그려지므로 구분자에 기대지 않는다 — Total 행의 첫 정수를 뽑는다.
SCANNED=$(echo "$CPD_OUT" | awk '/Total:/ {for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) { print $i; exit }}')
if [ "${SCANNED:-0}" -lt 1 ]; then
  echo "❌ CPD: 스캔한 파일이 0개입니다 — 게이트가 아무것도 검사하지 않았습니다"
  echo "$CPD_OUT" | tail -20
  exit 1
fi
echo "  ✅ CPD: 클론 없음 (${SCANNED}개 파일 스캔)"

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
