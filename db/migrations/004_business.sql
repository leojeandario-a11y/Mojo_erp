-- 004_business.sql : affaires (clients, pipeline, contrats, partenaires, factures)
CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  kind        text NOT NULL DEFAULT 'prospect' CHECK (kind IN ('prospect','client')),
  company_name text,
  full_name   text NOT NULL,
  email       text,
  phone       text,
  address     text,
  owner_id    uuid REFERENCES users(id),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cust_upd BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  job_title   text,
  email       text,
  phone       text
);

CREATE TABLE customer_interactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  interaction_type text NOT NULL CHECK (interaction_type IN ('call','meeting','email','message','visit','other')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  summary     text NOT NULL,
  created_by  uuid REFERENCES users(id)
);

CREATE TABLE suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid REFERENCES entities(id),
  name        text NOT NULL,
  contact_name text,
  email       text,
  phone       text,
  address     text,
  payment_terms text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  partner_type text NOT NULL CHECK (partner_type IN ('partner','collaborator','sponsor','other')),
  contact_name text,
  email       text,
  phone       text,
  commercial_terms text,
  start_date  date,
  end_date    date,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','ended'))
);

-- Pipeline : Prospect > Contact > Proposition > Négociation > Contrat > Client > Livraison > Paiement
CREATE TABLE opportunities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  title       text NOT NULL,
  service_requested text,
  stage       text NOT NULL DEFAULT 'prospect' CHECK (stage IN
              ('prospect','contact','proposal','negotiation','contract','client','delivery','payment','lost')),
  estimated_amount numeric(18,2),
  currency    char(3) REFERENCES currencies(code),
  expected_close date,
  owner_id    uuid REFERENCES users(id),
  lost_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_opp_upd BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE opportunity_stage_history (
  id          bigserial PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage  text,
  to_stage    text NOT NULL,
  changed_by  uuid REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  contract_number text NOT NULL UNIQUE,
  contract_kind text NOT NULL CHECK (contract_kind IN ('client','supplier','partner','exhibitor')),
  customer_id   uuid REFERENCES customers(id),
  supplier_id   uuid REFERENCES suppliers(id),
  partner_id    uuid REFERENCES partners(id),
  opportunity_id uuid REFERENCES opportunities(id),
  title         text NOT NULL,
  amount        numeric(18,2),
  currency      char(3) REFERENCES currencies(code),
  start_date    date,
  end_date      date,
  renewal_date  date,
  auto_renew    boolean NOT NULL DEFAULT false,
  terms         text,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','active','expired','terminated','renewed')),
  approval_request_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contract_milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  label       text NOT NULL,
  due_date    date NOT NULL,
  amount      numeric(18,2),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','overdue'))
);

CREATE TABLE invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  invoice_number text NOT NULL UNIQUE,
  customer_id   uuid NOT NULL REFERENCES customers(id),
  contract_id   uuid REFERENCES contracts(id),
  project_id    uuid REFERENCES projects(id),
  issue_date    date NOT NULL,
  due_date      date NOT NULL,
  currency      char(3) NOT NULL REFERENCES currencies(code),
  subtotal      numeric(18,2) NOT NULL DEFAULT 0,
  discount      numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount    numeric(18,2) NOT NULL DEFAULT 0,
  total         numeric(18,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partially_paid','paid','overdue','cancelled')),
  notes         text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= issue_date)
);

CREATE TABLE invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price  numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  line_total  numeric(18,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED
);

CREATE TABLE invoice_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  fx_rate_to_invoice_currency numeric(18,8) NOT NULL DEFAULT 1 CHECK (fx_rate_to_invoice_currency > 0),
  method      text NOT NULL CHECK (method IN ('cash','bank_transfer','cheque','mobile_money','card')),
  paid_at     date NOT NULL,
  reference   text,
  receipt_number text UNIQUE,
  transaction_id uuid REFERENCES transactions(id),
  created_by  uuid REFERENCES users(id)
);

CREATE VIEW v_invoice_balances AS
SELECT i.id AS invoice_id, i.invoice_number, i.entity_id, i.customer_id, i.currency, i.total, i.due_date, i.status,
       COALESCE(SUM(round(p.amount * p.fx_rate_to_invoice_currency, 2)), 0) AS paid,
       i.total - COALESCE(SUM(round(p.amount * p.fx_rate_to_invoice_currency, 2)), 0) AS balance_due
FROM invoices i LEFT JOIN invoice_payments p ON p.invoice_id = i.id
GROUP BY i.id;

CALL attach_audit('customers','business');
CALL attach_audit('opportunities','business');
CALL attach_audit('contracts','business');
CALL attach_audit('invoices','business');
CALL attach_audit('invoice_payments','business');
