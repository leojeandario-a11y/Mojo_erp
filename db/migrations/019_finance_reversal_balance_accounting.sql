CREATE OR REPLACE VIEW v_account_balances AS
SELECT a.id AS account_id, a.entity_id, a.name, a.currency,
       a.opening_balance
       + COALESCE(SUM(CASE
           WHEN t.tx_type IN ('income', 'transfer_in') THEN t.amount
           WHEN t.tx_type IN ('expense', 'transfer_out') THEN -t.amount
           WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase' THEN t.amount
           WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease' THEN -t.amount
           ELSE 0
         END) FILTER (WHERE t.status IN ('validated', 'reversed')), 0) AS balance
FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
GROUP BY a.id;
