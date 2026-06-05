# P4 데모 시연 — UISpec 정적 목업 미리보기 설계

- 작성일: 2026-06-05
- 상태: 설계 승인 → 구현 계획 대기
- 관련 비전/스펙: [`2026-06-01-platform-vision.md`](2026-06-01-platform-vision.md) (Roadmap §5 P4), [`2026-06-01-manager-approval-gates-design.md`](2026-06-01-manager-approval-gates-design.md) §9 "A2"

## 1. 목표

Designer가 산출한 UI 설계(UISpec/ComponentSpec)를 **구현 전 정적 목업으로 PO에게 시연**하고, 승인 게이트(P3)와 연동해 승인/수정/중단받는다. 비전 구성요소 #6.

범위(브레인스토밍 확정): **(A) 배선** + **(B) 목업 충실도 향상(Spec 인터프리터)**. 계약 통합·HTML 렌더는 범위 밖.

## 2. 현재 상태 (코드 근거)

P4는 이미 ~80% 배선돼 있다. 누락은 Manager 승인 게이트 단 한 곳.

| 구간 | 상태 | 근거 |
|---|---|---|
| Designer 산출 | ✅ `DesignUiOutput { components[], uiSpec{type,title,content}, content }` | `xzawedDesigner/src/types.ts`, `xzawedManager/.../tools/design-ui.ts` |
| Manager info_request payload 타입 | ✅ `uiSpec?: UISpec` · `approval?` 공존 허용 | `xzawedManager/.../types/streams.ts:49-92` |
| **Manager 승인 게이트 publish** | ❌ **`approval{stage,summary,mode}`만 싣고 `uiSpec` 미첨부** | `xzawedManager/.../claude/runner.ts:299-310` |
| Manager 명확화 경로 | ✅ `ClarificationNeededError.uiSpec` 첨부(참고 패턴) | `runner.ts:382-393` |
| Orchestrator 릴레이/스키마 | ✅ `uiSpec: z.unknown().optional()` 통과 | `consumer.ts`, `sessions.route.ts:205-212` |
| 렌더러 store 주입 | ✅ 모든 WS 메시지의 `msg.uiSpec` → `store.setUiSpec` | `lib/useSessionWs.ts:110-112`, `store/chat.store.ts:18,96` |
| 승인 카드 렌더 조건 | ✅ `stage==='design_ui' && uiSpec → <UiSpecPreview/>` | `components/ChatView.tsx:203-204` |
| 목업 렌더러 | ⚠️ **존재하나 저충실도** — form은 라벨 목록, components는 단순 박스 와이어프레임 | `components/chat/UiSpecPreview.tsx` |

**결론**: ① 승인 게이트가 design_ui 결과의 `uiSpec`을 안 실어 정상 흐름에서 목업이 렌더되지 않음(실제 갭). ② 렌더러는 동작하나 충실도가 낮음.

## 3. 계약 형태 (확정)

렌더러가 소비하는 `@xzawed/shared`(= `xzawedOrchestrator/packages/shared/src/types/ui-spec.ts`)와 Manager `streams.ts`의 `UISpec`은 **동일 형태**(둘 다 `fields?`·`content?`·`components?` 보유):

```ts
type UIFieldType = 'text' | 'textarea' | 'select' | 'checkbox_group' | 'number'
interface UIField { id; type: UIFieldType; label; required?; options?: {value;label}[]; placeholder? }
interface ComponentSpec { name; description; props?: Record<string,string>; children?: ComponentSpec[]; cssClasses?: string[] }
interface UISpec { type: 'form'|'mockup_viewer'|'progress_board'; title?; fields?: UIField[]; submitAction?; content?; components?: ComponentSpec[] }
```

→ **Manager·Orchestrator 타입 변경 불필요.** 배선은 값 채움만.

## 4. 설계

### 4.A 배선 — Manager `applyApprovalGate` (`runner.ts`)

`block.name === 'design_ui'`일 때만 결과에서 **demoSpec**(shared `UISpec` 형태)을 구성해 승인 `info_request.payload.uiSpec`에 첨부한다(기존 `approval`과 공존).

