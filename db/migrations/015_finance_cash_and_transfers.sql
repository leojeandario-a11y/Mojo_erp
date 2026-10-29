ALTER TABLE accounts
  ADD COLUMN cash_ceiling numeric(18,2) CHECK (cash_ceiling > 0),
  ADD COLUMN cash_variance_tolerance numeric(18,2) CHECK (cash_variance_tolerance >= 0),
  ADD CONSTRAINT accounts_cash_controls_pair CHECK (
    (cash_ceiling IS NULL) = (cash_variance_tolerance IS NULL)
  );

CREATE TABLE cash_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id),
  session_date          date NOT NULL,
  opening_count         numeric(18,2) NOT NULL CHECK (opening_count >= 0),
  opening_expected      numeric(18,2) NOT NULL CHECK (opening_expected >= 0),
  opened_by             uuid NOT NULL REFERENCES users(id),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closing_count         numeric(18,2) CHECK (closing_count >= 0),
  closing_expected      numeric(18,2) CHECK (closing_expected >= 0),
  closed_by             uuid REFERENCES users(id),
  closed_at             timestamptz,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  UNIQUE (account_id, session_date),
  CHECK (
    (status = 'open' AND closing_count IS NULL AND closing_expected IS NULL
      AND closed_by IS NULL AND closed_at IS NULL)
    OR
    (status = 'closed' AND closing_count IS NOT NULL AND closing_expected IS NOT NULL
      AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
  )
);
CREATE INDEX idx_cash_sessions_date_status ON cash_sessions(session_date, status);
CALL attach_audit('cash_sessions','finance');

CREATE TABLE account_transfers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  from_account_id uuid NOT NULL REFERENCES accounts(id),
  to_account_id   uuid NOT NULL REFERENCES accounts(id),
  transfer_date date NOT NULL,
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  description text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);
CALL attach_audit('account_transfers','finance');

ALTER TABLE transactions
  ADD COLUMN account_transfer_id uuid REFERENCES account_transfers(id);

CREATE UNIQUE INDEX idx_transfer_out_once
  ON transactions(account_transfer_id) WHERE tx_type = 'transfer_out';
CREATE UNIQUE INDEX idx_transfer_in_once
  ON transactions(account_transfer_id) WHERE tx_type = 'transfer_in';

CALL attach_audit('transaction_categories','finance');

GRANT SELECT, INSERT, UPDATE ON cash_sessions, account_transfers TO mojo_app;
GRANT SELECT, INSERT, UPDATE ON accounts TO mojo_app;
