BEGIN;

ALTER TABLE store_sale_returns
  ADD COLUMN receipt_number_confirmed text,
  ADD COLUMN condition_confirmed boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT store_sale_returns_policy_confirmation_pair
    CHECK (condition_confirmed = (receipt_number_confirmed IS NOT NULL));

COMMIT;
