# 게이트 승인 → "위키에 저장" — 설계

- 작성일: 2026-06-02
- 상태: 승인됨
- 브랜치: `feat/gate-wiki-save`
- 범위: 승인 게이트에서 PO가 승인한 결정을 도메인 위키에 1-체크로 저장. 승인게이트(P3)와 위키(P1b)를 연결.

## 1. 목표

PO가 승인 게이트에서 결정(계획·디자인·코드·보안 산출물)을 검토할 때, 그 승인된 결정을 도메인 위키에 누적할 수 있게 한다. 비전의 "사용자는 PO로서 핵심 분기를 승인" + "위키 = 도메인 지식 누적"을 연결하는 항목.

확정 결정:
- **트리거**: 승인 카드의 명시적 체크박스(`위키에 저장`). 자동 저장 아님(저가치·중복으로 위키가 비대해지는 것 방지, "PO가 큐레이션" 비전 준수).
- **저장 내용**: 게이트 `summary`(`summarizeOutput`, ≤2000자)를 그대로 지식 항목으로 저장. 편집·주석은 후속.
- **태그**: `sourceAgent='approval-gate'`, `category='decision'`(기존 enum decision/constraint/rule/tech 재사용 → 위키 출처필터·분류필터·배지에 자동 노출).
- **노출 단계**: 지식성 4단계만(plan_task·design_ui·develop_code·security_audit). run_tests·build_project·watch_changes·deploy_project는 일시 산출물이라 제외.

## 2. 현재 상태와 통합 지점 (코드 근거)

- **게이트 승인 시점에 필요한 데이터가 모두 존재** — `runner.ts` `applyApprovalGate`(204-245): `block.name`(stage), `result`(전체 산출물), `summary`(`summarizeOutput`), `userContext.projectId`, `decision`(parseDecision 결과).
- **위키 쓰기 경로 기존재** — `storeDomainKnowledge`(172-187) → `knowledgeRepo.insertMany(projectId, entries)`. `KnowledgeEntry = {content, sourceAgent, category?}`. domain_knowledge 테이블(project_id, content, source_agent, category, created_at).
- **결정 와이어는 불투명 JSON 문자열** — UI `sendUiAction(JSON.stringify({decision, rememberAuto}))` → `postUiAction` → `POST /sessions/:id/ui-actions {action}` → `info_response.answer`(string) → Manager `parseDecision(answer)`. **`answer`에 `saveToWiki` 필드를 얹어도 Redis 스트림 Zod 스키마 변경 불필요.**
- **승인 카드 UI** — `ChatView.tsx`가 `pendingInfoRequest.approval{stage,summary,mode}`를 [승인][수정요청][중단] + `rememberAuto` 체크박스로 렌더. 새 체크박스는 동일 패턴.
- **지식성 단계 집합은 UI에 이미 암묵 존재** — 위키 출처필터 드롭다운이 plan_task·design_ui·develop_code·security_audit를 나열(WikiPanel.tsx). 동일 집합 사용.

## 3. 데이터 경로

```
ChatView 승인카드 [✓ 위키에 저장]   (지식성 stage일 때만 렌더)
  → sendUiAction(JSON.stringify({decision:'approve', rememberAuto, saveToWiki}))
  → POST /sessions/:id/ui-actions          (변경 없음 — action은 불투명 문자열)
  → info_response.answer                    (스트림 스키마 변경 없음)
  → Manager parseDecision(answer) → {kind:'approve', rememberAuto, saveToWiki}
  → applyApprovalGate approve 분기:
       saveToWiki && KNOWLEDGE_BEARING_STAGES.has(stage) && projectId 이면
       knowledgeRepo.insertMany(projectId, [{content:summary, sourceAgent:'approval-gate', category:'decision'}])
  → domain_knowledge 행 1개 → 위키 뷰어에 즉시 노출
```

## 4. 컴포넌트

### 4.1 Manager `gates/approval-gate.ts`
- `GateDecision`의 approve 변종에 `saveToWiki: boolean` 추가.
- `parseDecision(answer)`가 `saveToWiki`를 읽어 approve 결정에 포함. 누락/비boolean이면 **fail-open `false`**(하위호환: 레거시 `{decision, rememberAuto}`는 저장 안 함).
- `KNOWLEDGE_BEARING_STAGES = new Set(['plan_task','design_ui','develop_code','security_audit'])` + `isKnowledgeBearingStage(stage)` predicate export(서버가 진실 원천).