```ts
// applyApprovalGate 내부, info_request publish payload 구성 시
const demoSpec = buildDemoSpec(block.name, result) // design_ui면 UISpec, 그 외 undefined
await producer.publish({
  ...,
  type: 'info_request',
  payload: {
    agentId: 'manager',
    content: `'${block.name}' 단계 결과를 검토하고 승인/수정/중단을 선택하세요.`,
    approval: { stage: block.name, summary, mode: 'manual' },
    ...(demoSpec ? { uiSpec: demoSpec } : {}),
  },
})
```

`buildDemoSpec` (신규, 순수 함수, 단위 테스트 대상):
- `design_ui`가 아니면 `undefined`.
- design_ui면 결과의 `uiSpec`(type/title) + `components` + `content`를 shared `UISpec`으로 병합:
  `{ type: r.uiSpec?.type ?? 'mockup_viewer', title: r.uiSpec?.title, content: r.content ?? r.uiSpec?.content, components: r.components, fields: r.uiSpec?.fields }`
- 방어: 결과가 예상 형태가 아니면(타입가드 실패) `undefined` 반환(배선 실패가 승인 흐름을 막지 않음 — summary 텍스트로 폴백).

재실행(revise) 후에도 동일하게 갱신된 결과로 demoSpec을 재구성해 최신 목업을 보여준다(루프 내 매 회 재계산).

### 4.B 충실도 — 렌더러 Spec 인터프리터

`UiSpecPreview`를 구조 스펙 → **디자인시스템 기반 styled React**로 매핑하는 인터프리터로 고도화.

**파일 구조** (격리·명료):
```
components/chat/
  UiSpecPreview.tsx        # 진입: uiSpec.type 디스패치 + components/fields/content 렌더 조합
  uispec/
    registry.tsx           # name(정규화) → 렌더러 맵 + 폴백 박스
    renderers.tsx          # 14종 styled 렌더러 (작은 순수 함수)
    props.ts               # props 추출 헬퍼(getProp/getVariant 등)
```

**렌더 규칙** (`UiSpecPreview`):
1. `components?` 있으면 → `registry`로 재귀 렌더 (충실도 핵심)
2. `fields?` 있으면(form) → **비활성 styled 입력**으로 렌더(라벨 목록 → 실제 입력 모양)
3. `content` 있으면 → 마크다운(`MarkdownContent`, 기존) — mockup_viewer/progress_board 보조
4. 모두 없으면 → "미리보기 없음" 안내(i18n)

**컴포넌트 레지스트리 (~14종 + 폴백)** — `name`을 소문자/별칭 정규화 후 매핑:

| 분류 | name(별칭) | 렌더 |
|---|---|---|
| 레이아웃 | `card`(panel,box) | 테두리 카드 컨테이너 + children |
| | `stack`(column,vstack) | 세로 flex gap |
| | `row`(hstack,inline) | 가로 flex gap |
| 폼 | `input`(textfield) | 비활성 styled input (label/placeholder/type props) |
| | `textarea` | 비활성 styled textarea |
| | `select`(dropdown) | 비활성 styled select(첫 옵션 표시) |
| | `checkbox` | 비활성 체크박스 + label |
| | `button` | styled 버튼(label/variant: primary/secondary/ghost), non-submit |
| | `label` | 폼 라벨 텍스트 |
| 콘텐츠 | `heading`(title) | h2~h4 (level prop) |
| | `text`(paragraph) | 본문 텍스트 |
| | `badge`(tag,chip) | 배지(text/variant) |
| | `list` | ul/li (items props 또는 children) |
| | `table` | 헤더/행 테이블(columns/rows props) |
| | `divider`(separator) | 구분선 |
| 폴백 | (미지원 name) | 라벨 박스(name + description) + children 재귀 (현 와이어프레임 동작 보존) |

**props·cssClasses**:
- 각 렌더러는 알려진 키만 `props: Record<string,string>`에서 읽음. 미지 키 무시.
- `cssClasses?: string[]`는 엘리먼트 `className`에 합성(디자인 의도 반영). 클래스 문자열뿐이라 주입 위험 없음. 프리뷰 컨테이너 내 스코프.

