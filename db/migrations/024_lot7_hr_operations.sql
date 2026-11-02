-- Lot 7: dossiers RH, présences, congés, évaluations et rapports.

CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  balance_year int NOT NULL CHECK (balance_year BETWEEN 2000 AND 9999),
  carried_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (carried_days >= 0),
  entitled_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (entitled_days >= 0),
  used_days numeric(5,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
  UNIQUE (employee_id, leave_type_id, balance_year)
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_id uuid NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  document_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_dates ON leave_requests(employee_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_evaluations_employee_period ON evaluations(employee_id, period_label);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS position_title text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_history_note text;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS score_min numeric(5,2) NOT NULL DEFAULT 0;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS score_max numeric(5,2) NOT NULL DEFAULT 100;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evaluations_score_range_check'
  ) THEN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_score_range_check
      CHECK (score >= score_min AND score <= score_max);
  END IF;
END $$;

CALL attach_audit('leave_balances', 'hr');
CALL attach_audit('employee_documents', 'hr');
CALL attach_audit('attendance_records', 'hr');
CALL attach_audit('evaluations', 'hr');

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_balance_select ON leave_balances FOR SELECT USING (
  app_has_permission('hr.employee.read')
  OR EXISTS (
    SELECT 1 FROM employees employee
    WHERE employee.id = leave_balances.employee_id AND employee.user_id = app_user_id()
  )
);
CREATE POLICY leave_balance_write ON leave_balances FOR ALL USING (
  app_has_permission('hr.employee.manage')
) WITH CHECK (app_has_permission('hr.employee.manage'));

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_select ON attendance_records FOR SELECT USING (
  app_has_permission('hr.attendance.manage')
  OR app_has_permission('hr.employee.read')
  OR EXISTS (
    SELECT 1 FROM employees employee
    WHERE employee.id = attendance_records.employee_id AND employee.user_id = app_user_id()
  )
);
CREATE POLICY attendance_write ON attendance_records FOR ALL USING (
  app_has_permission('hr.attendance.manage')
) WITH CHECK (app_has_permission('hr.attendance.manage'));

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_request_select ON leave_requests FOR SELECT USING (
  app_has_permission('hr.employee.read')
  OR app_has_permission('hr.leave.approve')
  OR EXISTS (
    SELECT 1 FROM employees employee
    WHERE employee.id = leave_requests.employee_id AND employee.user_id = app_user_id()
  )
);
CREATE POLICY leave_request_write ON leave_requests FOR ALL USING (
  app_has_permission('hr.leave.approve')
  OR EXISTS (
    SELECT 1 FROM employees employee
    WHERE employee.id = leave_requests.employee_id AND employee.user_id = app_user_id()
  )
) WITH CHECK (
  app_has_permission('hr.leave.approve')
  OR EXISTS (
    SELECT 1 FROM employees employee
    WHERE employee.id = leave_requests.employee_id AND employee.user_id = app_user_id()
  )
);

ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY evaluation_select ON evaluations FOR SELECT USING (
  app_has_permission('hr.employee.read')
  OR EXISTS (
    SELECT 1 FROM employees employee
    WHERE employee.id = evaluations.employee_id AND employee.user_id = app_user_id()
  )
);
CREATE POLICY evaluation_write ON evaluations FOR ALL USING (
  app_has_permission('hr.employee.manage')
) WITH CHECK (app_has_permission('hr.employee.manage'));

CREATE POLICY doc_employee_read ON documents FOR SELECT USING (
  confidentiality = 'hr'
  AND owner_table = 'employees'
  AND EXISTS (
    SELECT 1 FROM employees employee
    WHERE employee.id::text = documents.owner_id::text
      AND (app_has_permission('hr.employee.read') OR employee.user_id = app_user_id())
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  leave_balances,
  leave_requests,
  employee_documents,
  attendance_records,
  evaluations,
  employment_history
TO mojo_app;
