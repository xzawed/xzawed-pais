-- M9 — 의사결정 브리프 & 사인오프 영속(HUMAN_DECISION_PERSISTENCE.md §2-3).
-- 진실원천은 manager_events(decision.*/signoff.*). 아래 표는 사람 판단·행동의 빠른 조회 프로젝션.

-- decision_requests: 사람 판단이 필요한 항목의 가변 프로젝션(상태 전이 PENDING→RESOLVED|EXPIRED|SUPERSEDED).
CREATE TABLE IF NOT EXISTS decision_requests (
  request_id     TEXT        PRIMARY KEY,
  type           TEXT        NOT NULL,   -- defect_brief|conformance_review|gate_override|degraded_release|oracle_approval|golden_diff|safe_resume
  workflow_id    TEXT        NOT NULL,
  wp_id          TEXT        NULL,
  correlation_id TEXT        NOT NULL,
  context        JSONB       NOT NULL DEFAULT '{}'::jsonb, -- {location, expectedVsActual, impact[], evidenceRefs[], options[]}
  severity       TEXT        NOT NULL DEFAULT 'blocking',  -- blocking|advisory
  status         TEXT        NOT NULL DEFAULT 'PENDING',   -- PENDING|RESOLVED|EXPIRED|SUPERSEDED
  language       TEXT        NOT NULL DEFAULT 'ko',
  event_id       UUID        NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NULL,
  resolved_at    TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_decision_requests_workflow_status ON decision_requests (workflow_id, status);

-- human_decisions: 사람 행동의 불변 기록(append-only·부인방지 M9). 코드 규약 INSERT만(UPDATE/DELETE 없음).
CREATE TABLE IF NOT EXISTS human_decisions (
  decision_id    TEXT        PRIMARY KEY,
  request_id     TEXT        NOT NULL REFERENCES decision_requests(request_id),
  decided_by     TEXT        NOT NULL,
  authority      TEXT        NULL,
  choice         TEXT        NOT NULL,   -- fix_reverify|spec_fix|accept_known|reject|approve|resume
  justification  TEXT        NULL,
  routed_to      TEXT        NULL,       -- impl|task|plan|gate_override|oracle_refine|saga_rollback
  correlation_id TEXT        NOT NULL,
  causation_id   TEXT        NULL,       -- = request_id (§3 인과 체인 M7)
  event_id       UUID        NULL,
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_human_decisions_request ON human_decisions (request_id);

-- sign_offs: 위험 수용/강등 릴리스 등 특수 결정의 불변 기록(append-only·비부인 M9·N2). 코드 규약 INSERT만.
CREATE TABLE IF NOT EXISTS sign_offs (
  signoff_id      TEXT        PRIMARY KEY,
  decision_id     TEXT        NOT NULL REFERENCES human_decisions(decision_id),
  scope           TEXT        NOT NULL,
  risk            TEXT        NOT NULL DEFAULT 'HIGH',
  reason          TEXT        NULL,
  approver        TEXT        NOT NULL,
  authority_level TEXT        NULL,
  tech_debt_ref   TEXT        NULL,
  event_id        UUID        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_sign_offs_decision ON sign_offs (decision_id);
