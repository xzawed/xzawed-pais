CREATE TABLE IF NOT EXISTS manager_sessions (
  session_id  TEXT        PRIMARY KEY,
  state       TEXT        NOT NULL DEFAULT 'idle',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
