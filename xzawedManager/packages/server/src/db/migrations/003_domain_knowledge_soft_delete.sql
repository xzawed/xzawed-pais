-- 위키 항목 soft-delete: 누적 도메인 지식의 영구 손실 방지(삭제 가역화).
-- deleted_at IS NULL = 활성, IS NOT NULL = 삭제됨(복구 가능).
ALTER TABLE domain_knowledge ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 활성 항목 최근순 조회(recentByProject) 가속 — deleted_at IS NULL 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_domain_knowledge_active
  ON domain_knowledge (project_id, created_at DESC)
  WHERE deleted_at IS NULL;
