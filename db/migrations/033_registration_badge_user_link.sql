BEGIN;

ALTER TABLE authorized_badges
  ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_authorized_badges_user
  ON authorized_badges(user_id)
  WHERE user_id IS NOT NULL;

WITH approved_accounts AS (
  SELECT r.badge_id, u.id AS user_id,
         count(*) OVER (PARTITION BY r.badge_id) AS badge_matches,
         count(*) OVER (PARTITION BY u.id) AS user_matches
  FROM account_registration_requests r
  JOIN users u ON u.email = r.email
  WHERE r.status = 'approved'
)
UPDATE authorized_badges b
SET user_id = approved.user_id
FROM approved_accounts approved
WHERE b.id = approved.badge_id
  AND approved.badge_matches = 1
  AND approved.user_matches = 1
  AND b.user_id IS NULL;

COMMIT;
