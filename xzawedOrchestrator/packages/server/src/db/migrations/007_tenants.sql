-- 007_tenants.sql: G11 Slice 1 — 멀티테넌트 신원 토대(모델 C·사용자당 단일 org).
-- enforcement 0: org_id가 JWT claim으로 흐르지만 아직 어떤 쿼리도 필터하지 않는다(회귀 0).

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 사용자당 정확히 1 org(모델 C). 팀 초대·RBAC(org_members)는 후속(B 승격 시 org_id=primary org).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);

-- 백필(멱등·org_id IS NULL 행만): 기존 user에게 개인 org 자동 생성·연결.
-- 재실행 시 이미 백필된 user는 org_id IS NOT NULL이라 건너뛴다(마이그레이션 멱등 불변식).
DO $$
DECLARE u RECORD; new_org UUID;
BEGIN
  FOR u IN SELECT id, email FROM users WHERE org_id IS NULL LOOP
    INSERT INTO tenants (name) VALUES (u.email || ' workspace') RETURNING id INTO new_org;
    UPDATE users SET org_id = new_org WHERE id = u.id;
  END LOOP;
END $$;
