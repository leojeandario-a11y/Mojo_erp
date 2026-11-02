-- Lot 8 : paie, formations, recrutement et départs

ALTER TABLE payroll_runs DROP CONSTRAINT payroll_runs_status_check;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_status_check
  CHECK (status IN ('draft','pending_approval','pending_dg','approved','paid'));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  trainings, training_participants, job_openings, candidates, departures,
  employee_salaries, payroll_runs, payroll_entries, salary_adjustments
TO mojo_app;

ALTER TABLE trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE departures ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_read ON trainings FOR SELECT
  USING (app_has_permission('hr.employee.read') OR app_has_permission('hr.employee.manage') OR app_has_permission('hr.salary.read'));
CREATE POLICY training_write ON trainings FOR ALL
  USING (app_has_permission('hr.employee.manage')) WITH CHECK (app_has_permission('hr.employee.manage'));
CREATE POLICY training_participant_access ON training_participants FOR ALL
  USING (app_has_permission('hr.employee.manage')) WITH CHECK (app_has_permission('hr.employee.manage'));
CREATE POLICY recruitment_read ON job_openings FOR SELECT
  USING (app_has_permission('hr.recruitment.manage') OR app_has_permission('hr.employee.read'));
CREATE POLICY recruitment_write ON job_openings FOR ALL
  USING (app_has_permission('hr.recruitment.manage')) WITH CHECK (app_has_permission('hr.recruitment.manage'));
CREATE POLICY candidate_access ON candidates FOR ALL
  USING (app_has_permission('hr.recruitment.manage')) WITH CHECK (app_has_permission('hr.recruitment.manage'));
CREATE POLICY departure_access ON departures FOR ALL
  USING (app_has_permission('hr.employee.manage')) WITH CHECK (app_has_permission('hr.employee.manage'));

CREATE OR REPLACE FUNCTION protect_paid_payroll()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM payroll_runs WHERE id = OLD.payroll_run_id AND status = 'paid') THEN
      RAISE EXCEPTION 'A paid payroll run cannot be modified or deleted.';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM payroll_runs WHERE id = OLD.payroll_run_id AND status = 'paid') THEN
    RAISE EXCEPTION 'A paid payroll run cannot be modified.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_paid_payroll_entry_protection
BEFORE UPDATE OR DELETE ON payroll_entries
FOR EACH ROW EXECUTE FUNCTION protect_paid_payroll();

CREATE OR REPLACE FUNCTION protect_paid_payroll_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A paid payroll run cannot be modified.';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'paid' THEN
    RAISE EXCEPTION 'A paid payroll run cannot be deleted.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_paid_payroll_run_protection
BEFORE UPDATE OR DELETE ON payroll_runs
FOR EACH ROW EXECUTE FUNCTION protect_paid_payroll_run();
