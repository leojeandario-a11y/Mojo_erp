BEGIN;

ALTER TABLE emergency_fund_rates
  ADD COLUMN approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE emergency_fund_rates
  DROP CONSTRAINT emergency_fund_rates_fund_id_effective_from_key;
CREATE UNIQUE INDEX emergency_fund_rates_active_date_unique
  ON emergency_fund_rates(fund_id, effective_from)
  WHERE approval_status IN ('pending', 'approved');

ALTER TABLE fund_contributions
  ADD COLUMN outgoing_transaction_id uuid REFERENCES transactions(id),
  ADD COLUMN reason text,
  ADD COLUMN reversal_transaction_id uuid REFERENCES transactions(id),
  ADD COLUMN reversal_incoming_transaction_id uuid REFERENCES transactions(id);

ALTER TABLE fund_withdrawals
  ADD COLUMN requested_amount numeric(18,2),
  ADD COLUMN requested_currency char(3) REFERENCES currencies(code),
  ADD COLUMN requested_date date,
  ADD COLUMN reversal_transaction_id uuid REFERENCES transactions(id);

ALTER TABLE fund_withdrawals DROP CONSTRAINT fund_withdrawals_status_check;
ALTER TABLE fund_withdrawals ADD CONSTRAINT fund_withdrawals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'disbursed', 'cancelled', 'reversed'));

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    'approval_needed', 'invoice_overdue', 'payment_expected', 'low_stock', 'contract_expiring',
    'budget_exceeded', 'project_late', 'hr_request', 'fund_withdrawal', 'monthly_report',
    'fund_target_reached', 'system'
  ));

UPDATE fund_withdrawals
SET requested_amount = amount,
    requested_currency = currency,
    requested_date = requested_at::date
WHERE requested_amount IS NULL OR requested_currency IS NULL OR requested_date IS NULL;

ALTER TABLE fund_withdrawals
  ALTER COLUMN requested_amount SET NOT NULL,
  ALTER COLUMN requested_currency SET NOT NULL,
  ALTER COLUMN requested_date SET NOT NULL;

CREATE UNIQUE INDEX fund_withdrawals_approval_request_unique
  ON fund_withdrawals(approval_request_id)
  WHERE approval_request_id IS NOT NULL;
CREATE INDEX emergency_fund_rates_approved_effective
  ON emergency_fund_rates(fund_id, effective_from DESC)
  WHERE approval_status = 'approved';
CREATE INDEX fund_contributions_date ON fund_contributions(fund_id, contribution_date DESC);
CREATE UNIQUE INDEX fund_contributions_reversal_unique
  ON fund_contributions(reversal_transaction_id)
  WHERE reversal_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX fund_withdrawals_reversal_unique
  ON fund_withdrawals(reversal_transaction_id)
  WHERE reversal_transaction_id IS NOT NULL;
CREATE INDEX fund_withdrawals_requested_date ON fund_withdrawals(fund_id, requested_at DESC);
CREATE INDEX documents_fund_withdrawal_owner
  ON documents(owner_id, created_at)
  WHERE owner_table = 'fund_withdrawals';

CREATE POLICY doc_fund_withdrawal_read ON documents FOR SELECT USING (
  confidentiality = 'finance'
  AND owner_table = 'fund_withdrawals'
  AND EXISTS (
    SELECT 1
    FROM fund_withdrawals withdrawal
    JOIN emergency_funds fund ON fund.id = withdrawal.fund_id
    WHERE withdrawal.id = documents.owner_id
      AND (
        app_has_entity_permission('finance.fund.read', fund.entity_id)
        OR app_has_entity_permission('finance.fund.approve_withdrawal', fund.entity_id)
        OR (
          withdrawal.requested_by = app_user_id()
          AND app_has_entity_permission('finance.fund.request_withdrawal', fund.entity_id)
        )
      )
  )
);

CREATE OR REPLACE VIEW v_fund_balance AS
SELECT fund.id AS fund_id, fund.target_amount, fund.currency,
  COALESCE((
    SELECT SUM(contribution.amount)
    FROM fund_contributions contribution
    WHERE contribution.fund_id = fund.id
      AND contribution.reversal_transaction_id IS NULL
  ), 0)
  - COALESCE((
    SELECT SUM(withdrawal.amount)
    FROM fund_withdrawals withdrawal
    WHERE withdrawal.fund_id = fund.id AND withdrawal.status = 'disbursed'
  ), 0) AS balance
FROM emergency_funds fund;

INSERT INTO approval_workflows(request_type, name, is_active)
SELECT 'fund_rate', 'Modification du pourcentage du fonds', true
WHERE NOT EXISTS (
  SELECT 1 FROM approval_workflows WHERE request_type = 'fund_rate' AND entity_id IS NULL AND is_active
);

INSERT INTO approval_workflow_steps(workflow_id, step_order, label, approver_role_id)
SELECT workflow.id, 1, 'Direction Générale', role.id
FROM approval_workflows workflow
JOIN roles role ON role.code = 'dg'
WHERE workflow.request_type = 'fund_rate' AND workflow.entity_id IS NULL AND workflow.is_active
  AND NOT EXISTS (
    SELECT 1 FROM approval_workflow_steps step
    WHERE step.workflow_id = workflow.id AND step.step_order = 1
  );

INSERT INTO approval_workflows(request_type, name, is_active)
SELECT 'fund_withdrawal', 'Retrait du fonds d''urgence', true
WHERE NOT EXISTS (
  SELECT 1 FROM approval_workflows
  WHERE request_type = 'fund_withdrawal' AND entity_id IS NULL AND is_active
);

INSERT INTO approval_workflow_steps(workflow_id, step_order, label, approver_role_id)
SELECT workflow.id, step.step_order, step.label, role.id
FROM approval_workflows workflow
CROSS JOIN (VALUES (1, 'DAF'), (2, 'Direction Générale')) AS step(step_order, label)
JOIN roles role ON role.code = CASE step.step_order WHEN 1 THEN 'daf' ELSE 'dg' END
WHERE workflow.request_type = 'fund_withdrawal'
  AND workflow.entity_id IS NULL
  AND workflow.is_active
  AND NOT EXISTS (
    SELECT 1 FROM approval_workflow_steps existing
    WHERE existing.workflow_id = workflow.id AND existing.step_order = step.step_order
  );

GRANT SELECT, INSERT, UPDATE ON emergency_funds, emergency_fund_rates,
  fund_contributions, fund_withdrawals, approval_requests, approval_actions,
  notifications, accounts, transactions, transaction_number_counters
TO mojo_app;

COMMIT;
