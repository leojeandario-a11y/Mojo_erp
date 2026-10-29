-- 002_finance.sql : comptes, catégories, transactions, budgets, fonds d'urgence
CREATE TABLE accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  name        text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('cash','bank','mobile_money','other')),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  bank_name   text,
  account_number_masked text,
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, name)
);

CREATE TABLE transaction_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  uuid REFERENCES entities(id),
  code       text NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('income','expense')),
  parent_id  uuid REFERENCES transaction_categories(id),
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (entity_id, code)
);

-- Projets (nécessaire ici pour les liens financiers)
CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  department_id uuid REFERENCES departments(id),
  manager_id    uuid REFERENCES users(id),
  budget_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (budget_amount >= 0),
  currency      char(3) NOT NULL REFERENCES currencies(code),
  start_date    date,
  end_date      date,
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','on_hold','completed','cancelled')),
  progress_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_projects_upd BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES entities(id),
  tx_number       text UNIQUE,
  tx_type         text NOT NULL CHECK (tx_type IN ('income','expense','transfer_in','transfer_out','adjustment')),
  tx_date         date NOT NULL,
  account_id      uuid NOT NULL REFERENCES accounts(id),
  category_id     uuid REFERENCES transaction_categories(id),
  department_id   uuid REFERENCES departments(id),
  project_id      uuid REFERENCES projects(id),
  amount          numeric(18,2) NOT NULL CHECK (amount > 0),
  currency        char(3) NOT NULL REFERENCES currencies(code),
  fx_rate_to_usd  numeric(18,8) NOT NULL CHECK (fx_rate_to_usd > 0),  -- taux figé à la saisie
  amount_usd      numeric(18,2) GENERATED ALWAYS AS (round(amount * fx_rate_to_usd, 2)) STORED,
  description     text,
  counterparty    text,
  source_table    text,            -- ex: sales, invoice_payments
  source_id       uuid,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','validated','rejected','reversed')),
  reversal_of_id  uuid REFERENCES transactions(id),
  created_by      uuid REFERENCES users(id),
  validated_by    uuid REFERENCES users(id),
  validated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_entity_date ON transactions(entity_id, tx_date);
CREATE INDEX idx_tx_account ON transactions(account_id);
CREATE INDEX idx_tx_project ON transactions(project_id);
CREATE TRIGGER trg_tx_upd BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Une transaction validée est immuable : pas de DELETE, seuls status -> 'reversed' autorisé
CREATE OR REPLACE FUNCTION protect_validated_tx() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('validated','reversed') THEN
      RAISE EXCEPTION 'Transaction validée: suppression interdite, utiliser une contre-passation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('validated','reversed') THEN
    IF OLD.status = 'validated' AND NEW.status = 'reversed'
       AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Transaction validée: modification interdite, utiliser une contre-passation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tx_protect BEFORE UPDATE OR DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION protect_validated_tx();

-- Transferts entre entités (MoJoPIKtures <-> MOJO Store)
CREATE TABLE inter_entity_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id uuid NOT NULL REFERENCES entities(id),
  to_entity_id   uuid NOT NULL REFERENCES entities(id),
  reason        text NOT NULL CHECK (reason IN ('capital_contribution','profit_distribution','loan','loan_repayment','other')),
  out_tx_id     uuid REFERENCES transactions(id),
  in_tx_id      uuid REFERENCES transactions(id),
  amount        numeric(18,2) NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL REFERENCES currencies(code),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','completed','rejected')),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_entity_id <> to_entity_id)
);

CREATE TABLE payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  direction   text NOT NULL CHECK (direction IN ('in','out')),
  payee       text NOT NULL,
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  method      text NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','mobile_money','card')),
  paid_at     date NOT NULL,
  reference   text,
  transaction_id uuid REFERENCES transactions(id),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE debts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  creditor    text NOT NULL,
  description text,
  principal   numeric(18,2) NOT NULL CHECK (principal > 0),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  incurred_on date NOT NULL,
  due_date    date,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE debt_payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id    uuid NOT NULL REFERENCES debts(id),
  amount     numeric(18,2) NOT NULL CHECK (amount > 0),
  paid_at    date NOT NULL,
  transaction_id uuid REFERENCES transactions(id)
);

