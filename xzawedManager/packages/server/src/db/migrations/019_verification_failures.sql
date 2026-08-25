-- 019_verification_failures.sql
-- S7.1 / 결함 F5: 검증 실패 **사유**의 영속 투영.
--
-- 이전에는 `publishVerificationFailed` 가 사유를 `manager:events:{workflowId}` 로만 발행했다.
-- 그 스트림은 **소비자가 0** 이고 per-workflow 라 고정 이름 소비자가 붙을 수도 없어, 사유가
-- 사실상 소멸했다. 사람이 실제로 읽는 `defect_brief` 는 lease 상한 초과 시에야 만들어지고
-- "N회 재시도 모두 검증 실패"라는 일반 문구만 담았다 — 무엇이 왜 실패했는지가 없었다.
--
-- 이 표는 그 사유를 attempt 단위로 남겨 에스컬레이션 브리프가 읽어 간다.
-- `manager_` 접두사가 없는 것은 의도다 — 접두사 계약은 Orchestrator 와 런타임 DB 를 공유하는
-- **인프라 표**(manager_events·manager_outbox·manager_schema_migrations)에 적용되고,
-- 도메인 표는 `wp_*`/`task_graphs` 관례를 따른다(Orchestrator 에 `wp_*` 표가 없다).
--
-- runMigrations 가 재실행돼도 안전하도록 전부 IF NOT EXISTS(비멱등 DDL 정적 가드 대상).
CREATE TABLE IF NOT EXISTS wp_verification_failures (
  id           BIGSERIAL   PRIMARY KEY,
  workflow_id  TEXT        NOT NULL,
  wp_id        TEXT        NOT NULL,
  attempt      INT         NOT NULL,
  reason       TEXT        NOT NULL,
  tenant_id    TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_verification_failures_wp
  ON wp_verification_failures (workflow_id, wp_id);

-- 같은 attempt 재검증(reclaim 후 좀비 응답 등)은 한 행으로 접는다 — ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wp_verification_failures_dedup
  ON wp_verification_failures (workflow_id, wp_id, attempt);
