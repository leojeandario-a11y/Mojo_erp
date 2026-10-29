-- 007 : moteur d'approbation configurable et notifications
CREATE TABLE approval_workflows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type  text NOT NULL,               -- purchase, expense, fund_withdrawal, leave, payroll, contract, budget ...
  entity_id     uuid REFERENCES entities(id),
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (request_type, entity_id)
);

CREATE TABLE approval_workflow_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  step_order   int NOT NULL CHECK (step_order > 0),
  label        text NOT NULL,
  approver_role_id uuid REFERENCES roles(id),
  approver_user_id uuid REFERENCES users(id),
  min_amount_usd numeric(18,2),             -- NULL = étape toujours requise ; sinon requise si montant >= seuil
  UNIQUE (workflow_id, step_order),
  CHECK (approver_role_id IS NOT NULL OR approver_user_id IS NOT NULL)
);

CREATE TABLE approval_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   uuid NOT NULL REFERENCES approval_workflows(id),
  request_type  text NOT NULL,
  ref_table     text NOT NULL,
  ref_id        uuid NOT NULL,
  requester_id  uuid NOT NULL REFERENCES users(id),
  title         text NOT NULL,
  amount        numeric(18,2),
  currency      char(3) REFERENCES currencies(code),
  amount_usd    numeric(18,2),
  current_step  int NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX idx_apr_status ON approval_requests(status, current_step);

CREATE TABLE approval_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step_order  int NOT NULL,
  actor_id    uuid NOT NULL REFERENCES users(id),
  decision    text NOT NULL CHECK (decision IN ('approved','rejected','returned')),
  comment     text,
  acted_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE emergency_fund_rates ADD FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id);
ALTER TABLE fund_withdrawals     ADD FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id);
ALTER TABLE leave_requests       ADD FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id);
ALTER TABLE payroll_runs         ADD FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id);
ALTER TABLE salary_adjustments   ADD FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id);
ALTER TABLE contracts            ADD FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id);

CREATE TABLE purchase_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  department_id uuid REFERENCES departments(id),
  project_id  uuid REFERENCES projects(id),
  supplier_id uuid REFERENCES suppliers(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  description text NOT NULL,
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','ordered','received')),
  approval_request_id uuid REFERENCES approval_requests(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Notifications
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN
              ('approval_needed','invoice_overdue','payment_expected','low_stock','contract_expiring',
               'budget_exceeded','project_late','hr_request','fund_withdrawal','monthly_report','system')),
  title       text NOT NULL,
  body        text,
  link        text,
  ref_table   text,
  ref_id      uuid,
  is_read     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE push_subscriptions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint  text NOT NULL UNIQUE,
  p256dh    text NOT NULL,
  auth      text NOT NULL
);

CALL attach_audit('approval_workflows','approvals');
CALL attach_audit('approval_workflow_steps','approvals');
CALL attach_audit('approval_requests','approvals');
CALL attach_audit('approval_actions','approvals');
