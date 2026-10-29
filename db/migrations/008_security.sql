-- 008_security.sql : rôle applicatif, droits, Row-Level Security (RH / salaires / documents)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mojo_app') THEN
    CREATE ROLE mojo_app LOGIN;   -- mot de passe défini par scripts/migrate.sh
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO mojo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mojo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mojo_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO mojo_app;

-- Journal d'audit : lecture seule pour l'application (l'écriture passe par les triggers)
REVOKE INSERT, UPDATE, DELETE ON audit_logs FROM mojo_app;
-- Taux de change et transactions : pas de suppression directe par l'application
REVOKE DELETE ON transactions, exchange_rates, fund_contributions, fund_withdrawals FROM mojo_app;

-- ===== RLS : salaires et paie =====
ALTER TABLE employee_salaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY sal_select ON employee_salaries FOR SELECT USING (app_has_permission('hr.salary.read'));
CREATE POLICY sal_write  ON employee_salaries FOR ALL    USING (app_has_permission('hr.salary.manage')) WITH CHECK (app_has_permission('hr.salary.manage'));

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pr_select ON payroll_runs FOR SELECT USING (app_has_permission('hr.salary.read'));
CREATE POLICY pr_write  ON payroll_runs FOR ALL    USING (app_has_permission('hr.salary.manage')) WITH CHECK (app_has_permission('hr.salary.manage'));

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY pe_select ON payroll_entries FOR SELECT USING (app_has_permission('hr.salary.read'));
CREATE POLICY pe_write  ON payroll_entries FOR ALL    USING (app_has_permission('hr.salary.manage')) WITH CHECK (app_has_permission('hr.salary.manage'));

ALTER TABLE salary_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY sa_select ON salary_adjustments FOR SELECT USING (app_has_permission('hr.salary.read'));
CREATE POLICY sa_write  ON salary_adjustments FOR ALL    USING (app_has_permission('hr.salary.manage')) WITH CHECK (app_has_permission('hr.salary.manage'));

-- ===== RLS : dossiers employés =====
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY emp_select ON employees FOR SELECT
  USING (app_has_permission('hr.employee.read') OR user_id = app_user_id());
CREATE POLICY emp_write ON employees FOR ALL
  USING (app_has_permission('hr.employee.manage')) WITH CHECK (app_has_permission('hr.employee.manage'));

-- ===== RLS : documents confidentiels =====
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_select ON documents FOR SELECT USING (
  confidentiality = 'general'
  OR (confidentiality = 'finance'    AND app_has_permission('finance.transaction.read'))
  OR (confidentiality = 'hr'         AND app_has_permission('hr.employee.read'))
  OR (confidentiality = 'restricted' AND app_has_permission('documents.manage'))
);
CREATE POLICY doc_write ON documents FOR ALL USING (app_has_permission('documents.manage') OR uploaded_by = app_user_id())
  WITH CHECK (app_has_permission('documents.manage') OR uploaded_by = app_user_id());

-- ===== RLS : notifications personnelles =====
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_own ON notifications FOR ALL USING (user_id = app_user_id()) WITH CHECK (true);
