BEGIN;

ALTER TABLE budgets DROP CONSTRAINT budgets_status_check;
ALTER TABLE budgets ADD CONSTRAINT budgets_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'closed'));

INSERT INTO approval_workflows(request_type, name, is_active)
SELECT 'budget', 'Approbation des budgets', true
WHERE NOT EXISTS (
  SELECT 1 FROM approval_workflows
  WHERE request_type = 'budget' AND entity_id IS NULL
);

INSERT INTO approval_workflow_steps(
  workflow_id, step_order, label, approver_role_id, min_amount_usd
)
SELECT workflow.id, step.step_order, step.label, role.id, NULL
FROM approval_workflows workflow
CROSS JOIN (VALUES
  (1, 'DAF'),
  (2, 'DG')
) AS step(step_order, label)
JOIN roles role ON role.code = CASE step.step_order WHEN 1 THEN 'daf' ELSE 'dg' END
WHERE workflow.request_type = 'budget'
  AND workflow.entity_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM approval_workflow_steps existing
    WHERE existing.workflow_id = workflow.id AND existing.step_order = step.step_order
  );

CREATE TABLE scheduled_notification_deliveries (
  event_key text PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_notification_deliveries TO mojo_app;

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_owner ON push_subscriptions
  FOR ALL
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

CREATE TABLE notification_push_queue (
  notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at timestamptz,
  last_error text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_push_queue TO mojo_app;

CREATE FUNCTION queue_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO notification_push_queue(notification_id, user_id)
  SELECT NEW.id, NEW.user_id
  WHERE EXISTS (
    SELECT 1 FROM push_subscriptions subscription
    WHERE subscription.user_id = NEW.user_id
  )
  ON CONFLICT (notification_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION queue_notification_push() FROM PUBLIC;

CREATE TRIGGER trg_notification_push_queue
AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION queue_notification_push();

COMMIT;
