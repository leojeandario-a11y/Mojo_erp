ALTER TABLE product_categories
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_path text;

CREATE TABLE store_receipt_counters (
  sale_date date PRIMARY KEY,
  last_value bigint NOT NULL CHECK (last_value > 0)
);

ALTER TABLE sales
  ADD COLUMN offline_sale_id uuid,
  ADD COLUMN returned_at timestamptz,
  ADD COLUMN returned_by uuid REFERENCES users(id);

CREATE UNIQUE INDEX uq_sales_offline_id
  ON sales(offline_sale_id) WHERE offline_sale_id IS NOT NULL;

ALTER TABLE sale_payments
  ADD COLUMN tendered_amount numeric(18,2),
  ADD COLUMN change_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0);

ALTER TABLE stock_movements
  ADD COLUMN unit_cost_currency char(3) REFERENCES currencies(code);

ALTER TABLE inventory_counts
  ADD COLUMN entity_id uuid REFERENCES entities(id);

WITH single_entity_counts AS (
  SELECT l.count_id, min(p.entity_id::text)::uuid AS entity_id
  FROM inventory_count_lines l
  JOIN products p ON p.id = l.product_id
  GROUP BY l.count_id
  HAVING COUNT(DISTINCT p.entity_id) = 1
)
UPDATE inventory_counts c
SET entity_id = scoped.entity_id
FROM single_entity_counts scoped
WHERE c.id = scoped.count_id;

CREATE INDEX idx_inventory_counts_entity_status_date
  ON inventory_counts(entity_id, status, counted_on DESC);

CREATE TABLE store_sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL UNIQUE REFERENCES sales(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  transaction_id uuid NOT NULL UNIQUE REFERENCES transactions(id),
  reason text NOT NULL,
  returned_by uuid NOT NULL REFERENCES users(id),
  returned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store_discount_limits (
  role_id uuid PRIMARY KEY REFERENCES roles(id) ON DELETE CASCADE,
  max_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (max_percent BETWEEN 0 AND 100),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO store_discount_limits(role_id)
SELECT id FROM roles
ON CONFLICT (role_id) DO NOTHING;

ALTER TABLE exhibitors
  ADD COLUMN commission_basis text NOT NULL DEFAULT 'gross_sales'
    CHECK (commission_basis IN ('gross_sales','net_after_discounts'));

ALTER TABLE exhibitor_statements
  DROP CONSTRAINT exhibitor_statements_status_check,
  ADD CONSTRAINT exhibitor_statements_status_check
    CHECK (status IN ('open','validated','settled')),
  ADD COLUMN commission_basis text NOT NULL DEFAULT 'gross_sales',
  ADD COLUMN validated_by uuid REFERENCES users(id),
  ADD COLUMN validated_at timestamptz,
  ADD CONSTRAINT exhibitor_statements_validation_pair
    CHECK ((validated_by IS NULL) = (validated_at IS NULL));

CREATE TABLE exhibitor_statement_lines (
  statement_id uuid NOT NULL REFERENCES exhibitor_statements(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id),
  sales_amount_usd numeric(18,2) NOT NULL CHECK (sales_amount_usd >= 0),
  commission_usd numeric(18,2) NOT NULL CHECK (commission_usd >= 0),
  PRIMARY KEY (statement_id, sale_id)
);

ALTER TABLE exhibitor_payments
  ADD COLUMN account_id uuid REFERENCES accounts(id),
  ADD COLUMN payment_method text CHECK (payment_method IN ('cash','card','mobile_money','bank_transfer'));

CREATE UNIQUE INDEX uq_store_open_inventory_location
  ON inventory_counts(location_id) WHERE status = 'open';

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('approval_needed','invoice_overdue','payment_expected','low_stock','contract_expiring',
   'budget_exceeded','project_late','hr_request','fund_withdrawal','fund_target_reached',
   'monthly_report','system','rent_due'));

CREATE OR REPLACE FUNCTION prevent_negative_store_stock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_quantity numeric(18,3);
BEGIN
  IF EXISTS (
    SELECT 1
    FROM products p
    JOIN entities e ON e.id = p.entity_id
    WHERE p.id = NEW.product_id AND e.code = 'STORE'
  ) AND NOT EXISTS (
    SELECT 1 FROM stock_locations l WHERE l.id = NEW.location_id AND l.is_default
  ) THEN
    RAISE EXCEPTION 'Store stock movements require the default stock location.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.product_id::text), hashtext(NEW.location_id::text));
  SELECT COALESCE(SUM(quantity), 0)
    INTO current_quantity
    FROM stock_movements
   WHERE product_id = NEW.product_id AND location_id = NEW.location_id;
  IF current_quantity + NEW.quantity < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for this movement.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_store_stock_nonnegative
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_negative_store_stock();

CREATE INDEX idx_stock_movements_location_date
  ON stock_movements(location_id, occurred_at DESC);
CREATE INDEX idx_store_sales_entity_date
  ON sales(entity_id, sold_at DESC);
CREATE INDEX idx_exhibitor_statements_status_period
  ON exhibitor_statements(status, period_end DESC);

INSERT INTO permissions(code, module)
VALUES
  ('store.pos.return','store'),
  ('store.pos.void','store'),
  ('store.pos.configure','store'),
  ('store.exhibitor.validate','store'),
  ('store.exhibitor.pay','store')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'super_admin'
  AND p.code IN ('store.pos.return','store.pos.void','store.pos.configure',
                 'store.exhibitor.validate','store.exhibitor.pay')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('daf','dg')
  AND p.code IN ('store.exhibitor.validate','store.exhibitor.pay')
ON CONFLICT DO NOTHING;

CALL attach_audit('product_categories','store');
CALL attach_audit('inventory_counts','store');
CALL attach_audit('inventory_count_lines','store');
CALL attach_audit('store_sale_returns','store');
CALL attach_audit('store_discount_limits','store');
CALL attach_audit('exhibitor_statement_lines','store');

GRANT SELECT, INSERT, UPDATE, DELETE
  ON product_categories, products, stock_locations, inventory_counts, inventory_count_lines,
     exhibitors, exhibitor_statements, exhibitor_statement_lines, exhibitor_payments,
     store_sale_returns, store_discount_limits, sales, sale_items, sale_payments,
     store_receipt_counters
  TO mojo_app;
GRANT SELECT, INSERT ON stock_movements TO mojo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mojo_app;
GRANT SELECT, INSERT, UPDATE ON notifications TO mojo_app;
