-- 008_projects_org.sql: G11 Slice 2 — 프로젝트 org 소유권(모델 C·사용자당 단일 org).
-- 소유권 게이트를 org-우선(assertProjectInOrg)으로 승격. 모델 C(1:1 user↔org)라 동작 등가(회귀 0)나
-- 팀(B) 도착 시 org 멤버가 프로젝트를 공유할 토대. enforcement 강도 무변(여전히 소유 프로젝트만 접근).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES tenants(id);

-- 백필(멱등·org_id IS NULL 행만): 각 project를 소유 user의 org에 연결.
UPDATE projects p SET org_id = u.org_id
  FROM users u WHERE p.user_id = u.id AND p.org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id);
