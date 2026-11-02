DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM transactions WHERE tx_type = 'adjustment') THEN
    RAISE EXCEPTION 'Existing adjustment transactions need an explicit direction before migration 018 can be applied';
  END IF;
END $$;

ALTER TABLE transactions
  ADD COLUMN adjustment_direction text,
  ADD CONSTRAINT transactions_adjustment_direction_check CHECK (
    (tx_type = 'adjustment' AND adjustment_direction IS NOT NULL AND adjustment_direction IN ('increase', 'decrease'))
    OR (tx_type <> 'adjustment' AND adjustment_direction IS NULL)
  );

CREATE OR REPLACE VIEW v_account_balances AS
SELECT a.id AS account_id, a.entity_id, a.name, a.currency,
       a.opening_balance
       + COALESCE(SUM(CASE
           WHEN t.tx_type IN ('income', 'transfer_in') THEN t.amount
           WHEN t.tx_type IN ('expense', 'transfer_out') THEN -t.amount
           WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase' THEN t.amount
           WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease' THEN -t.amount
           ELSE 0
         END) FILTER (WHERE t.status = 'validated'), 0) AS balance
FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
GROUP BY a.id;

CREATE POLICY doc_finance_transaction_read ON documents FOR SELECT USING (
  confidentiality = 'finance'
  AND owner_table = 'transactions'
  AND EXISTS (
    SELECT 1 FROM transactions tx
    WHERE tx.id = documents.owner_id
      AND (
        app_has_entity_permission('finance.transaction.read', tx.entity_id)
        OR tx.created_by = app_user_id()
      )
  )
);

CALL attach_audit('documents', 'finance');
