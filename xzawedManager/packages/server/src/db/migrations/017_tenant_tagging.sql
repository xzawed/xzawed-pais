-- G11 Slice 4: Manager 쓰기 태깅(tenant_id). 태그 소스는 userContext.tenantId(Slice 3 캐리어) 단일.
-- enforcement 0 — 읽기 술어·인덱스·백필 없음. legacy 행은 영구 NULL(Slice 4b가 술어를 얹을 때 처리).
-- 러너가 매 기동 전량 재실행하므로(db/pool.ts) 전 DDL은 IF NOT EXISTS 필수.
ALTER TABLE task_graphs             ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE wp_state_log            ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE wp_leases               ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE oracles                 ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE decision_requests       ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE risk_classifications    ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE advisory_findings       ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE wp_verification_results ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE release_gates           ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE domain_knowledge        ADD COLUMN IF NOT EXISTS tenant_id TEXT;
