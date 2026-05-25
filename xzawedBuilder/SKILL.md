---
name: builder-skills
scope: service
version: 1.0.0
description: xzawedBuilder 개발·디버깅·운영 스킬
---

# xzawedBuilder 스킬

**테스트 실행**: `pnpm test` (49건)
**관련 문서**: [docs/services/builder.md](../docs/services/builder.md)

---

### add-build-tool
새 빌드 도구 지원 추가

**파일**: `src/detector.ts`의 detectBuildInfo() + `src/builder.ts`의 ALLOWED_PREFIXES

**예시 — Gradle 추가**:
```typescript
// detector.ts
if (await exists(path.join(dir, 'build.gradle'))) {
  return { command: 'gradle', args: ['build'], cwd: dir }
}

// builder.ts ALLOWED_PREFIXES
const ALLOWED_PREFIXES = [..., 'gradle']
```

**검증**: `pnpm test src/detector.test.ts`

---

### tune-artifact-detection
빌드 아티팩트 감지 개선

**현재 문제**: Claude가 아티팩트 경로를 추론 (실제 파일 목록 아님)
**개선 방향**: 빌드 전후 파일 스냅샷 비교

```typescript
// executor.ts에 추가
const before = await glob('dist/**/*', { cwd: projectPath })
await runBuild(...)
const after = await glob('dist/**/*', { cwd: projectPath })
const newFiles = after.filter(f => !before.includes(f))
```

---

### debug-preinstall
runPreInstall() 동작 확인

```bash
# node_modules 없을 때만 실행되는지 확인
rm -rf /tmp/test-project/node_modules
pnpm test src/builder.test.ts -- --grep "preinstall"
```
