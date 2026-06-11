-- P4b-3: Oracle 아티팩트 종류 확장 — invariants(속성 기반 §4)·golden_refs(승인 기준 출력 §5).
-- ORACLE_SCHEMA.md §2/§4/§5. additive(default []·현재 검증 미소비) — impact 채널(후속)이
-- golden_refs를 differential 베이스라인으로, mutation/property 채널이 invariants를 소비할 선결 스키마.
-- runMigrations가 전 .sql을 매번 재실행하므로 ADD COLUMN IF NOT EXISTS로 idempotent(009 재실행 안전).
ALTER TABLE oracles ADD COLUMN IF NOT EXISTS invariants  JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE oracles ADD COLUMN IF NOT EXISTS golden_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
