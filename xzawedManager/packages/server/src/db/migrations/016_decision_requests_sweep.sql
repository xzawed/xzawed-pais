-- B1: 결정 만료 sweep 인덱스. expiredPendingRequests의 (status, expires_at) 술어 커버(PENDING 누적 시 seq scan 방지).
-- decision_requests.expires_at은 TIMESTAMPTZ(011) — sweep은 to_timestamp(now_ms/1000.0)으로 비교. additive·rerun-safe.
CREATE INDEX IF NOT EXISTS idx_decision_requests_sweep ON decision_requests (status, expires_at);
