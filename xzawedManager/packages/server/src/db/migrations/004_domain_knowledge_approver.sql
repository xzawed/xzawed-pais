-- 승인 게이트 저장 항목의 승인자(userId) 기록: 결정 출처(provenance)·audit 추적용.
-- approval-gate가 위키에 저장한 결정에 대해 누가 승인했는지 남긴다(NULL 허용 — 비승인 출처·기존 행 호환).
ALTER TABLE domain_knowledge ADD COLUMN IF NOT EXISTS approver TEXT;