**상태/보안/디자인시스템**:
- **읽기 전용**: 모든 input `disabled`, button `type="button"`·동작 없음.
- **보안**: 순수 React 엘리먼트만. `dangerouslySetInnerHTML`·HTML 파싱 **금지**(기존 `CodeBlock`/`MarkdownContent`의 HAST 원칙 일관). `content` 마크다운은 기존 안전 렌더 재사용.
- **디자인시스템**: 기존 Tailwind 토큰(`bg-surface`·`border-border`·`text-fg`·`accent` 등)으로 앱 룩 일치.
- **재귀 깊이 가드**: `children` 재귀에 최대 깊이(예: 20) 상한 → 악성/순환 스펙 방어.

### 4.C 생명주기

- `store.uiSpec`을 **세션 전환/새 세션 시 `null`로 정리**(cross-session stale 목업 방지).
- design_ui 승인마다 fresh `uiSpec`이 덮어쓰고, 승인 카드는 `stage==='design_ui'`에서만 렌더되므로 그 외 stale 노출 없음 → 결정시점 클리어 불필요(YAGNI).

## 5. 데이터 흐름 (최종)

```
Designer design_ui ─▶ DesignUiOutput{components,uiSpec,content}
  ─▶ Manager applyApprovalGate(design_ui)
       [A] buildDemoSpec → payload.uiSpec 첨부 (+approval)
  ─▶ Orchestrator consumer/sessions.route (uiSpec relay)        ✅
  ─▶ renderer useSessionWs → store.setUiSpec                    ✅
  ─▶ ChatView 승인카드 stage===design_ui && uiSpec
       [B] <UiSpecPreview spec={uiSpec}/> → 인터프리터 styled 렌더
```

## 6. 테스트 전략

- **Manager(server, vitest)**: `buildDemoSpec` 순수 함수 — design_ui면 components/content 병합, 타 단계면 undefined, 비정형 결과면 undefined. `applyApprovalGate`가 design_ui 승인 publish에 `uiSpec` 포함·타 단계 미포함(기존 게이트 테스트 확장).
- **렌더러(app, browser test)**: 레지스트리 14종 각 렌더(예상 텍스트/role/testid), 미지원 name 폴백, `cssClasses` 적용, 입력 `disabled`, 재귀 children, 깊이 가드, form `fields` 입력 렌더, 빈 스펙 안내.
- **i18n**: 신규 문자열(예: `chat.demo_preview_title`, `chat.demo_preview_empty`) ko/en/ja 동기화(`scripts/check-i18n.js`).
- **회귀**: 기존 `UiSpecPreview` testid(`uispec-preview`·`uispec-components`) 유지.

## 7. 계약 드리프트 (인지·범위 밖)

`UISpec`/`ComponentSpec`이 5곳에 중복: `xzawedDesigner/src/types.ts`, `xzawedManager/.../tools/design-ui.ts`, `xzawedManager/.../types/streams.ts`, `xzawedOrchestrator/packages/shared/src/types/ui-spec.ts`, `xzawedPlanner/src/types.ts`. 이번 작업은 **렌더러는 orchestrator-shared 정의를 단일 소스로 소비**, Manager는 streams `UISpec` 형태로 demoSpec 구성하는 선에서만 정합. 전면 통합은 후속 과제(`/contract-drift-check`로 진단 후 별도 PR 권장).

## 8. 범위 밖 (YAGNI)

- Designer가 HTML/JSX를 emit하는 방식(샌드박스 iframe) — 채택 안 함.
- 인터랙티브 데모(실제 입력/제출) — 읽기 전용 유지.
- UISpec 5중복 전면 통합 — 후속.
- design_ui 외 단계의 목업 미리보기 — design_ui 한정.

## 9. 변경/신규 파일 요약

**변경**:
- `xzawedManager/packages/server/src/claude/runner.ts` — `applyApprovalGate` publish payload에 demoSpec 첨부 + `buildDemoSpec` 추가
- `xzawedOrchestrator/packages/app/src/renderer/src/components/chat/UiSpecPreview.tsx` — 인터프리터 진입으로 재작성
- `xzawedOrchestrator/packages/app/src/renderer/src/store/chat.store.ts`(or 세션 전환 지점) — 세션 전환 시 uiSpec 정리
- `locales/{ko,en,ja}/app.json` — 신규 문자열

**신규**:
- `xzawedOrchestrator/packages/app/src/renderer/src/components/chat/uispec/registry.tsx`
- `.../uispec/renderers.tsx`
- `.../uispec/props.ts`
- 대응 테스트 파일들
