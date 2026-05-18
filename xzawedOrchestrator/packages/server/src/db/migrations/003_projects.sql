CREATE TABLE projects (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  slug          TEXT        NOT NULL,
  description   TEXT,
  github_owner  TEXT,
  github_repo   TEXT,
  github_branch TEXT        NOT NULL DEFAULT 'main',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, slug)
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
