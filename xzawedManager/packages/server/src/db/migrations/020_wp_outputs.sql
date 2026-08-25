-- 020_wp_outputs.sql
-- S6.3 / 결함 F7: WP 가 **실제로 낸 산출물**의 투영.
--
-- `buildWorkerInput` 이 모든 WP 에 `artifacts: []` 를 하드코딩했다. 그래서 security_audit WP 는
-- 감사할 파일을 한 건도 받지 못했고 static 은 **구조적으로 항상 `requested: 0`** 이었다
-- (`xzawedSecurity/src/security.ts` 의 `requested: payload.artifacts.length`).
-- S5.2a 는 그 사실 위에서 "deps 가 돌았으면 증거로 인정"하는 판정을 세워야 했다.
--
-- **`graph_dag.workPackages[].outputs` 를 채우지 않는 이유.** 그 필드는 분해가 *예측한* I/O 고,
-- 여기 담는 것은 실행이 *실제로 낸* 것이다. 둘을 한 자리에 쓰면 `wp.status` 가 영원히 `DRAFTED`
-- 인 채 실제 상태는 `wp_state_log` 에만 있는 것과 같은 혼동이 생긴다(S6.2 가 그 대가를 치렀다).
-- 런타임 사실은 append/upsert 투영에 두고 그래프는 계획 그대로 남긴다.
--
-- 재실행 안전: 전부 IF NOT EXISTS(비멱등 DDL 정적 가드 대상).
CREATE TABLE IF NOT EXISTS wp_outputs (
  id           BIGSERIAL   PRIMARY KEY,
  workflow_id  TEXT        NOT NULL,
  wp_id        TEXT        NOT NULL,
  -- 에이전트 결과의 artifacts(문자열 경로 배열). 최신 성공 실행이 진실이라 upsert 로 덮는다.
  artifacts    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  tenant_id    TEXT        NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wp_outputs_wp
  ON wp_outputs (workflow_id, wp_id);
