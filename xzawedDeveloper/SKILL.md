---
name: developer-skills
scope: service
version: 1.0.0
description: xzawedDeveloper 개발·디버깅·운영 스킬
---

# xzawedDeveloper 스킬

**테스트 실행**: `pnpm test` (수량은 루트 CLAUDE.md 서비스 표 참조)
**관련 문서**: [docs/services/developer.md](../docs/services/developer.md)

---

### add-file-operation
새 파일 I/O 오퍼레이션 추가

**파일**: `src/fileio.ts`

**현재 오퍼레이션**: create / modify / delete (.bak 리네임)

**새 오퍼레이션 추가 시**:
```typescript
// fileio.ts의 applyChange()에 새 case 추가
case 'rename':
  await fs.rename(
    path.resolve(workspaceRoot, change.path),
    path.resolve(workspaceRoot, change.newPath!)
  )
  break
```

**검증**: `pnpm test src/fileio.test.ts`

---

### tune-codegen-prompt
코드 생성 프롬프트 조정

**파일**: `src/claude/runner.ts`의 SYSTEM_PROMPT

**핵심 지침 (변경 금지)**:
- "절대경로 대신 상대경로 사용" — 보안 필수
- "FileChange[] JSON 배열만 반환" — 파서 의존

---

### debug-workspace-path
워크스페이스 경로 문제 디버깅

```bash
# 환경변수 확인
echo $WORKSPACE_ROOT

# validateWorkspaceRoot 수동 테스트
node -e "
  const { validateWorkspaceRoot } = require('@xzawed/agent-streams')
  try { validateWorkspaceRoot(process.env.WORKSPACE_ROOT); console.log('OK') }
  catch(e) { console.error('FAIL:', e.message) }
"

# .bak 파일 정리 (deleteFile 후 남은 파일)
find $WORKSPACE_ROOT -name "*.bak" -mtime +7
```
