-- 006_store.sql : MOJO Store (entité financière distincte)
CREATE TABLE product_categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL UNIQUE,
  parent_id uuid REFERENCES product_categories(id)
);

CREATE TABLE exhibitors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  contact_name text,
  email       text,
  phone       text,
  space_label text,
  contract_id uuid REFERENCES contracts(id),
  rent_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (rent_amount >= 0),
  rent_currency char(3) REFERENCES currencies(code),
  rent_period text CHECK (rent_period IN ('weekly','monthly','one_time')),
  commission_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','ended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  sku           text NOT NULL UNIQUE,
  barcode       text UNIQUE,
  name          text NOT NULL,
  category_id   uuid REFERENCES product_categories(id),
  supplier_id   uuid REFERENCES suppliers(id),
  exhibitor_id  uuid REFERENCES exhibitors(id),      -- produit appartenant à un exposant
  purchase_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price    numeric(18,2) NOT NULL CHECK (sale_price >= 0),
  price_currency char(3) NOT NULL REFERENCES currencies(code),
  min_stock     int NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  image_path    text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_prod_upd BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_locations (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_default boolean NOT NULL DEFAULT false
);

CREATE TABLE sales (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES entities(id),
  receipt_number text NOT NULL UNIQUE,
  customer_id   uuid REFERENCES customers(id),
  cashier_id    uuid NOT NULL REFERENCES users(id),
  sold_at       timestamptz NOT NULL DEFAULT now(),
  currency      char(3) NOT NULL REFERENCES currencies(code),
  fx_rate_to_usd numeric(18,8) NOT NULL CHECK (fx_rate_to_usd > 0),
  subtotal      numeric(18,2) NOT NULL DEFAULT 0,
  discount      numeric(18,2) NOT NULL DEFAULT 0,
  total         numeric(18,2) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided','returned')),
  voided_by     uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_date ON sales(sold_at);

CREATE TABLE sale_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id),
  quantity    numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price  numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost   numeric(18,2) NOT NULL DEFAULT 0,
  discount    numeric(18,2) NOT NULL DEFAULT 0,
  line_total  numeric(18,2) GENERATED ALWAYS AS (round(quantity * unit_price - discount, 2)) STORED
);

CREATE TABLE sale_payments (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id   uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method    text NOT NULL CHECK (method IN ('cash','card','mobile_money','bank_transfer','credit')),
  amount    numeric(18,2) NOT NULL CHECK (amount > 0),
  currency  char(3) NOT NULL REFERENCES currencies(code),
  account_id uuid REFERENCES accounts(id),
  transaction_id uuid REFERENCES transactions(id)
);

CREATE TABLE stock_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id),
  location_id uuid NOT NULL REFERENCES stock_locations(id),
  movement_type text NOT NULL CHECK (movement_type IN
               ('entry','exit','sale','return','loss','adjustment','inventory','transfer_in','transfer_out')),
  quantity    numeric(12,3) NOT NULL CHECK (quantity <> 0),  -- signé: + entrée, - sortie
  unit_cost   numeric(18,2),
  sale_item_id uuid REFERENCES sale_items(id),
  reference   text,
  note        text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);
CREATE INDEX idx_stock_prod ON stock_movements(product_id, location_id);

CREATE VIEW v_stock_levels AS
SELECT p.id AS product_id, p.sku, p.name, p.min_stock,
       COALESCE(SUM(m.quantity),0) AS quantity,
       COALESCE(SUM(m.quantity),0) <= p.min_stock AS is_low
FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
GROUP BY p.id;

CREATE TABLE inventory_counts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES stock_locations(id),
  counted_on  date NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by  uuid REFERENCES users(id)
);

CREATE TABLE inventory_count_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id    uuid NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id),
  expected_qty numeric(12,3) NOT NULL,
  counted_qty  numeric(12,3) NOT NULL
);

-- Règlements exposants : loyer + commission, solde dû
CREATE TABLE exhibitor_statements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exhibitor_id uuid NOT NULL REFERENCES exhibitors(id),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  sales_total_usd numeric(18,2) NOT NULL DEFAULT 0,
  commission_usd  numeric(18,2) NOT NULL DEFAULT 0,
  rent_usd        numeric(18,2) NOT NULL DEFAULT 0,
  net_due_to_exhibitor_usd numeric(18,2) NOT NULL DEFAULT 0,  -- ventes - commission - loyer (peut être négatif)
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  UNIQUE (exhibitor_id, period_start, period_end)
);

CREATE TABLE exhibitor_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exhibitor_id uuid NOT NULL REFERENCES exhibitors(id),
  statement_id uuid REFERENCES exhibitor_statements(id),
  direction    text NOT NULL CHECK (direction IN ('from_exhibitor','to_exhibitor')),
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  currency     char(3) NOT NULL REFERENCES currencies(code),
  fx_rate_to_usd numeric(18,8) NOT NULL CHECK (fx_rate_to_usd > 0),
  paid_at      date NOT NULL,
  transaction_id uuid REFERENCES transactions(id)
);

CALL attach_audit('products','store');
CALL attach_audit('sales','store');
CALL attach_audit('stock_movements','store');
CALL attach_audit('exhibitors','store');
CALL attach_audit('exhibitor_payments','store');
