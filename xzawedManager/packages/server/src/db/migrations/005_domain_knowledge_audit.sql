-- 위키 항목(domain_knowledge)의 편집·삭제·복구 이력(audit)을 별도 테이블에 누적한다.
-- 누가(actor, 있으면)·언제(at)·무엇을(action)·변경 직전 상태(prev_content/prev_category)를 남겨
-- 누적 도메인 지식의 변경 추적·되돌림 근거를 제공한다. domain_knowledge 행은 건드리지 않는다.
CREATE TABLE IF NOT EXISTS domain_knowledge_audit (
  id            BIGSERIAL PRIMARY KEY,
  knowledge_id  BIGINT NOT NULL,
  project_id    TEXT NOT NULL,
  action        TEXT NOT NULL,            -- 'update' | 'delete' | 'restore'
  actor         TEXT,                     -- 변경 주체(Orchestrator가 전달한 user id 등). 없으면 NULL.
  prev_content  TEXT,                     -- 변경 직전 content (되돌림·비교용)
  prev_category TEXT,                     -- 변경 직전 category
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 항목별 이력 최신순 조회용 인덱스.
CREATE INDEX IF NOT EXISTS idx_dk_audit_project_knowledge
  ON domain_knowledge_audit (project_id, knowledge_id, at DESC);
