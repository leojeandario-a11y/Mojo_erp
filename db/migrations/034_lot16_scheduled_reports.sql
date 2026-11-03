BEGIN;

CREATE TABLE report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('finance','hr','business','marketing','operations','store')),
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  entity_id uuid REFERENCES entities(id) ON DELETE CASCADE,
  window_days smallint NOT NULL DEFAULT 30 CHECK (window_days IN (7,30,90,365)),
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  locked_until timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_schedules_due
  ON report_schedules(next_run_at)
  WHERE is_active;

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_schedules_owner ON report_schedules
  FOR ALL
  USING (owner_id = app_user_id())
  WITH CHECK (owner_id = app_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO mojo_app;
CALL attach_audit('report_schedules', 'reports');

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN
    ('approval_needed','invoice_overdue','payment_expected','low_stock','contract_expiring',
     'budget_exceeded','project_late','hr_request','fund_withdrawal','monthly_report',
     'scheduled_report','system'));

CREATE FUNCTION claim_due_report_schedules()
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  category text,
  frequency text,
  entity_id uuid,
  window_days smallint,
  next_run_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH due AS (
    SELECT schedule.id
    FROM report_schedules schedule
    WHERE schedule.is_active
      AND schedule.next_run_at <= now()
      AND (schedule.locked_until IS NULL OR schedule.locked_until <= now())
    ORDER BY schedule.next_run_at, schedule.id
    FOR UPDATE SKIP LOCKED
    LIMIT 100
  ),
  claimed AS (
    UPDATE report_schedules schedule
    SET locked_until = now() + interval '5 minutes'
    FROM due
    WHERE schedule.id = due.id
    RETURNING schedule.id, schedule.owner_id, schedule.category, schedule.frequency,
              schedule.entity_id, schedule.window_days, schedule.next_run_at
  )
  SELECT claimed.id, claimed.owner_id, claimed.category, claimed.frequency,
         claimed.entity_id, claimed.window_days, claimed.next_run_at
  FROM claimed
$$;
REVOKE ALL ON FUNCTION claim_due_report_schedules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_due_report_schedules() TO mojo_app;

COMMIT;
