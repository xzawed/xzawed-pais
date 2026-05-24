-- xzawedOrchestrator/packages/server/src/db/migrations/006_projects_workspace.sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS workspace_type   TEXT NOT NULL DEFAULT 'none'
    CHECK (workspace_type IN ('none', 'local', 'github')),
  ADD COLUMN IF NOT EXISTS local_path       TEXT,
  ADD COLUMN IF NOT EXISTS repo_url         TEXT,
  ADD COLUMN IF NOT EXISTS branch           TEXT NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS workspace_path   TEXT,
  ADD COLUMN IF NOT EXISTS push_strategy    TEXT NOT NULL DEFAULT 'push'
    CHECK (push_strategy IN ('push', 'pr'));
