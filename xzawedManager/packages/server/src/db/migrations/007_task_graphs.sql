-- task_graphs: 워크플로당 현재(병합된) WP DAG 프로젝션 (가변 — 재분해 시 UPDATE).
-- 진실원천은 manager_events(decomposition.emitted)·wp_state_log(전이). 이 표는 빠른 조회용 프로젝션.
CREATE TABLE IF NOT EXISTS task_graphs (
  workflow_id  TEXT        PRIMARY KEY,
  graph_dag    JSONB       NOT NULL,            -- { workPackages: WorkPackage[] } — 노드 소스만 저장
  event_id     UUID        NULL,                -- 출처 decomposition.emitted (provenance, P1d-2가 채움)
  version      INT         NOT NULL DEFAULT 1,  -- 재분해 병합 시 ++
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- wp_state_log: WP 상태 전이 append-only 로그 (감사·국소화 토대). 코드 규약으로 INSERT만(UPDATE/DELETE 없음).
CREATE TABLE IF NOT EXISTS wp_state_log (
  seq          BIGSERIAL   PRIMARY KEY,
  workflow_id  TEXT        NOT NULL,
  wp_id        TEXT        NOT NULL,
  from_state   TEXT        NULL,                -- 최초 전이는 NULL
  to_state     TEXT        NOT NULL,            -- WP 상태머신(WORKFLOW §B); 미배선이라 CHECK 없이 TEXT(전방호환)
  event_id     UUID        NULL,                -- 유발 event (causation, P1d-4+가 채움)
  reason       TEXT        NULL,                -- 귀속/사유(P4 fault-localization 토대)
  occurred_at  BIGINT      NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_state_log_wp ON wp_state_log (workflow_id, wp_id, seq);
