-- S6.1 WP 상태 계약 단일화.
--
-- 이전에는 정본이 셋으로 갈려 교집합이 0이었다: 소문자(shared 스키마) · 대문자(wp_state_log) ·
-- 테스트만 쓰던 READY. 정본을 대문자 6종으로 고정한다
-- (근거: 2026-06-08-p1d4-dispatch-design.md 의 "[PO 결정] DRAFTED → DISPATCHED · WORKFLOW §B 정본 명칭").
--
-- 두 가지를 한다.
--   1) task_graphs.graph_dag 안 WorkPackage.status 를 소문자 → 대문자로 이전.
--      getGraph 가 workPackagesSchema.parse() 로 **strict** 파싱하므로, 남겨 두면 레거시 행 하나가
--      디스패치 경로 전체를 ZodError 로 죽인다.
--   2) wp_state_log 의 from_state/to_state 에 CHECK 제약.
--      ADD CONSTRAINT 는 Postgres 에 IF NOT EXISTS 문법이 없어 카탈로그 가드로 감싼다(S3.4 가드가 강제).

-- 1) graph_dag JSONB 안 status 이전. workPackages 배열을 원소별로 재작성한다.
--    이미 대문자인 행은 매핑에서 그대로 통과하므로 재실행이 안전하다(멱등).
UPDATE task_graphs
SET graph_dag = jsonb_set(
      graph_dag,
      '{workPackages}',
      (
        SELECT COALESCE(jsonb_agg(
                 CASE
                   WHEN wp->>'status' = 'draft'       THEN jsonb_set(wp, '{status}', '"DRAFTED"')
                   WHEN wp->>'status' = 'ready'       THEN jsonb_set(wp, '{status}', '"READY"')
                   WHEN wp->>'status' = 'in_progress' THEN jsonb_set(wp, '{status}', '"DISPATCHED"')
                   WHEN wp->>'status' = 'blocked'     THEN jsonb_set(wp, '{status}', '"BLOCKED"')
                   WHEN wp->>'status' = 'done'        THEN jsonb_set(wp, '{status}', '"DONE"')
                   ELSE wp
                 END
                 ORDER BY ord
               ), '[]'::jsonb)
        FROM jsonb_array_elements(graph_dag->'workPackages') WITH ORDINALITY AS t(wp, ord)
      )
    ),
    updated_at = NOW()
WHERE jsonb_typeof(graph_dag->'workPackages') = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(graph_dag->'workPackages') AS e(wp)
    WHERE wp->>'status' IN ('draft', 'ready', 'in_progress', 'blocked', 'done')
  );

-- 2) wp_state_log 값 집합 제약. from_state 는 nullable(최초 전이) — NULL 은 CHECK 를 통과한다.
--    레거시 행에 enum 밖 값이 남아 있으면 ADD CONSTRAINT 가 실패하므로 먼저 정규화한다.
UPDATE wp_state_log SET to_state = 'DISPATCHED' WHERE to_state = 'IN_PROGRESS';
UPDATE wp_state_log SET from_state = 'DISPATCHED' WHERE from_state = 'IN_PROGRESS';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_state_log_to_state_chk') THEN
    ALTER TABLE wp_state_log ADD CONSTRAINT wp_state_log_to_state_chk
      CHECK (to_state IN ('DRAFTED', 'READY', 'DISPATCHED', 'BLOCKED', 'DONE', 'ESCALATED'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_state_log_from_state_chk') THEN
    ALTER TABLE wp_state_log ADD CONSTRAINT wp_state_log_from_state_chk
      CHECK (from_state IS NULL OR from_state IN ('DRAFTED', 'READY', 'DISPATCHED', 'BLOCKED', 'DONE', 'ESCALATED'));
  END IF;
END $$;
