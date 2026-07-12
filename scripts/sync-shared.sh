#!/usr/bin/env bash
# xzawedShared를 빌드하고 7개 독립 에이전트 서비스의 file: 복사본을 새로고침한다.
#
# 왜 필요한가:
#   독립 서비스는 @xzawed/agent-streams 를 `file:../xzawedShared` 로 참조한다.
#   file: dep 은 install 시점에 node_modules 로 '복사'되므로, xzawedShared 를 로컬에서
#   재빌드해도 이 복사본은 다음 install 까지 stale 로 남는다(신규 파일 누락 → 혼란스러운
#   런타임/테스트 오류). 이 스크립트가 빌드 후 각 서비스 복사본을 갱신한다.
#
# 로컬 개발 전용:
#   CI(shared-lib 잡 → 아티팩트 → 서비스 fresh install)와 Docker(멀티스테이지 fresh
#   install)는 항상 새로 설치하므로 이 스크립트가 필요 없다.
#
# 안전성:
#   `pnpm install --frozen-lockfile` 은 file: 복사본을 갱신하되 lockfile 을 수정하지
#   않는다(pnpm 10 의 rollup libc: 아티팩트로 lockfile 을 더럽히지 않도록 frozen 사용).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

SERVICES=(
  xzawedPlanner
  xzawedDeveloper
  xzawedDesigner
  xzawedTester
  xzawedBuilder
  xzawedWatcher
  xzawedSecurity
)

echo "[sync-shared] xzawedShared 빌드 중..."
(cd "$ROOT/xzawedShared" && pnpm install --frozen-lockfile && pnpm build)
echo "[sync-shared] xzawedShared/dist 갱신 완료"

failed=()
for svc in "${SERVICES[@]}"; do
  dir="$ROOT/$svc"
  if [[ ! -d "$dir" ]]; then
    echo "[sync-shared] ⚠ $svc 디렉토리 없음 — 건너뜀"
    continue
  fi
  echo "[sync-shared] $svc 복사본 새로고침..."
  # frozen-lockfile: 복사본만 갱신하고 lockfile 은 건드리지 않는다(검증됨).
  # 실패(lockfile 불일치 등)해도 나머지 서비스는 계속 처리하고 마지막에 요약한다.
  if (cd "$dir" && pnpm install --frozen-lockfile >/dev/null); then
    echo "[sync-shared]   ✓ $svc"
  else
    echo "[sync-shared]   ✗ $svc — pnpm install 실패(lockfile 불일치 등 · 수동 확인 필요)"
    failed+=("$svc")
  fi
done

if (( ${#failed[@]} > 0 )); then
  echo "[sync-shared] 실패한 서비스: ${failed[*]}"
  exit 1
fi

echo "[sync-shared] 완료 — ${#SERVICES[@]}개 서비스가 최신 xzawedShared 를 참조합니다."
