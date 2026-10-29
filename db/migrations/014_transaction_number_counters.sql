CREATE TABLE transaction_number_counters (
  entity_id     uuid NOT NULL REFERENCES entities(id),
  calendar_year int NOT NULL CHECK (calendar_year BETWEEN 1900 AND 9999),
  last_value    bigint NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (entity_id, calendar_year)
);

WITH matching_numbers AS (
  SELECT
    t.entity_id,
    EXTRACT(YEAR FROM t.tx_date)::int AS calendar_year,
    substring(
      t.tx_number
      FROM length(e.code || '-' || EXTRACT(YEAR FROM t.tx_date)::int::text || '-') + 1
    )::bigint AS number_value
  FROM transactions t
  JOIN entities e ON e.id = t.entity_id
  WHERE t.tx_number IS NOT NULL
    AND left(t.tx_number, length(e.code || '-' || EXTRACT(YEAR FROM t.tx_date)::int::text || '-'))
        = e.code || '-' || EXTRACT(YEAR FROM t.tx_date)::int::text || '-'
    AND substring(
      t.tx_number
      FROM length(e.code || '-' || EXTRACT(YEAR FROM t.tx_date)::int::text || '-') + 1
    ) ~ '^[0-9]+$'
)
INSERT INTO transaction_number_counters(entity_id, calendar_year, last_value)
SELECT entity_id, calendar_year, MAX(number_value)
FROM matching_numbers
GROUP BY entity_id, calendar_year;

GRANT SELECT, INSERT, UPDATE ON transaction_number_counters TO mojo_app;
