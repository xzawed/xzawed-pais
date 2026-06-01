CREATE TABLE IF NOT EXISTS domain_knowledge (
  id           BIGSERIAL PRIMARY KEY,
  project_id   TEXT NOT NULL,
  content      TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  category     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_knowledge_project
  ON domain_knowledge (project_id, created_at DESC);
