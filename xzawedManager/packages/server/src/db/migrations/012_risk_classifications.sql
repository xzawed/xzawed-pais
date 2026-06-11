-- P2r-2 — Wiki Agent 리스크 분류 영속(WIKI_AGENT_RISK_CLASSIFICATION.md §3-4).
-- 진실원천은 manager_events(risk.approved). 이 표는 라우팅 확정용 빠른 조회 프로젝션(가변 — 재채점 시 version++).
-- 한 워크플로당 한 분류. 승인된(status=approved) 분류만 라우팅을 확정한다(N6).
CREATE TABLE IF NOT EXISTS risk_classifications (
  workflow_id  TEXT        PRIMARY KEY,
  project_id   TEXT        NOT NULL,
  version      INT         NOT NULL DEFAULT 1,
  status       TEXT        NOT NULL DEFAULT 'pending',   -- pending|approved|superseded
  risk         TEXT        NOT NULL,                     -- LOW|MEDIUM|HIGH (artifact에서 denormalized)
  artifact     JSONB       NOT NULL DEFAULT '{}'::jsonb, -- RiskClassification 아티팩트(@xzawed/agent-streams 스키마)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at  TIMESTAMPTZ NULL,
  approved_by  TEXT        NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_classifications_status ON risk_classifications (workflow_id, status);
