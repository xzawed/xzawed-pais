---
allowed-tools: Read, Edit, Bash(git diff:*), Glob
description: i18n 키를 ko/en/ja 앱·서버·UI 파일에 동시 추가하는 워크플로우. 사용법: /i18n-add <namespace>.<key> <ko-text>
---

## Context

- 앱 locales 현황:
  - ko/app.json: !`node --input-type=module --eval "import fs from 'fs'; const j=JSON.parse(fs.readFileSync('d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/src/renderer/src/locales/ko/app.json','utf8')); console.log(JSON.stringify(Object.keys(j),null,2))"`
- 서버 locales ko/server.json 키: !`node --input-type=module --eval "import fs from 'fs'; const j=JSON.parse(fs.readFileSync('d:/Source/xzawed-pais/xzawedOrchestrator/packages/server/src/locales/ko/server.json','utf8')); console.log(JSON.stringify(Object.keys(j),null,2))"`

## Your task

이 스킬은 **워크플로우**다. 사용자 입력에서 namespace, key, ko-text를 파싱하고 4개 locale 파일 그룹에 동시 추가한다.

### 입력 파싱

사용자 메시지에서 다음을 추출:
- `<namespace>.<key>` — 점 구분 경로. 예: `chat.send_button`, `error.unauthorized`, `ui.badge_label`
- `<ko-text>` — 한국어 텍스트 (따옴표 있거나 없거나)

namespace 매핑:
- `app.*` → 앱 locales (app.json) + 컴포넌트에서 `useTranslation('app')` 사용
- `common.*` → 앱 공통 (common.json) + `useTranslation('common')` 사용
- `server.*` → 서버 locales (server.json) + `server-i18n.ts`에서 사용
- `ui.*` → UI 패키지 (ui.json) + `@xzawed/ui` 컴포넌트에서 사용

namespace가 `app` 또는 `common`이면 앱 locales(3개 언어), `server`이면 서버 locales(3개 언어), `ui`이면 UI locales(3개 언어)를 수정한다.

### 파일 경로

앱 locales:
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/src/renderer/src/locales/ko/app.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/src/renderer/src/locales/en/app.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/src/renderer/src/locales/ja/app.json`

common locales:
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/src/renderer/src/locales/ko/common.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/src/renderer/src/locales/en/common.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/app/src/renderer/src/locales/ja/common.json`

서버 locales:
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/server/src/locales/ko/server.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/server/src/locales/en/server.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/server/src/locales/ja/server.json`

UI locales:
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/ui/src/locales/ko/ui.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/ui/src/locales/en/ui.json`
- `d:/Source/xzawed-pais/xzawedOrchestrator/packages/ui/src/locales/ja/ui.json`

### 번역 생성 규칙

ko 텍스트를 기반으로 en, ja 번역을 생성한다:
- **en**: 자연스러운 영어로 번역. UI 문자열은 간결하게. 오류 메시지는 명확하게.
- **ja**: 자연스러운 일본어로 번역. UI 문자열은 敬語 수준 고려.

번역 품질 원칙:
- 버튼 텍스트: 동사+명사 형태 (예: "Save Settings" / "설정 저장" / "設定を保存")
- 오류 메시지: 사용자 친화적, 해결 방법 포함 가능
- 플레이스홀더: `{{변수명}}` 형식 유지 (i18next interpolation)

### 중첩 키 처리

`chat.send_button` 형식의 경우 JSON 중첩 구조를 유지한다:

```json
// 기존 app.json (chat 섹션 있음)
{
  "chat": {
    "empty_state": "새 세션을 시작해주세요",
    "send_button": "전송"   ← 이 키를 chat 섹션 안에 추가
  }
}
```

`error.unauthorized` 형식의 경우 server.json의 기존 플랫 구조를 따른다:

```json
{
  "error.unauthorized": "인증이 필요합니다."  ← 점 표기법 키 유지
}
```

### 실행 단계

1. **파일 읽기**: 해당 namespace의 ko/en/ja 파일 3개를 모두 읽는다.
2. **키 충돌 확인**: 이미 존재하는 키면 현재 값을 보여주고 덮어쓸지 확인한다.
3. **번역 생성**: en, ja 번역을 생성한다.
4. **파일 수정**: `Edit` 도구로 3개 파일에 동시 추가한다.
   - JSON 구조를 파괴하지 않도록 마지막 키 다음에 추가
   - 들여쓰기는 기존 파일과 동일하게 유지 (2 spaces)
5. **결과 요약 출력**:

```
i18n 키 추가 완료: <namespace>.<key>

ko: "<ko-text>"
en: "<en-text>"
ja: "<ja-text>"

수정된 파일:
- locales/ko/<file>.json
- locales/en/<file>.json
- locales/ja/<file>.json

사용 예시:
  // 컴포넌트에서
  const { t } = useTranslation('<namespace>')
  t('<key>')  // → "<ko-text>"

  // 서버에서 (server namespace)
  req.t('<namespace>.<key>')
```

6. **주의사항 출력** (해당 시):
   - `ui` namespace: `@xzawed/ui` 패키지의 컴포넌트에서만 사용. 일반 앱 컴포넌트는 `app` namespace 사용.
   - `server` namespace: `packages/server/src/i18n/server-i18n.ts`를 통해 `LocalizedRequest.t()` 메서드로 접근.
   - 번역 파일 변경 후 `pnpm build` 불필요 (런타임 JSON 로드). 단, TypeScript 타입 재생성이 필요한 경우 `pnpm build` 실행.