-- ===== Budgets =====
CREATE TABLE budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  name          text NOT NULL,
  fiscal_year   int NOT NULL,
  period_type   text NOT NULL CHECK (period_type IN ('annual','monthly')),
  period_month  int CHECK (period_month BETWEEN 1 AND 12),
  scope         text NOT NULL CHECK (scope IN ('global','department','project','category','marketing','operations','hr')),
  department_id uuid REFERENCES departments(id),
  project_id    uuid REFERENCES projects(id),
  currency      char(3) NOT NULL REFERENCES currencies(code),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','closed')),
  alert_threshold_pct numeric(5,2) NOT NULL DEFAULT 90,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_type = 'annual' OR period_month IS NOT NULL)
);

CREATE TABLE budget_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id uuid REFERENCES transaction_categories(id),
  label       text,
  planned_amount numeric(18,2) NOT NULL CHECK (planned_amount >= 0)
);

-- ===== Fonds d'urgence (appartient à MoJoPIKtures) =====
CREATE TABLE emergency_funds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id) UNIQUE,
  name          text NOT NULL DEFAULT 'Fonds d''urgence',
  target_amount numeric(18,2) CHECK (target_amount IS NULL OR target_amount > 0),
  currency      char(3) NOT NULL REFERENCES currencies(code),
  account_id    uuid REFERENCES accounts(id),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Historique du pourcentage : fixé par la direction, jamais codé en dur
CREATE TABLE emergency_fund_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id       uuid NOT NULL REFERENCES emergency_funds(id),
  percentage    numeric(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  effective_from date NOT NULL,
  reason        text,
  approval_request_id uuid,
  set_by        uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_id, effective_from)
);

CREATE TABLE fund_contributions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id        uuid NOT NULL REFERENCES emergency_funds(id),
  source_tx_id   uuid REFERENCES transactions(id),   -- revenu à l'origine
  rate_id        uuid REFERENCES emergency_fund_rates(id),
  base_amount    numeric(18,2),
  percentage_applied numeric(5,2),
  amount         numeric(18,2) NOT NULL CHECK (amount > 0),
  currency       char(3) NOT NULL REFERENCES currencies(code),
  contribution_date date NOT NULL,
  kind           text NOT NULL DEFAULT 'automatic' CHECK (kind IN ('automatic','manual')),
  transaction_id uuid REFERENCES transactions(id),
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_tx_id, fund_id)
);

CREATE TABLE fund_withdrawals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id        uuid NOT NULL REFERENCES emergency_funds(id),
  requested_by   uuid NOT NULL REFERENCES users(id),
  amount         numeric(18,2) NOT NULL CHECK (amount > 0),
  currency       char(3) NOT NULL REFERENCES currencies(code),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','disbursed','cancelled')),
  approval_request_id uuid,
  transaction_id uuid REFERENCES transactions(id),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  disbursed_at   timestamptz
);

CREATE VIEW v_account_balances AS
SELECT a.id AS account_id, a.entity_id, a.name, a.currency,
       a.opening_balance
       + COALESCE(SUM(CASE WHEN t.tx_type IN ('income','transfer_in') THEN t.amount
                           WHEN t.tx_type IN ('expense','transfer_out') THEN -t.amount
                           ELSE 0 END) FILTER (WHERE t.status = 'validated'), 0) AS balance
FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
GROUP BY a.id;

CREATE VIEW v_fund_balance AS
SELECT f.id AS fund_id, f.target_amount, f.currency,
  COALESCE((SELECT SUM(amount) FROM fund_contributions c WHERE c.fund_id = f.id),0)
  - COALESCE((SELECT SUM(amount) FROM fund_withdrawals w WHERE w.fund_id = f.id AND w.status = 'disbursed'),0) AS balance
FROM emergency_funds f;

CALL attach_audit('accounts','finance');
CALL attach_audit('transactions','finance');
CALL attach_audit('budgets','finance');
CALL attach_audit('budget_lines','finance');
CALL attach_audit('emergency_fund_rates','finance');
CALL attach_audit('fund_contributions','finance');
CALL attach_audit('fund_withdrawals','finance');
CALL attach_audit('inter_entity_transfers','finance');
CALL attach_audit('payments','finance');
CALL attach_audit('debts','finance');
CALL attach_audit('projects','operations');
