#!/usr/bin/env bash
# scripts/install-hooks.sh
# Git hooks를 .git/hooks/에 설치한다. 저장소 클론 후 1회 실행.
# 사용법: bash scripts/install-hooks.sh
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPTS_DIR="$REPO_ROOT/scripts"

install_hook() {
  local name="$1"
  local src="$SCRIPTS_DIR/${name}.sh"
  local dst="$HOOKS_DIR/$name"

  if [ ! -f "$src" ]; then
    echo "⚠️  $src 파일이 없습니다. 건너뜁니다."
    return
  fi

  cp "$src" "$dst"
  chmod +x "$dst"
  echo "  ✅ $name 설치됨 → $dst"
}

echo "Git hooks 설치 중..."
install_hook "pre-commit"
install_hook "pre-push"
echo ""
echo "설치 완료. 우회가 필요할 때: git commit --no-verify"
echo "훅 제거: rm .git/hooks/pre-commit .git/hooks/pre-push"
