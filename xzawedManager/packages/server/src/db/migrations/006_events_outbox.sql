-- append-only 이벤트 로그 = 진실원천 (M4). 코드 규약으로 INSERT만(UPDATE/DELETE 없음)
CREATE TABLE IF NOT EXISTS manager_events (
  seq             BIGSERIAL   PRIMARY KEY,
  event_id        UUID        NOT NULL UNIQUE,
  session_id      TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  correlation_id  TEXT        NOT NULL,
  causation_id    TEXT        NULL,
  idempotency_key TEXT        NOT NULL,
  actor           TEXT        NULL,
  occurred_at     BIGINT      NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_events_session ON manager_events (session_id, seq);

-- 트랜잭셔널 아웃박스 (M5) — 이벤트와 같은 tx로 적재, 릴레이가 발행
CREATE TABLE IF NOT EXISTS manager_outbox (
  id           BIGSERIAL   PRIMARY KEY,
  event_id     UUID        NOT NULL REFERENCES manager_events(event_id),
  stream       TEXT        NOT NULL,
  message      JSONB       NOT NULL,
  published_at TIMESTAMPTZ NULL,
  attempts     INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_outbox_pending ON manager_outbox (id) WHERE published_at IS NULL;