### 4.2 Manager `claude/runner.ts`
- `applyApprovalGate` approve 분기에서 결정 적용 후:
  ```
  if (decision.saveToWiki && isKnowledgeBearingStage(block.name) && this.knowledgeRepo && userContext?.projectId) {
    try {
      await this.knowledgeRepo.insertMany(userContext.projectId, [
        { content: summary, sourceAgent: 'approval-gate', category: 'decision' },
      ])
    } catch (err) { /* log, 비차단 */ }
  }
  ```
- `summary`는 이미 게이트 루프에서 계산된 값 재사용. 승인 흐름을 절대 차단하지 않음(기존 `storeDomainKnowledge` 비차단 패턴).

### 4.3 Orchestrator 앱 `ChatView.tsx`
- `rememberAuto` 체크박스 옆에 `위키에 저장` 체크박스(`saveToWiki` 로컬 state), **`approval.stage`가 지식성 4단계일 때만** 렌더.
- approve 액션 payload에 `saveToWiki` 포함: `sendUiAction(JSON.stringify({decision:'approve', rememberAuto, saveToWiki}))`.
- 지식성 단계 판별: 컴포넌트 상수 `KNOWLEDGE_BEARING_STAGES`(WikiPanel 출처필터와 동일 집합) — `data-testid="approval-save-wiki"`.

### 4.4 i18n
- `approval.save_to_wiki` ko/en/ja.

### 4.5 와이어
- **변경 없음.** `info_response.answer`의 JSON은 불투명. Orchestrator `ui-actions` 라우트·consumer Zod 스키마·streams 타입 무변경.

## 5. 범위 경계 (YAGNI)

| 포함 | 제외 (후속) |
|---|---|
| 승인 카드 체크박스(지식성 단계) | 저장 전 텍스트 편집/주석 |
| summary 자동 저장(approve 1회) | revise 반복마다 저장 |
| category='decision' 고정 태그 | 단계별 category 추론·커스텀 |
| sourceAgent='approval-gate' | 승인자 ID·타임스탬프 외 감사 메타(컬럼 추가) |
| 비차단 저장(실패 무시) | 별도 승인 이력 audit 테이블/조회 API |

## 6. 에러 처리

- `projectId` 없음 / `knowledgeRepo` 없음 → 조용히 skip, 승인은 정상 진행.
- `insertMany` 실패 → catch + log, 승인 흐름 비차단.
- `parseDecision` 레거시 answer(saveToWiki 없음) → `saveToWiki:false`.
- 비지식성 stage에서 saveToWiki=true가 들어와도(이론상) Manager가 `isKnowledgeBearingStage` 가드로 저장 안 함.

## 7. 성공 기준

1. 지식성 단계 게이트 승인 카드에 `위키에 저장` 체크박스가 보이고, 체크 후 승인하면 그 결정이 위키에 `category='decision'`·`sourceAgent='approval-gate'`로 저장된다.
2. 체크 안 함 / 비지식성 단계 / projectId 없음 → 저장되지 않고 승인은 정상 동작.
3. 저장 실패가 승인 흐름을 차단하지 않는다.
4. Redis 스트림 스키마·`ui-actions` 라우트 무변경(불투명 JSON 경유).
5. 게이트 로직·runner 저장 분기·UI 체크박스가 각각 단위/브라우저 테스트로 검증된다.

## 8. 테스트

- `approval-gate.test`: `parseDecision`이 `saveToWiki` 파싱; 누락 시 `false`; 비boolean fail-open; `isKnowledgeBearingStage` 멤버십(4단계 true, deploy/test/build false).
- `runner.test`: approve+saveToWiki+지식성 stage+projectId → `insertMany([{content:summary, sourceAgent:'approval-gate', category:'decision'}])`; saveToWiki=false → 미호출; 비지식성 stage → 미호출; projectId 없음 → 미호출; `insertMany` reject → 승인 결과 정상 반환.
- `ChatView.browser.test`: 지식성 stage → 체크박스 렌더, 체크 후 승인 시 payload `saveToWiki:true`; 비지식성 stage → 체크박스 미렌더.
- i18n 동기화(`node scripts/check-i18n.js`).

## 9. 후속 (별도 사이클)

- 저장 전 summary 편집/주석.
- revise 이력·승인자 ID·타임스탬프 audit 추적.
- 위키 항목 편집/삭제(별도 설계 — 쓰기 경로 인증 필요).
