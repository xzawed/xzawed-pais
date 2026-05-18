-- Per-project GitHub token encrypted storage
CREATE TABLE project_github_tokens (
  project_id   UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  token_cipher BYTEA NOT NULL,
  token_iv     BYTEA NOT NULL,
  token_tag    BYTEA NOT NULL,
  scopes       TEXT[],
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at   TIMESTAMPTZ
);
