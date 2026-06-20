-- C0/C1 결정 UI: 결정 요청에 프로젝트 스코프 부여(additive). legacy 행은 NULL.
-- 진실원천은 manager_events(decision.requested); 이 컬럼은 pendingByProject 조회용 프로젝션 필드.
ALTER TABLE decision_requests ADD COLUMN IF NOT EXISTS project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_decision_requests_project_status
  ON decision_requests (project_id, status);
