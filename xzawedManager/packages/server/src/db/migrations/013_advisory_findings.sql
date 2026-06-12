-- P4 advisory 채널(N3) — optimization 렌즈 비차단 발견. 진실원천은 manager_events(wp.advisory.found).
-- 이 표는 조회용 투영(append). 게이트(verifyWp)와 무관 — advisory는 절대 차단하지 않는다(N3).
-- runMigrations가 전 .sql을 매번 재실행하므로 IF NOT EXISTS로 idempotent.
CREATE TABLE IF NOT EXISTS advisory_findings (
  id           BIGSERIAL   PRIMARY KEY,
  workflow_id  TEXT        NOT NULL,
  wp_id        TEXT        NOT NULL,
  attempt      INT         NOT NULL,
  rank         INT         NOT NULL,
  title        TEXT        NOT NULL,
  rationale    TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'advisory',
  source_lens  TEXT        NOT NULL DEFAULT 'optimization',
  event_id     UUID        NULL, -- manager_events FK 없음(전방호환·다른 프로젝션과 동일)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_advisory_findings_workflow ON advisory_findings (workflow_id);
-- 재실행(같은 attempt) 멱등 — (wf,wpId,attempt,rank) 중복 INSERT는 ON CONFLICT DO NOTHING으로 skip(M6).
CREATE UNIQUE INDEX IF NOT EXISTS uq_advisory_findings_dedup
  ON advisory_findings (workflow_id, wp_id, attempt, rank);
