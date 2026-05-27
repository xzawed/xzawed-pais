[홈](../README.md) > [가이드](./README.md) > 번역 기여 가이드

# 번역 기여 가이드

xzawedPAIS는 한국어·영어·일본어 3개 언어를 지원한다. 이 가이드는 번역 파일 구조, 키 추가 방법, 새 언어 추가 방법, E2E 작성 규칙을 설명한다.

---

## 지원 언어

| 코드 | 언어 | 상태 |
|------|------|------|
| `ko` | 한국어 | 기본값 (완전 지원) |
| `en` | English | 완전 지원 |
| `ja` | 日本語 | 완전 지원 |

---

## 번역 파일 구조

```
xzawedOrchestrator/
├── packages/app/src/renderer/src/locales/
│   ├── ko/
│   │   ├── common.json   # 공통 버튼·레이블 (15 키)
│   │   └── app.json      # Electron 앱 전용 문자열 (39 키)
│   ├── en/
│   │   ├── common.json
│   │   └── app.json
│   └── ja/
│       ├── common.json
│       └── app.json
├── packages/ui/src/locales/
│   ├── ko/ui.json        # 공유 UI 컴포넌트 (16 키)
│   ├── en/ui.json
│   └── ja/ui.json
└── packages/server/src/locales/
    ├── ko/server.json    # 서버 오류·상태 메시지 (11 키)
    ├── en/server.json
    └── ja/server.json
```

### 네임스페이스

| 네임스페이스 | 파일 | 용도 |
|---|---|---|
| `app` | `packages/app/src/renderer/src/locales/{lang}/app.json` | Electron 앱 |
| `common` | `packages/app/src/renderer/src/locales/{lang}/common.json` | 공통 버튼·레이블 |
| `ui` | `packages/ui/src/locales/{lang}/ui.json` | 공유 컴포넌트 |
| `server` | `packages/server/src/locales/{lang}/server.json` | 서버 메시지 |

---

## 번역 키 추가

### 클라이언트 (Electron 앱)

1. `packages/app/src/renderer/src/locales/ko/app.json`에 키 추가 (한국어 기본값)
2. `en/app.json`, `ja/app.json`에 동일 키 번역 추가
3. 컴포넌트에서 사용:

```tsx
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t } = useTranslation('app')
  return <button>{t('section.new_key')}</button>
}
```

### 서버

1. `packages/server/src/locales/ko/server.json`에 키 추가
2. `en/server.json`, `ja/server.json`에 번역 추가
3. 라우트에서 사용:

```typescript
import { t, parseLocale } from '../i18n/server-i18n.js'

const locale = parseLocale(request.headers['accept-language'])
reply.send({ message: t('error.new_key', locale) })
```

### 키 네이밍 규칙

- 섹션별 중첩 구조 사용: `settings.language`, `chat.send_button`
- snake_case 사용
- 동사+명사 패턴: `save_button`, `cancel_button`, `error_message`

---

## 새 언어 추가

1. **로케일 파일 생성**: 각 패키지의 `locales/<lang>/` 디렉터리에 파일 생성 (ko 파일 복사 후 번역)
2. **i18n.ts 업데이트**: `packages/app/src/renderer/src/lib/i18n.ts` resources에 추가
3. **Locale 타입 업데이트**: `packages/app/src/renderer/src/lib/detect-locale.ts` LOCALES 배열에 추가
4. **app.store.ts 업데이트**: Locale 유니온 타입에 추가
5. **SettingsModal.tsx 업데이트**: LANG_OPTIONS 배열에 추가
6. **서버 LocaleSet 업데이트**: `packages/server/src/i18n/server-i18n.ts` SERVER_LOCALES에 추가

---

## E2E 작성 규칙

### 하지 말아야 할 것

```typescript
// 텍스트 기반 선택자 — 로케일 변경 시 깨짐
await page.getByText('설정 저장').click()
await page.getByRole('button', { name: '닫기' }).click()
```

### 해야 할 것

```typescript
// data-testid 전용 선택자 — 로케일 무관
await page.getByTestId('settings-save').click()
await page.getByTestId('settings-cancel').click()
```

### data-testid 네이밍 규칙

- `kebab-case` 사용
- 컴포넌트-요소 계층 구조: `settings-modal`, `settings-save`, `settings-cancel`
- 패널 타입 포함: `mcp-panel`, `github-panel`, `plugin-panel`
- 인증 관련: `login-email`, `login-submit`, `login-error`

### 로케일 전환 테스트

언어 전환이 필요한 경우 `SettingsModal` POM 사용:

```typescript
import { SettingsModal } from '../pages/SettingsModal.js'

const settings = new SettingsModal(page)
await settings.changeLanguage('en')
// 이후 data-testid 선택자로 검증
```

---

## 키 일관성 검증

PR 전에 반드시 실행:

```bash
node -e "
const ko = require('./xzawedOrchestrator/packages/app/src/renderer/src/locales/ko/app.json')
const en = require('./xzawedOrchestrator/packages/app/src/renderer/src/locales/en/app.json')
const flat = (obj, p='') => Object.entries(obj).flatMap(([k,v]) =>
  typeof v==='object' ? flat(v, p+k+'.') : [p+k])
const missing = flat(ko).filter(k => !flat(en).includes(k))
if (missing.length) { console.error('누락 키:', missing); process.exit(1) }
else console.log('ko/en 키 일치 ✅')
"
```

---

## 관련 문서

- [기여 가이드](../development/contributing.md)
- [서비스: xzawedOrchestrator](../services/orchestrator.md)
