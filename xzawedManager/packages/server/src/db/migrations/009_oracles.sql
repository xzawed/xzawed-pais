-- oracles: Story에 바인딩된 사람 승인 Oracle 프로젝션(가변 — 재승인 시 version++). ORACLE_SCHEMA.md v3.
-- 진실원천은 manager_events(oracle.approved). 이 표는 DoR satisfied-set 산출용 빠른 조회 프로젝션.
CREATE TABLE IF NOT EXISTS oracles (
  oracle_id    TEXT        PRIMARY KEY,
  workflow_id  TEXT        NOT NULL,
  story_id     TEXT        NOT NULL,
  version      INT         NOT NULL DEFAULT 1,
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending|approved|superseded
  scenarios    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  coverage     JSONB       NOT NULL DEFAULT '{}'::jsonb, -- {acceptance_criterion: [scenario_id]}
  provenance   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at  TIMESTAMPTZ NULL,
  approved_by  TEXT        NULL
);
CREATE INDEX IF NOT EXISTS idx_oracles_workflow_status ON oracles (workflow_id, status);
