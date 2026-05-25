---
name: watcher-skills
scope: service
version: 1.0.0
description: xzawedWatcher 개발·디버깅·운영 스킬
---

# xzawedWatcher 스킬

**테스트 실행**: `pnpm test` (27건)
**참고**: Claude API 미사용 — ANTHROPIC_API_KEY 불필요
**관련 문서**: [docs/services/watcher.md](../docs/services/watcher.md)

---

### add-trigger-pattern
새 파일 감시 트리거 패턴 추가

**파일**: `src/watcher.ts`의 safeTriggers 필터

**주의사항**:
- `triggers`는 상대경로 glob만 허용 (절대경로·'..' 포함 불가 — Zod에서 차단)
- chokidar `cwd` 옵션은 절대경로에 적용되지 않으므로 Zod 단계 차단이 핵심

**검증**: `pnpm test src/watcher.test.ts`

---

### tune-debounce
디바운스 타이밍 조정

**파일**: `src/config.ts`의 DEBOUNCE_MS 기본값 또는 환경변수

```bash
# 테스트에서 vi.useFakeTimers() 활용
pnpm test src/watcher.test.ts -- --grep "debounce"
```

---

### debug-watcher-leak
Watcher 누수 감지 (세션 종료 후에도 watch 지속)

```bash
# WatcherStore의 활성 세션 수 확인 (health endpoint 통해)
curl http://localhost:3007/health

# 로그에서 'stop_watch' 이벤트 확인
LOG_LEVEL=debug pnpm dev 2>&1 | grep -i "stop_watch\|watcher"
```
