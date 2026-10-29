-- 005 : marketing et opérations
CREATE TABLE marketing_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  name          text NOT NULL,
  objective     text,
  department_id uuid REFERENCES departments(id),
  project_id    uuid REFERENCES projects(id),
  budget_id     uuid REFERENCES budgets(id),
  planned_budget numeric(18,2) NOT NULL DEFAULT 0,
  currency      char(3) NOT NULL REFERENCES currencies(code),
  start_date    date,
  end_date      date,
  owner_id      uuid REFERENCES users(id),
  channels      text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','paused','completed','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id)
);

CREATE TABLE campaign_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  recorded_on date NOT NULL,
  channel     text,
  impressions bigint,
  clicks      bigint,
  leads       int,
  conversions int,
  revenue_generated numeric(18,2),
  currency    char(3) REFERENCES currencies(code),
  notes       text
);

CREATE TABLE content_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES marketing_campaigns(id),
  title       text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('post','visual','video','article','ad','other')),
  channel     text,
  scheduled_at timestamptz,
  published_at timestamptz,
  status      text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','in_production','scheduled','published','cancelled')),
  owner_id    uuid REFERENCES users(id),
  body        text
);

-- Opérations
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  role_label text,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id),
  parent_task_id uuid REFERENCES tasks(id),
  title       text NOT NULL,
  description text,
  assignee_id uuid REFERENCES users(id),
  priority    text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status      text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  due_date    date,
  completed_at timestamptz,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid REFERENCES departments(id),
  title       text NOT NULL,
  description text,
  responsible_id uuid REFERENCES users(id),
  planned_date date,
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','done','cancelled'))
);

CREATE TABLE resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('equipment','vehicle','room','software','other')),
  status      text NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_use','maintenance','retired'))
);

CREATE TABLE resource_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources(id),
  project_id  uuid REFERENCES projects(id),
  task_id     uuid REFERENCES tasks(id),
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  CHECK (to_date >= from_date)
);

CREATE TABLE project_expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES transactions(id),
  UNIQUE (project_id, transaction_id)
);

CREATE VIEW v_project_finance AS
SELECT p.id AS project_id, p.name, p.budget_amount, p.currency,
  COALESCE(SUM(t.amount_usd) FILTER (WHERE t.tx_type='expense' AND t.status='validated'),0) AS expenses_usd,
  COALESCE(SUM(t.amount_usd) FILTER (WHERE t.tx_type='income'  AND t.status='validated'),0) AS revenues_usd
FROM projects p LEFT JOIN transactions t ON t.project_id = p.id
GROUP BY p.id;

CALL attach_audit('marketing_campaigns','marketing');
CALL attach_audit('tasks','operations');
