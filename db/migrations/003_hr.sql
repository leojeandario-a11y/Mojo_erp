-- 003_hr.sql : ressources humaines (données salariales protégées par RLS)
CREATE TABLE employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid UNIQUE REFERENCES users(id),
  employee_code text NOT NULL UNIQUE,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  birth_date    date,
  national_id_masked text,
  phone         text,
  address       text,
  department_id uuid REFERENCES departments(id),
  entity_id     uuid REFERENCES entities(id),
  job_title     text,
  hire_date     date NOT NULL,
  end_date      date,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','suspended','terminated')),
  contract_type text CHECK (contract_type IN ('permanent','fixed_term','consultant','intern','part_time')),
  manager_id    uuid REFERENCES employees(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_emp_upd BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employment_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  change_type text NOT NULL,
  from_value  text,
  to_value    text,
  effective_date date NOT NULL,
  note        text
);

CREATE TABLE attendance_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  work_date   date NOT NULL,
  status      text NOT NULL CHECK (status IN ('present','absent','late','permission','remote')),
  check_in    time,
  check_out   time,
  minutes_late int NOT NULL DEFAULT 0,
  note        text,
  UNIQUE (employee_id, work_date)
);

CREATE TABLE leave_types (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  days_per_year numeric(5,2),
  is_paid    boolean NOT NULL DEFAULT true
);

CREATE TABLE leave_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  days          numeric(5,2) NOT NULL CHECK (days > 0),
  reason        text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approval_request_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE evaluations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  evaluator_id uuid REFERENCES users(id),
  period_label text NOT NULL,
  score       numeric(4,2),
  comments    text,
  evaluated_on date NOT NULL
);

CREATE TABLE trainings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  provider    text,
  start_date  date,
  end_date    date,
  cost        numeric(18,2),
  currency    char(3) REFERENCES currencies(code)
);

CREATE TABLE training_participants (
  training_id uuid NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  status      text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','completed','absent')),
  PRIMARY KEY (training_id, employee_id)
);

CREATE TABLE job_openings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  department_id uuid REFERENCES departments(id),
  description   text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','closed','filled')),
  opened_on     date,
  closed_on     date
);

CREATE TABLE candidates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_opening_id uuid NOT NULL REFERENCES job_openings(id),
  full_name   text NOT NULL,
  email       text,
  phone       text,
  stage       text NOT NULL DEFAULT 'applied' CHECK (stage IN ('applied','screening','interview','offer','hired','rejected')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  departure_type text NOT NULL CHECK (departure_type IN ('resignation','dismissal','end_of_contract','retirement','other')),
  notice_date date,
  last_day    date NOT NULL,
  note        text
);

-- ===== Données salariales (niveau de confidentialité supérieur) =====
CREATE TABLE employee_salaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  base_salary numeric(18,2) NOT NULL CHECK (base_salary >= 0),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  pay_frequency text NOT NULL DEFAULT 'monthly' CHECK (pay_frequency IN ('weekly','biweekly','monthly')),
  effective_from date NOT NULL,
  effective_to   date,
  UNIQUE (employee_id, effective_from)
);

CREATE TABLE payroll_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','paid')),
  approval_request_id uuid,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, period_label)
);

CREATE TABLE payroll_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  gross_amount numeric(18,2) NOT NULL,
  bonuses     numeric(18,2) NOT NULL DEFAULT 0,
  deductions  numeric(18,2) NOT NULL DEFAULT 0,
  advances_recovered numeric(18,2) NOT NULL DEFAULT 0,
  net_amount  numeric(18,2) NOT NULL,
  currency    char(3) NOT NULL REFERENCES currencies(code),
  transaction_id uuid REFERENCES transactions(id),
  paid_at     date,
  UNIQUE (payroll_run_id, employee_id)
);

CREATE TABLE salary_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  kind        text NOT NULL CHECK (kind IN ('advance','bonus','deduction')),
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  adjust_date date NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','applied','rejected')),
  approval_request_id uuid,
  created_by  uuid REFERENCES users(id)
);

CALL attach_audit('employees','hr');
CALL attach_audit('leave_requests','hr');
CALL attach_audit('employee_salaries','hr');
CALL attach_audit('payroll_runs','hr');
CALL attach_audit('payroll_entries','hr');
CALL attach_audit('salary_adjustments','hr');
