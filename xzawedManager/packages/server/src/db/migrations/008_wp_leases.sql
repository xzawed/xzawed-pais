-- wp_leases: WP 가시성 타임아웃 lease (가변 프로젝션, 1행/WP). PK (workflow_id, wp_id)가
-- 동시/재진입 디스패치 중복 차단 게이트(§8 #2, ON CONFLICT DO NOTHING). P1d-5.
CREATE TABLE IF NOT EXISTS wp_leases (
  workflow_id TEXT        NOT NULL,
  wp_id       TEXT        NOT NULL,
  attempt     INT         NOT NULL DEFAULT 0,    -- 디스패치 시도(0=최초). reclaim 시 ++
  owner       TEXT        NULL,                  -- 임대 소유자(워커/에이전트 id). 미배선이라 nullable seam
  status      TEXT        NOT NULL DEFAULT 'active',  -- active | released | escalated (TEXT, 전방호환)
  expires_at  BIGINT      NOT NULL,              -- 가시성 만료(epoch ms) = dispatch occurredAt + visibilityMs
  step_n      INT         NOT NULL DEFAULT 0,    -- 디스패치 시점 topo 인덱스(표시·reclaim 자기완결)
  event_id    UUID        NULL,                  -- 유발 wp.dispatched (provenance, FK 없음 — task_graphs 선례)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workflow_id, wp_id)
);
-- 만료 sweep 조회용(status='active' AND expires_at < now).
CREATE INDEX IF NOT EXISTS idx_wp_leases_sweep ON wp_leases (status, expires_at);
