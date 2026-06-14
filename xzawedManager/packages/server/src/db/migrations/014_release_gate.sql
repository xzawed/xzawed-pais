-- 014_release_gate.sql
-- P5-1 릴리스 게이트(M1). 진실원천은 manager_events(wp.verified / gate.passed / gate.blocked).
-- 두 표 모두 조회용 투영. runMigrations가 전 .sql을 매번 재실행하므로 IF NOT EXISTS로 idempotent.

-- WP별 검증 증거(채널 outcome). develop_code/run_tests/build_project가 DONE 시 영속.
CREATE TABLE IF NOT EXISTS wp_verification_results (
  id           BIGSERIAL   PRIMARY KEY,
  workflow_id  TEXT        NOT NULL,
  wp_id        TEXT        NOT NULL,
  attempt      INT         NOT NULL,
  channel      TEXT        NOT NULL,
  outcome      TEXT        NOT NULL,
  event_id     UUID        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wp_verification_results_workflow ON wp_verification_results (workflow_id);
-- 재실행(같은 attempt·channel) 멱등 — ON CONFLICT DO NOTHING(M6).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wp_verification_results_dedup
  ON wp_verification_results (workflow_id, wp_id, attempt, channel);

-- 워크플로별 릴리스 게이트 결과(가변 프로젝션·게이트 버전당 1행).
CREATE TABLE IF NOT EXISTS release_gates (
  id               BIGSERIAL   PRIMARY KEY,
  workflow_id      TEXT        NOT NULL,
  gate_version     TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  per_wp           JSONB       NOT NULL DEFAULT '[]',
  blocking_reasons JSONB       NOT NULL DEFAULT '[]',
  event_id         UUID        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_release_gates_workflow ON release_gates (workflow_id);
-- 동일 done-set 재평가 멱등 — ON CONFLICT DO NOTHING으로 이중 emit 차단.
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_gates_version
  ON release_gates (workflow_id, gate_version);
